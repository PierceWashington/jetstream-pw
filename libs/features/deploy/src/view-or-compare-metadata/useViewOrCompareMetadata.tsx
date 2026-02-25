import { METADATA_TYPES_WITH_FOLDERS } from '@jetstream/shared/constants';
import { retrieveMetadataFromListMetadata } from '@jetstream/shared/data';
import { pollRetrieveMetadataResultsUntilDone, useBrowserNotifications } from '@jetstream/shared/ui-utils';
import { getErrorMessage } from '@jetstream/shared/utils';
import { ListMetadataResult, MetadataEndpoint, SalesforceOrgUi } from '@jetstream/types';
import { TreeItems } from '@jetstream/ui';
import { applicationCookieState } from '@jetstream/ui/app-state';
import { useAtom } from 'jotai';
import JSZip from 'jszip';
import isString from 'lodash/isString';
import { useCallback, useEffect, useReducer, useRef } from 'react';
import { RepoInfo, useRepoMetadata } from '../hooks/useRepoMetadata';
import { FileItemMetadata, FilePropertiesWithContent, OrgType } from './viewOrCompareMetadataTypes';
import { buildTree, populateFileContents } from './viewOrCompareMetadataUtils';

type LoadStatus = 'Not Started' | 'Loading' | 'Success' | 'Failed';

type Action =
  | { type: 'FETCH'; payload: { which: OrgType } }
  | { type: 'LAST_CHECKED'; payload: { which: OrgType } }
  | { type: 'FETCH_SUCCESS'; payload: { which: OrgType; data: JSZip | null; fileProperties: FilePropertiesWithContent[] } }
  | { type: 'FETCH_ERROR'; payload: { which: OrgType; error: string } };

interface State {
  sourceLoading: boolean;
  sourceStatus: LoadStatus;
  sourceLastChecked: Date | null;
  sourceResults: JSZip | null;
  sourceResultFiles: FilePropertiesWithContent[] | null;
  sourceError?: string | null;

  targetLoading: boolean;
  targetStatus: LoadStatus;
  targetLastChecked: Date | null;
  targetResults: JSZip | null;
  targetResultFiles: FilePropertiesWithContent[] | null;
  targetError?: string | null;

  files: TreeItems<FileItemMetadata | null>[];
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'FETCH': {
      if (action.payload.which === 'SOURCE') {
        return {
          ...state,
          sourceLoading: true,
          sourceStatus: 'Loading',
          sourceLastChecked: new Date(),
          sourceResults: null,
          targetLoading: false,
          targetStatus: 'Not Started',
          targetResults: null,
          targetResultFiles: null,
        };
      } else {
        let files = state.files;
        // if target was changed, clear out prior target comparison data
        if (state.targetResults || state.targetResultFiles) {
          files = buildTree(state.sourceResultFiles, undefined);
        }
        return {
          ...state,
          targetLoading: true,
          targetStatus: 'Loading',
          targetLastChecked: new Date(),
          targetResults: null,
          files,
        };
      }
    }
    case 'LAST_CHECKED': {
      if (action.payload.which === 'SOURCE') {
        return { ...state, sourceLastChecked: new Date() };
      } else {
        return { ...state, targetLastChecked: new Date() };
      }
    }
    case 'FETCH_SUCCESS': {
      if (action.payload.which === 'SOURCE') {
        return {
          ...state,
          sourceLoading: false,
          sourceStatus: 'Success',
          sourceResults: action.payload.data,
          sourceResultFiles: action.payload.fileProperties,
          files: buildTree(action.payload.fileProperties, state.targetResultFiles),
          sourceLastChecked: null,
        };
      } else {
        return {
          ...state,
          targetLoading: false,
          targetStatus: 'Success',
          targetResults: action.payload.data,
          targetResultFiles: action.payload.fileProperties,
          files: buildTree(state.sourceResultFiles, action.payload.fileProperties),
          targetLastChecked: null,
        };
      }
    }
    case 'FETCH_ERROR':
      if (action.payload.which === 'SOURCE') {
        return {
          ...state,
          sourceLoading: false,
          sourceStatus: 'Failed',
          sourceError: action.payload.error,
          sourceLastChecked: null,
        };
      } else {
        return {
          ...state,
          targetLoading: false,
          targetStatus: 'Failed',
          targetError: action.payload.error,
          targetLastChecked: null,
        };
      }
    default:
      throw new Error('Invalid action');
  }
}

