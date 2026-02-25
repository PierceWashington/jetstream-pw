import { ENV } from '@jetstream/api-config';
import * as repoSourceDb from '../db/repo-source.db';
import { exchangeCodeForToken, getAuthorizationUrl, getGithubUserProfile } from '../services/github-oauth.service';
import { createRoute } from '../utils/route.utils';
import { z } from 'zod';

const GITHUB_STATE_SESSION_KEY = 'githubOauthState';

export const routeDefinition = {
  githubOauthInitAuth: {
    controllerFn: () => githubOauthInitAuth,
    validators: { hasSourceOrg: false },
  },
  githubOauthCallback: {
    controllerFn: () => githubOauthCallback,
    validators: {
      query: z.object({
        code: z.string().optional(),
        state: z.string().optional(),
        error: z.string().optional(),
        error_description: z.string().optional(),
      }),
      hasSourceOrg: false,
    },
  },
};

/**
 * Redirect the user to GitHub to authorize the Jetstream app.
 */
const githubOauthInitAuth = createRoute(routeDefinition.githubOauthInitAuth.validators, async ({ user }, req, res) => {
  const state = crypto.randomUUID();
  req.session['githubOauth'] = { state };
  const authorizationUrl = getAuthorizationUrl(state);
  res.redirect(authorizationUrl);
});

/**
 * Handle the GitHub OAuth callback, exchange the code for a token,
 * save the repo source, and redirect back to the app.
 */
const githubOauthCallback = createRoute(routeDefinition.githubOauthCallback.validators, async ({ query, user }, req, res) => {
  const clientUrl = new URL(ENV.JETSTREAM_CLIENT_URL).origin;

  try {
    const savedState = req.session['githubOauth']?.state;
    req.session['githubOauth'] = undefined;

    if (query.error) {
      return res.redirect(
        `${clientUrl}/oauth-link/?${new URLSearchParams({ type: 'github', error: query.error, message: query.error_description || '' }).toString()}`,
      );
    }

    if (!query.code || !query.state) {
      return res.redirect(
        `${clientUrl}/oauth-link/?${new URLSearchParams({ type: 'github', error: 'missing_params', message: 'Authorization code or state is missing.' }).toString()}`,
      );
    }

    if (query.state !== savedState) {
      return res.redirect(
        `${clientUrl}/oauth-link/?${new URLSearchParams({ type: 'github', error: 'state_mismatch', message: 'OAuth state mismatch — please try again.' }).toString()}`,
      );
    }

    const tokenResponse = await exchangeCodeForToken(query.code);
    const { access_token } = tokenResponse;
    const profile = await getGithubUserProfile(access_token);

    // Store the refresh token when present (GitHub Apps with token expiry enabled return one).
    // Stored as empty string for classic OAuth Apps whose tokens don't expire.
    const encryptedToken = repoSourceDb.encryptAccessToken(access_token, tokenResponse.refresh_token || '');

    const savedSource = await repoSourceDb.createOrUpdateRepoSource(user.id, {
      type: 'github',
      userId: String(profile.id),
      userName: profile.login,
      accessToken: encryptedToken,
      // Use the authenticated /user/repos endpoint; profile.repos_url is the
      // public /users/{login}/repos URL which omits org repos and private repos.
      resourceUrls: { repositories: 'https://api.github.com/user/repos' },
    });

    // Retrieve the saved source (unwrapped) so we can send safe (token-free) data
    // back to the frontend popup via the landing page postMessage mechanism.
    // The landing page reads `clientUrl` and `data` params to do:
    //   window.opener.postMessage(decodeURIComponent(data), clientUrl)
    // which addRepoSource.ts parses as { type, data: JetstreamRepoSourceUi }.
    const sourceUi = await repoSourceDb.findByUniqueId(user.id, savedSource.id);
    const { accessToken: _accessToken, ...safeSourceUi } = sourceUi ?? {};
    const returnData = JSON.stringify({ type: 'github', data: safeSourceUi });

    return res.redirect(
      `${clientUrl}/oauth-link/?${new URLSearchParams({ type: 'github', clientUrl, data: returnData }).toString()}`,
    );
  } catch (ex) {
    return res.redirect(
      `${clientUrl}/oauth-link/?${new URLSearchParams({ type: 'github', error: 'server_error', message: ex.message || 'An unexpected error occurred.' }).toString()}`,
    );
  }
});
