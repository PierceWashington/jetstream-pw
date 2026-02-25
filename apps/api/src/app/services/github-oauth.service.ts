import { ENV } from '@jetstream/api-config';

const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';

export interface GithubTokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
  /** Present when the GitHub App has "Expire user authorization tokens" enabled (8-hour expiry). */
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
}

/**
 * Build the GitHub OAuth authorization URL.
 * The user is redirected here to grant access.
 *
 * @param state - An opaque string stored in the session to prevent CSRF
 */
export function getAuthorizationUrl(state: string): string {
  const url = new URL(GITHUB_AUTHORIZE_URL);
  url.searchParams.set('client_id', ENV.GITHUB_CLIENT_ID);
  url.searchParams.set('redirect_uri', ENV.GITHUB_CALLBACK_URL);
  url.searchParams.set('scope', 'repo read:user');
  url.searchParams.set('state', state);
  return url.toString();
}

/**
 * Exchange a GitHub OAuth authorization code for an access token.
 *
 * @param code - The code received in the OAuth callback query parameter
 * @param state - The state value from the callback to validate against session
 */
export async function exchangeCodeForToken(code: string): Promise<GithubTokenResponse> {
  const response = await fetch(GITHUB_TOKEN_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: ENV.GITHUB_CLIENT_ID,
      client_secret: ENV.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: ENV.GITHUB_CALLBACK_URL,
    }),
  });

  if (!response.ok) {
    throw new Error(`GitHub token exchange failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  if (data.error) {
    throw new Error(`GitHub OAuth error: ${data.error_description || data.error}`);
  }

  return data as GithubTokenResponse;
}

/**
 * Refresh a GitHub OAuth access token using a refresh token.
 * Only applies when the GitHub App has "Expire user authorization tokens" enabled.
 * Refresh tokens themselves are valid for 6 months.
 */
export async function refreshGithubToken(refreshToken: string): Promise<GithubTokenResponse> {
  const response = await fetch(GITHUB_TOKEN_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: ENV.GITHUB_CLIENT_ID,
      client_secret: ENV.GITHUB_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    throw new Error(`GitHub token refresh failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  if (data.error) {
    throw new Error(`GitHub OAuth refresh error: ${data.error_description || data.error}`);
  }

  return data as GithubTokenResponse;
}

/**
 * Fetch the authenticated GitHub user's profile.
 * Used to populate userId and userName after OAuth.
 */
export async function getGithubUserProfile(accessToken: string): Promise<{ id: number; login: string; name: string; repos_url: string }> {
  const response = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub user profile fetch failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
}