export function useViewOrCompareMetadata({ selectedMetadata }: { selectedMetadata: Record<string, ListMetadataResult[]> }) {
  const isMounted = useRef(true);

  const [
    {
      sourceLoading,
      sourceStatus,
      sourceLastChecked,
      sourceResults,
      sourceResultFiles,
      sourceError,
      targetLoading,
      targetStatus,
      targetLastChecked,
      targetResults,
      targetResultFiles,
      targetError,
      files,
    },
    dispatch,
  ] = useReducer(reducer, {
    sourceLoading: false,
    sourceStatus: 'Not Started',
    sourceResults: null,
    sourceResultFiles: null,
    sourceError: null,
    sourceLastChecked: null,
    targetLoading: false,
    targetStatus: 'Not Started',
    targetResults: null,
    targetResultFiles: null,
    targetError: null,
    targetLastChecked: null,
    files: [],
  });
  const [{ serverUrl }] = useAtom(applicationCookieState);
  const { notifyUser } = useBrowserNotifications(serverUrl);
  const { fetchRepoFiles } = useRepoMetadata();

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  /** Fetch metadata from a Salesforce org */
  const fetchOrgMetadata = useCallback(
    async (org: SalesforceOrgUi, which: OrgType) => {
      dispatch({ type: 'FETCH', payload: { which } });

      try {
        const id = (await retrieveMetadataFromListMetadata(org, selectedMetadata)).id;

        const results = await pollRetrieveMetadataResultsUntilDone(org, id, {
          onChecked: () => {
            if (isMounted.current) {
              dispatch({ type: 'LAST_CHECKED', payload: { which } });
            }
          },
        });

        if (isMounted.current) {
          if (isString(results.zipFile)) {
            const salesforcePackage = await JSZip.loadAsync(results.zipFile, { base64: true });
            // Add folder file extension so that the metadata shows up
            (results.fileProperties || []).forEach((file) => {
              // Folders don't have a suffix in the fileProperties response, but there is an associated file, so we must add the extension
              if (METADATA_TYPES_WITH_FOLDERS.has(file.type) && file.fileName.includes('/') && !file.fileName.includes('.')) {
                file.fileName = `${file.fileName}-meta.xml`;
              }
            });

            await populateFileContents(salesforcePackage, results.fileProperties || []);

            dispatch({ type: 'FETCH_SUCCESS', payload: { which, data: salesforcePackage, fileProperties: results.fileProperties } });
            notifyUser('Your metadata is ready to view', { tag: 'view-or-compare' });
          } else {
            throw new Error(results.errorMessage || 'No data was returned from Salesforce');
          }
        }
      } catch (ex) {
        notifyUser('There was an error obtaining metadata', { body: getErrorMessage(ex), tag: 'view-or-compare' });
        dispatch({ type: 'FETCH_ERROR', payload: { which, error: getErrorMessage(ex) } });
      }
    },
    [notifyUser, selectedMetadata],
  );

  /** Fetch metadata from a GitHub repo */
  const fetchRepoMetadata = useCallback(
    async (repoInfo: RepoInfo, which: OrgType) => {
      dispatch({ type: 'FETCH', payload: { which } });

      try {
        const fileProperties = await fetchRepoFiles(repoInfo, selectedMetadata);

        if (isMounted.current) {
          dispatch({ type: 'FETCH_SUCCESS', payload: { which, data: null, fileProperties } });
          notifyUser('Your metadata is ready to view', { tag: 'view-or-compare' });
        }
      } catch (ex) {
        notifyUser('There was an error obtaining metadata from the repository', { body: getErrorMessage(ex), tag: 'view-or-compare' });
        dispatch({ type: 'FETCH_ERROR', payload: { which, error: getErrorMessage(ex) } });
      }
    },
    [fetchRepoFiles, notifyUser, selectedMetadata],
  );

  /**
   * Fetch metadata from either an org or a repo endpoint.
   * Pass a `SalesforceOrgUi` directly for backwards compatibility with org-only usage,
   * or pass a `MetadataEndpoint` to support both org and repo sources.
   */
  const fetchMetadata = useCallback(
    async (endpoint: SalesforceOrgUi | MetadataEndpoint, which: OrgType) => {
      if ('uniqueId' in endpoint) {
        // Backwards-compatible: plain SalesforceOrgUi passed directly
        await fetchOrgMetadata(endpoint as SalesforceOrgUi, which);
      } else if (endpoint.type === 'ORG') {
        await fetchOrgMetadata(endpoint.org, which);
      } else {
        const { repo, branch } = endpoint;
        const [owner, repoName] = repo.path.split('/');
        if (owner && repoName) {
          await fetchRepoMetadata({ repoSourceId: repo.sourceId, owner, repo: repoName, branch }, which);
        } else {
          dispatch({ type: 'FETCH_ERROR', payload: { which, error: 'Invalid repository path — expected "owner/repo" format' } });
        }
      }
    },
    [fetchOrgMetadata, fetchRepoMetadata],
  );

  return {
    fetchMetadata,
    sourceLoading,
    sourceStatus,
    sourceLastChecked,
    sourceResults,
    sourceResultFiles,
    sourceError,
    targetLoading,
    targetStatus,
    targetLastChecked,
    targetResults,
    targetResultFiles,
    targetError,
    files,
  };
}
