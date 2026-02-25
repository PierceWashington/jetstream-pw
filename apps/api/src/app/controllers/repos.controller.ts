import { z } from 'zod';
import * as repoSourcesDb from '../db/repo-source.db';
import * as reposDb from '../db/repo.db';
import { getReposFromSource } from '../services/repos.service';
import { UserFacingError } from '../utils/error-handler';
import { sendJson } from '../utils/response.handlers';
import { createRoute } from '../utils/route.utils';

export const routeDefinition = {
  getRepos: {
    controllerFn: () => getRepos,
    validators: { hasSourceOrg: false },
  },
  updateRepo: {
    controllerFn: () => updateRepo,
    validators: {
      params: z.object({
        id: z.string().min(1),
      }),
      body: z.object({
        label: z.string(),
        color: z.string().nullish(),
      }),
      hasSourceOrg: false,
    },
  },
  deleteRepo: {
    controllerFn: () => deleteRepo,
    validators: {
      params: z.object({
        id: z.string().min(1),
      }),
      hasSourceOrg: false,
    },
  },
};

const getRepos = createRoute(routeDefinition.getRepos.validators, async ({ user }, req, res, next) => {
  try {
    const dbRepos = await reposDb.findByUserId(user.id);
    // Use allSettled so a 401/error on one source doesn't prevent other sources from loading
    const repoResults = await Promise.allSettled(
      (await repoSourcesDb.findByUserId(user.id)).map((source) => getReposFromSource(source)),
    );
    const repos = repoResults.flatMap((result) => {
      if (result.status === 'rejected') {
        req.log?.warn({ error: result.reason?.message }, '[REPOS] Failed to fetch repos from source');
        return [];
      }
      return result.value;
    });
    dbRepos.forEach((repo) => {
      const foundRepoIdx = repos.findIndex((r) => r.id === repo.id);
      if (foundRepoIdx > -1) {
        repos[foundRepoIdx] = {
          ...repos[foundRepoIdx],
          ...repo,
        };
      }
    });

    sendJson(res, repos);
  } catch (ex) {
    next(new UserFacingError(ex));
  }
});

const updateRepo = createRoute(routeDefinition.updateRepo.validators, async ({ body, params, user }, req, res, next) => {
  try {
    const data = { label: body.label, color: body.color };
    const repo = await reposDb.updateRepo(user.id, params.id, data);

    sendJson(res, repo, 201);
  } catch (ex) {
    next(new UserFacingError(ex));
  }
});

const deleteRepo = createRoute(routeDefinition.deleteRepo.validators, async ({ params, user }, req, res, next) => {
  try {
    reposDb.deleteRepo(user.id, params.id);

    sendJson(res, undefined, 204);
  } catch (ex) {
    next(new UserFacingError(ex));
  }
});

/**
 * Check if the org is still valid
 * This can be used to retry an org that has been marked as invalid
 */
/*
const checkOrgHealth = createRoute(routeDefinition.checkOrgHealth.validators, async ({ jetstreamConn, org }, req, res, next) => {
  try {
    let connectionError = org.connectionError;

    try {
      await jetstreamConn.org.identity();
      connectionError = null;
      req.log.warn('[ORG CHECK][VALID ORG][IDENTITY]');
    } catch (ex) {
      connectionError = ERROR_MESSAGES.SFDC_EXPIRED_TOKEN;
      req.log.warn(getExceptionLog(ex), '[ORG CHECK][INVALID ORG] %s', ex.message);
    }

    // Ensure full API access, identity API works even without API access
    if (!connectionError) {
      // ensure api access is enabled
      try {
        await jetstreamConn.query.query<SObjectOrganization>(`SELECT Id, TrialExpirationDate FROM Organization`);
        connectionError = null;
        req.log.warn('[ORG CHECK][VALID ORG][API ACCESS]');
      } catch (ex) {
        if (ex instanceof ApiRequestError && ERROR_MESSAGES.SFDC_REST_API_NOT_ENABLED.test(ex.message)) {
          connectionError = ERROR_MESSAGES.SFDC_REST_API_NOT_ENABLED_MSG;
          req.log.warn(getExceptionLog(ex), '[ORG CHECK][INVALID ORG] %s', ex.message);
        }
      }
    }

    try {
      if (connectionError !== org.connectionError) {
        await salesforceOrgsDb.updateOrg_UNSAFE(org, { connectionError });
      }
    } catch (ex) {
      req.log.warn({ orgId: org?.id, ...getExceptionLog(ex) }, '[ERROR UPDATING INVALID ORG] %s', ex.message);
    }

    if (connectionError) {
      throw new UserFacingError('Your org is no longer valid. Reconnect this org to Salesforce.');
    }

    sendJson(res, undefined, 200);
  } catch (ex) {
    next(new UserFacingError(ex));
  }
});

const moveOrg = createRoute(routeDefinition.moveOrg.validators, async ({ body, params, user }, req, res, next) => {
  try {
    const { uniqueId } = params;
    const salesforceOrg = await salesforceOrgsDb.moveSalesforceOrg(user.id, uniqueId, body);

    sendJson(res, salesforceOrg, 201);
  } catch (ex) {
    next(new UserFacingError(ex));
  }
});
*/
