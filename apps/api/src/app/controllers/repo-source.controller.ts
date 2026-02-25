import { z } from 'zod';
import * as repoSourceDb from '../db/repo-source.db';
import { githubOauthRefresh } from '../services/oauth.service';
import { UserFacingError } from '../utils/error-handler';
import { sendJson } from '../utils/response.handlers';
import { createRoute } from '../utils/route.utils';

export const routeDefinition = {
  getRepoSources: {
    controllerFn: () => getRepoSources,
    validators: { hasSourceOrg: false },
  },
  /*
  updateRepoSource: {
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
  */
  getRepoSourceById: {
    controllerFn: () => getRepoSourceById,
    validators: {
      params: z.object({
        id: z.string().min(1),
      }),
      hasSourceOrg: false,
    },
  },
  deleteRepoSource: {
    controllerFn: () => deleteRepoSource,
    validators: {
      params: z.object({
        id: z.string().min(1),
      }),
      hasSourceOrg: false,
    },
  },
};

const getRepoSources = createRoute(routeDefinition.getRepoSources.validators, async ({ user }, req, res, next) => {
  try {
    const sources = await repoSourceDb.findByUserId(user.id);
    sendJson(
      res,
      await Promise.all(
        sources.map(async (source) => {
          const { access_token } = await githubOauthRefresh(source);
          return {
            ...source,
            accessToken: access_token,
          };
        })
      )
    );
  } catch (ex) {
    next(new UserFacingError(ex));
  }
});
/*
const updateRepoSource = createRoute(routeDefinition.updateRepoSource.validators, async ({ body, params, user }, req, res, next) => {
  try {
    const data = { label: body.label, color: body.color };
    const repo = await repoSourceDb.updateRepoSource(user.id, params.id, data);

    sendJson(res, repo, 201);
  } catch (ex) {
    next(new UserFacingError(ex));
  }
});
*/

const deleteRepoSource = createRoute(routeDefinition.deleteRepoSource.validators, async ({ params, user }, req, res, next) => {
  try {
    repoSourceDb.deleteRepoSource(user.id, params.id);

    sendJson(res, undefined, 204);
  } catch (ex) {
    next(new UserFacingError(ex));
  }
});

const getRepoSourceById = createRoute(routeDefinition.getRepoSourceById.validators, async ({ params, user }, req, res, next) => {
  try {
    const repo = await repoSourceDb.findByUniqueId(user.id, params.id);
    sendJson(res, repo);
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
