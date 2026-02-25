import { JetstreamRepoSourceUi, JetstreamRepoUi } from '@jetstream/types';
import { githubOauthRefresh } from './oauth.service';

export async function getReposFromSource(source: JetstreamRepoSourceUi): Promise<JetstreamRepoUi[]> {
  switch (source.type) {
    case 'github':
      return getReposFromGithubSource(source);
  }
  throw new Error(`Unsupported source type: ${source.type}`);
}

interface GithubRepoResponse {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  description: string | null;
  owner: { login: string };
}

/**
 * Fetch all pages from a GitHub list endpoint.
 * GitHub uses Link headers for pagination; we request 100 items per page
 * and follow `rel="next"` links until there are no more pages.
 */
async function fetchAllGithubPages(initialUrl: string, accessToken: string): Promise<GithubRepoResponse[]> {
  const results: GithubRepoResponse[] = [];
  let nextUrl: string | null = initialUrl;

  while (nextUrl) {
    const response = await fetch(nextUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github+json',
      },
    });

    if (!response.ok) {
      throw new Error(`GitHub repos fetch failed: ${response.status} ${response.statusText}`);
    }

    const page: GithubRepoResponse[] = await response.json();
    results.push(...page);

    // Parse the Link header to find the next page URL
    const linkHeader = response.headers.get('Link');
    nextUrl = parseLinkHeaderNext(linkHeader);
  }

  return results;
}

/**
 * Extract the `rel="next"` URL from a GitHub Link response header.
 * Returns null when there are no more pages.
 */
function parseLinkHeaderNext(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
  return match ? match[1] : null;
}

async function getReposFromGithubSource(source: JetstreamRepoSourceUi): Promise<JetstreamRepoUi[]> {
  const { access_token } = await githubOauthRefresh(source);

  // Use the authenticated /user/repos endpoint with per_page=100 so that
  // organisation repos and private repos are included (not just the user's own
  // public repos, which is what the public /users/{login}/repos URL returns).
  const url = 'https://api.github.com/user/repos?per_page=100&affiliation=owner,collaborator,organization_member';
  const githubRepos = await fetchAllGithubPages(url, access_token);

  return githubRepos.map((githubRepo) => ({
    id: String(githubRepo.id),
    sourceId: source.id,
    source: source.type,
    userId: source.userId,
    userName: source.userName,
    path: githubRepo.full_name,
    label: githubRepo.name,
  }));
}
