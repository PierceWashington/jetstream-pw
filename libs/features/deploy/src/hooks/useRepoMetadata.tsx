import { logger } from '@jetstream/shared/client-logger';
import { getRepoFileContent, getRepoFileTree, GitHubContentItem } from '@jetstream/shared/data';
import { getErrorMessage } from '@jetstream/shared/utils';
import { ListMetadataResult } from '@jetstream/types';
import { useCallback, useRef, useState } from 'react';
import { FilePropertiesWithContent } from '../view-or-compare-metadata/viewOrCompareMetadataTypes';

export interface RepoInfo {
  repoSourceId: string;
  owner: string;
  repo: string;
  branch: string;
}

/**
 * Derives the directory name and base filename from a Salesforce metadata fileName.
 * e.g. "unpackaged/classes/MyClass.cls" → { dir: "classes", base: "MyClass.cls" }
 * e.g. "classes/MyClass.cls"            → { dir: "classes", base: "MyClass.cls" }
 * e.g. "unpackaged/lwc/myComp"          → { dir: "lwc", base: "myComp", isBundle: true }
 */
function parseSalesforceFileName(fileName: string): { dir: string; base: string; isBundle: boolean } {
  const stripped = fileName.replace(/^unpackaged\//, '');
  const parts = stripped.split('/');
  const dir = parts[0] || '';
  const base = parts[1] || '';
  const hasExtension = base.includes('.');
  return { dir, base, isBundle: !hasExtension };
}

/**
 * Candidate base paths to search when resolving repo file locations.
 * Ordered from most specific (SFDX) to least (bare).
 * An empty string means the file lives directly under the repo root.
 */
const BASE_PATH_CANDIDATES = ['force-app/main/default']; //, 'src', 'unpackaged', ''];

/**
 * Given a repo source and a set of Salesforce metadata entries, fetches the
 * corresponding file contents from the GitHub repo and returns
 * `FilePropertiesWithContent[]` in metadata-API format that `buildTree` expects.
 *
 * Supports both SFDX-style repos (`force-app/main/default/<dir>/...`) and
 * metadata-API-style repos (`unpackaged/<dir>/...` or just `<dir>/...`).
 */
export function useRepoMetadata() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isMounted = useRef(true);

  /**
   * Cache mapping `dir` → discovered base path (e.g. "force-app/main/default")
   * so that all entries of the same metadata type reuse the same base without
   * additional GitHub API round-trips.
   */
  const basePathCache = useRef<Map<string, string>>(new Map());
  /** Cache of bundle directory listings to avoid redundant API calls. */
  const bundleListingCache = useRef<Map<string, GitHubContentItem[]>>(new Map());

  const reset = useCallback(() => {
    basePathCache.current.clear();
    bundleListingCache.current.clear();
  }, []);

  /**
   * Fetch a single file's content, trying all candidate base paths in order.
   * If `knownBasePath` is provided (not undefined), only that path is tried.
   *
   * Returns `{ content, basePath }` on success, or `null` if all paths fail.
   */
  const fetchFileDirect = useCallback(
    async (
      repoInfo: RepoInfo,
      dir: string,
      base: string,
      knownBasePath?: string | null,
    ): Promise<{ content: string; basePath: string } | null> => {
      // Build a list of { basePath, filePath } pairs to try.
      // If the base path is already known, only try that one — no multi-path probe.
      const candidateConfigs =
        knownBasePath !== undefined && knownBasePath !== null
          ? [{ basePath: knownBasePath, filePath: knownBasePath ? `${knownBasePath}/${dir}/${base}` : `${dir}/${base}` }]
          : BASE_PATH_CANDIDATES.map((bp) => ({ basePath: bp, filePath: bp ? `${bp}/${dir}/${base}` : `${dir}/${base}` }));

      for (const { basePath, filePath } of candidateConfigs) {
        try {
          const content = await getRepoFileContent(repoInfo.repoSourceId, repoInfo.owner, repoInfo.repo, repoInfo.branch, filePath);
          return { content, basePath };
        } catch (err) {
          logger.log('[REPO METADATA] fetchFileDirect miss', { filePath, error: getErrorMessage(err) });
        }
      }

      return null;
    },
    [],
  );

  /**
   * Fetch all file contents for the given selectedMetadata from the repo.
   * Returns FilePropertiesWithContent[] ready for buildTree.
   */
  const fetchRepoFiles = useCallback(
    async (
      repoInfo: RepoInfo,
      selectedMetadata: Record<string, ListMetadataResult[]>,
    ): Promise<FilePropertiesWithContent[]> => {
      setLoading(true);
      setError(null);
      reset();

      const results: FilePropertiesWithContent[] = [];

      try {
        for (const [type, entries] of Object.entries(selectedMetadata)) {
          if (!entries.length) {
            continue;
          }

          const sampleFileName = entries[0]?.fileName;
          if (!sampleFileName) {
            continue;
          }

          const { dir, isBundle } = parseSalesforceFileName(sampleFileName);

          if (!dir) {
            continue;
          }

          if (isBundle) {
            // Bundle types (LWC, Aura, etc.): enumerate all files in each bundle
            // sub-directory after discovering the repo's base path.
            let bundleBasePath = basePathCache.current.get(dir);
            if (bundleBasePath === undefined) {
              // Probe candidate paths to find where this bundle type lives
              for (const bp of BASE_PATH_CANDIDATES) {
                const candidatePath = bp ? `${bp}/${dir}` : dir;
                try {
                  await getRepoFileTree(repoInfo.repoSourceId, repoInfo.owner, repoInfo.repo, repoInfo.branch, candidatePath);
                  bundleBasePath = bp;
                  basePathCache.current.set(dir, bp);
                  break;
                } catch {
                  // Not found at this base, try next
                }
              }
            }

            if (bundleBasePath === undefined) {
              logger.warn('[REPO METADATA] Bundle type directory not found in repo', { type, dir });
              continue;
            }

            for (const entry of entries) {
              const bundlePath = bundleBasePath ? `${bundleBasePath}/${dir}/${entry.fullName}` : `${dir}/${entry.fullName}`;

              let bundleFiles: GitHubContentItem[];
              if (bundleListingCache.current.has(bundlePath)) {
                bundleFiles = bundleListingCache.current.get(bundlePath)!;
              } else {
                try {
                  bundleFiles = await getRepoFileTree(repoInfo.repoSourceId, repoInfo.owner, repoInfo.repo, repoInfo.branch, bundlePath);
                  bundleListingCache.current.set(bundlePath, bundleFiles);
                } catch {
                  logger.warn('[REPO METADATA] Bundle directory not found', { type, fullName: entry.fullName, bundlePath });
                  continue;
                }
              }

              for (const bundleFile of bundleFiles.filter((f) => f.type === 'file')) {
                const filePath = `${bundlePath}/${bundleFile.name}`;
                try {
                  const content = await getRepoFileContent(repoInfo.repoSourceId, repoInfo.owner, repoInfo.repo, repoInfo.branch, filePath);
                  results.push({
                    type,
                    createdById: '',
                    createdByName: '',
                    createdDate: '',
                    fullName: `${entry.fullName}/${bundleFile.name}`,
                    fileName: `${dir}/${entry.fullName}/${bundleFile.name}`,
                    id: '',
                    lastModifiedById: '',
                    lastModifiedByName: '',
                    lastModifiedDate: '',
                    content,
                  });
                } catch {
                  logger.warn('[REPO METADATA] Could not fetch bundle file', { type, filePath });
                }
              }
            }
          } else {
            // Flat types: fetch each file directly using multi-path probing.
            // After the first successful fetch, cache the discovered base path so
            // subsequent entries of the same type skip the probe round-trips.
            let cachedBasePath: string | undefined = basePathCache.current.has(dir)
              ? basePathCache.current.get(dir)!
              : undefined;

            for (const entry of entries) {
              const { base } = parseSalesforceFileName(entry.fileName);

              if (!base) {
                continue;
              }

              // Try the exact listMetadata filename first, then fall back to SFDX variants:
              //   1. <base>-meta.xml        — metadata-only types (NamedCredential, PermissionSet, etc.)
              //   2. <base_underscored>     — SFDX converts spaces to underscores (e.g. layouts)
              //   3. <base_underscored>-meta.xml — both transformations
              let result = await fetchFileDirect(repoInfo, dir, base, cachedBasePath);
              let usedMetaXmlFallback = false;

              if (!result) {
                const baseUnderscore = base.replace(/ /g, '_');
                const sfdxVariants = [`${base}-meta.xml`];
                if (baseUnderscore !== base) {
                  sfdxVariants.push(baseUnderscore, `${baseUnderscore}-meta.xml`);
                }

                for (const variant of sfdxVariants) {
                  result = await fetchFileDirect(repoInfo, dir, variant, cachedBasePath);
                  if (result) {
                    usedMetaXmlFallback = variant.endsWith('-meta.xml');
                    break;
                  }
                }
              }

              if (!result) {
                logger.warn('[REPO METADATA] File not found in repo', {
                  type,
                  fullName: entry.fullName,
                  dir,
                  base,
                  branch: repoInfo.branch,
                });
                continue;
              }

              // Persist the discovered base path for this dir
              if (cachedBasePath === undefined) {
                cachedBasePath = result.basePath;
                basePathCache.current.set(dir, result.basePath);
              }

              // Always use the original metadata-API fileName so buildTree can match source entries
              results.push({
                type,
                createdById: '',
                createdByName: '',
                createdDate: '',
                fullName: entry.fullName,
                fileName: `${dir}/${base}`,
                id: '',
                lastModifiedById: '',
                lastModifiedByName: '',
                lastModifiedDate: '',
                content: result.content,
              });

              // Fetch the -meta.xml companion if it exists (e.g., MyClass.cls-meta.xml alongside MyClass.cls),
              // but skip if we already used -meta.xml as the primary (to avoid double-counting)
              if (!usedMetaXmlFallback) {
                const metaXmlBase = `${base}-meta.xml`;
                const metaResult = await fetchFileDirect(repoInfo, dir, metaXmlBase, cachedBasePath);
                if (metaResult) {
                  results.push({
                    type,
                    createdById: '',
                    createdByName: '',
                    createdDate: '',
                    fullName: entry.fullName,
                    fileName: `${dir}/${metaXmlBase}`,
                    id: '',
                    lastModifiedById: '',
                    lastModifiedByName: '',
                    lastModifiedDate: '',
                    content: metaResult.content,
                  });
                }
              }
            }
          }
        }
      } catch (ex) {
        if (isMounted.current) {
          setError(getErrorMessage(ex));
        }
      } finally {
        if (isMounted.current) {
          setLoading(false);
        }
      }

      return results;
    },
    [fetchFileDirect, reset],
  );

  return { fetchRepoFiles, loading, error };
}
