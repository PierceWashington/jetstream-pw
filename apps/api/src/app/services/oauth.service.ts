import { JetstreamRepoSourceUi } from '@jetstream/types';
import { updateAccessToken_UNSAFE } from '../db/repo-source.db';
import { refreshGithubToken } from './github-oauth.service';

/**
 * Short-lived in-memory cache for refreshed access tokens.
 * Keyed by repo source ID. Avoids hammering the GitHub token refresh endpoint
 * when many parallel requests (e.g. per-file fetches during comparison) come in
 * for the same source within a short window.
 */
const tokenCache = new Map<string, { token: string; expiresAt: number }>();
/** Cache entries live for 7 hours — just under GitHub's 8-hour access token lifetime. */
const TOKEN_CACHE_TTL_MS = 7 * 60 * 60 * 1000;

/**
 * Returns a valid access token for a GitHub repo source.
 * The DB layer (repo-source.db.ts unwrap) decrypts the token on read,
 * so source.accessToken is already plaintext here.
 *
 * If the source has a refresh token (GitHub Apps with "Expire user authorization tokens"
 * enabled issue 8-hour tokens), this function proactively refreshes the access token
 * and caches it for TOKEN_CACHE_TTL_MS to avoid a refresh call per parallel request.
 * Falls back to the stored access token if refresh fails.
 */
export async function githubOauthRefresh(
  source: Pick<JetstreamRepoSourceUi, 'id' | 'accessToken' | 'refreshToken'>,
): Promise<{ access_token: string }> {
  if (!source.accessToken) {
    throw new Error('Repo source has no access token');
  }

  // No refresh token means the token doesn't expire — return as-is.
  if (!source.refreshToken) {
    return { access_token: source.accessToken };
  }

  // Return the in-memory cached token if it's still fresh.
  const cached = tokenCache.get(source.id);
  if (cached && cached.expiresAt > Date.now()) {
    return { access_token: cached.token };
  }

  try {
    const refreshed = await refreshGithubToken(source.refreshToken);
    // Persist the new token pair to the DB so the next server restart also has a valid token.
    await updateAccessToken_UNSAFE(source.id, refreshed.access_token, refreshed.refresh_token || source.refreshToken);
    // Cache the new access token.
    tokenCache.set(source.id, { token: refreshed.access_token, expiresAt: Date.now() + TOKEN_CACHE_TTL_MS });
    return { access_token: refreshed.access_token };
  } catch {
    // If refresh fails (e.g. refresh token also expired or network error),
    // fall back to the stored token and hope it's still valid.
    return { access_token: source.accessToken };
  }
}
