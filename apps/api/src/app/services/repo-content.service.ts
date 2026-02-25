/**
 * GitHub API client functions for repository content operations.
 * Each function accepts a raw access token (already decrypted) and repo coordinates.
 */

const GITHUB_API_BASE = 'https://api.github.com';

function githubHeaders(accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

async function githubFetch(url: string, accessToken: string, options: RequestInit = {}): Promise<Response> {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...githubHeaders(accessToken),
      ...(options.headers as Record<string, string>),
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`GitHub API error ${response.status}: ${body || response.statusText}`);
  }
  return response;
}

export interface GitHubBranch {
  name: string;
  commit: { sha: string; url: string };
  protected: boolean;
}

export interface GitHubContentItem {
  type: 'file' | 'dir' | 'symlink' | 'submodule';
  name: string;
  path: string;
  sha: string;
  size: number;
  url: string;
  html_url: string;
  git_url: string;
  download_url: string | null;
  content?: string;
  encoding?: string;
}

/**
 * List all branches for a repository (up to 100).
 */
export async function getBranches(accessToken: string, owner: string, repo: string): Promise<GitHubBranch[]> {
  const url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches?per_page=100`;
  const response = await githubFetch(url, accessToken);
  return response.json();
}

/**
 * Get the file/directory listing at the given path and branch.
 * Returns an array of content items (files and subdirectories).
 */
export async function getFileTree(
  accessToken: string,
  owner: string,
  repo: string,
  branch: string,
  path: string,
): Promise<GitHubContentItem[]> {
  const encodedPath = path ? encodeURIComponent(path).replace(/%2F/g, '/') : '';
  const url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`;
  const response = await githubFetch(url, accessToken);
  const data = await response.json();
  // GitHub returns an array for directories, a single object for files
  return Array.isArray(data) ? data : [data];
}

/**
 * Get the decoded text content of a single file.
 */
export async function getFileContent(
  accessToken: string,
  owner: string,
  repo: string,
  branch: string,
  path: string,
): Promise<string> {
  const encodedPath = encodeURIComponent(path).replace(/%2F/g, '/');
  const url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`;
  const response = await githubFetch(url, accessToken);
  const data: GitHubContentItem = await response.json();
  if (data.encoding === 'base64' && data.content) {
    return Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString('utf-8');
  }
  throw new Error(`Unexpected content encoding: ${data.encoding}`);
}

/**
 * Create a new branch from an existing branch.
 * Looks up the source branch's current HEAD SHA and uses it as the starting point.
 */
export async function createBranch(
  accessToken: string,
  owner: string,
  repo: string,
  newBranchName: string,
  sourceBranchName: string,
): Promise<GitHubBranch> {
  // Resolve the SHA of the source branch HEAD
  const refUrl = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/refs/heads/${encodeURIComponent(sourceBranchName)}`;
  const refData = await githubFetch(refUrl, accessToken).then((r) => r.json());
  const sourceSha: string = refData.object.sha;

  // Create the new branch ref
  const createUrl = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/refs`;
  const result = await githubFetch(createUrl, accessToken, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: `refs/heads/${newBranchName}`, sha: sourceSha }),
  }).then((r) => r.json());

  return { name: newBranchName, commit: { sha: result.object.sha, url: result.object.url }, protected: false };
}

export interface BatchCommitFile {
  /** Repo-relative file path (e.g. "classes/MyClass.cls") */
  path: string;
  /** UTF-8 text content */
  content: string;
}

/**
 * Create a single atomic commit containing multiple files via the Git Tree API.
 * Much more efficient than committing files one at a time.
 */
export async function commitFiles(
  accessToken: string,
  owner: string,
  repo: string,
  branch: string,
  message: string,
  files: BatchCommitFile[],
): Promise<{ sha: string; html_url: string }> {
  const enc = encodeURIComponent;
  const base = `${GITHUB_API_BASE}/repos/${enc(owner)}/${enc(repo)}`;

  // 1. Get the current HEAD commit SHA of the branch
  const headData = await githubFetch(`${base}/git/refs/heads/${enc(branch)}`, accessToken).then((r) => r.json());
  const latestCommitSha: string = headData.object.sha;

  // 2. Get the tree SHA of the HEAD commit
  const commitData = await githubFetch(`${base}/git/commits/${latestCommitSha}`, accessToken).then((r) => r.json());
  const baseTreeSha: string = commitData.tree.sha;

  // 3. Create a new tree with all files on top of the existing tree
  const treeData = await githubFetch(`${base}/git/trees`, accessToken, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      base_tree: baseTreeSha,
      tree: files.map(({ path, content }) => ({ path, mode: '100644', type: 'blob', content })),
    }),
  }).then((r) => r.json());

  // 4. Create a commit pointing to the new tree
  const newCommitData = await githubFetch(`${base}/git/commits`, accessToken, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, tree: treeData.sha, parents: [latestCommitSha] }),
  }).then((r) => r.json());

  // 5. Move the branch ref forward to the new commit
  await githubFetch(`${base}/git/refs/heads/${enc(branch)}`, accessToken, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sha: newCommitData.sha }),
  });

  return { sha: newCommitData.sha, html_url: newCommitData.html_url };
}

export interface CommitFileOptions {
  accessToken: string;
  owner: string;
  repo: string;
  branch: string;
  path: string;
  content: string;
  message: string;
  /** SHA of the existing blob if updating; omit for new files */
  sha?: string;
}

export interface CommitFileResult {
  content: GitHubContentItem;
  commit: { sha: string; message: string; html_url: string };
}

/**
 * Create or update a single file in a repository via a commit.
 * Content is automatically base64-encoded before sending to the GitHub API.
 */
export async function commitFile(options: CommitFileOptions): Promise<CommitFileResult> {
  const { accessToken, owner, repo, branch, path, content, message, sha } = options;
  const encodedPath = encodeURIComponent(path).replace(/%2F/g, '/');
  const url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath}`;

  const body: Record<string, unknown> = {
    message,
    content: Buffer.from(content, 'utf-8').toString('base64'),
    branch,
  };
  if (sha) {
    body.sha = sha;
  }

  const response = await githubFetch(url, accessToken, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return response.json();
}
