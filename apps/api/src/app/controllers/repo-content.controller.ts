import { z } from 'zod';
import * as repoSourceDb from '../db/repo-source.db';
import { BatchCommitFile, commitFile, commitFiles, createBranch, getBranches, getFileContent, getFileTree } from '../services/repo-content.service';
import { githubOauthRefresh } from '../services/oauth.service';
import { UserFacingError } from '../utils/error-handler';
import { sendJson } from '../utils/response.handlers';
import { createRoute } from '../utils/route.utils';

/** Shared query params required by all repo-content endpoints */
const repoQueryParams = z.object({
  repoSourceId: z.string().min(1),
  owner: z.string().min(1),
  repo: z.string().min(1),
});

export const routeDefinition = {
  getBranches: {
    controllerFn: () => getBranchesHandler,
    validators: {
      query: repoQueryParams,
      hasSourceOrg: false,
    },
  },
  getFileTree: {
    controllerFn: () => getFileTreeHandler,
    validators: {
      query: repoQueryParams.extend({
        branch: z.string().min(1),
        path: z.string().optional().default(''),
      }),
      hasSourceOrg: false,
    },
  },
  getFileContent: {
    controllerFn: () => getFileContentHandler,
    validators: {
      query: repoQueryParams.extend({
        branch: z.string().min(1),
        path: z.string().min(1),
      }),
      hasSourceOrg: false,
    },
  },
  commitFile: {
    controllerFn: () => commitFileHandler,
    validators: {
      body: z.object({
        repoSourceId: z.string().min(1),
        owner: z.string().min(1),
        repo: z.string().min(1),
        branch: z.string().min(1),
        path: z.string().min(1),
        content: z.string(),
        message: z.string().min(1),
        sha: z.string().optional(),
      }),
      hasSourceOrg: false,
    },
  },
  createBranch: {
    controllerFn: () => createBranchHandler,
    validators: {
      body: z.object({
        repoSourceId: z.string().min(1),
        owner: z.string().min(1),
        repo: z.string().min(1),
        newBranch: z.string().min(1),
        sourceBranch: z.string().min(1),
      }),
      hasSourceOrg: false,
    },
  },
  commitFiles: {
    controllerFn: () => commitFilesHandler,
    validators: {
      body: z.object({
        repoSourceId: z.string().min(1),
        owner: z.string().min(1),
        repo: z.string().min(1),
        branch: z.string().min(1),
        message: z.string().min(1),
        files: z.array(z.object({ path: z.string().min(1), content: z.string() })).min(1),
      }),
      hasSourceOrg: false,
    },
  },
};

/**
 * Resolve a valid access token for the given repo source.
 * Decrypts the stored token and, if a refresh token is present (GitHub Apps with
 * token expiry enabled), proactively refreshes it via githubOauthRefresh which
 * caches the result to avoid per-request refresh storms.
 */
async function resolveAccessToken(jetstreamUserId: string, repoSourceId: string): Promise<string> {
  const source = await repoSourceDb.findByUniqueId(jetstreamUserId, repoSourceId);
  if (!source) {
    throw new UserFacingError('Repo source not found');
  }
  const { access_token } = await githubOauthRefresh(source);
  return access_token;
}

const getBranchesHandler = createRoute(routeDefinition.getBranches.validators, async ({ query, user }, _req, res, next) => {
  try {
    const accessToken = await resolveAccessToken(user.id, query.repoSourceId);
    const branches = await getBranches(accessToken, query.owner, query.repo);
    sendJson(res, branches);
  } catch (ex) {
    next(new UserFacingError(ex));
  }
});

const getFileTreeHandler = createRoute(routeDefinition.getFileTree.validators, async ({ query, user }, _req, res, next) => {
  try {
    const accessToken = await resolveAccessToken(user.id, query.repoSourceId);
    const tree = await getFileTree(accessToken, query.owner, query.repo, query.branch, query.path);
    sendJson(res, tree);
  } catch (ex) {
    next(new UserFacingError(ex));
  }
});

const getFileContentHandler = createRoute(routeDefinition.getFileContent.validators, async ({ query, user }, _req, res, next) => {
  try {
    const accessToken = await resolveAccessToken(user.id, query.repoSourceId);
    const content = await getFileContent(accessToken, query.owner, query.repo, query.branch, query.path);
    sendJson(res, { content });
  } catch (ex) {
    next(new UserFacingError(ex));
  }
});

const commitFileHandler = createRoute(routeDefinition.commitFile.validators, async ({ body, user }, _req, res, next) => {
  try {
    const accessToken = await resolveAccessToken(user.id, body.repoSourceId);
    const result = await commitFile({
      accessToken,
      owner: body.owner,
      repo: body.repo,
      branch: body.branch,
      path: body.path,
      content: body.content,
      message: body.message,
      sha: body.sha,
    });
    sendJson(res, result, 201);
  } catch (ex) {
    next(new UserFacingError(ex));
  }
});

const createBranchHandler = createRoute(routeDefinition.createBranch.validators, async ({ body, user }, _req, res, next) => {
  try {
    const accessToken = await resolveAccessToken(user.id, body.repoSourceId);
    const branch = await createBranch(accessToken, body.owner, body.repo, body.newBranch, body.sourceBranch);
    sendJson(res, branch, 201);
  } catch (ex) {
    next(new UserFacingError(ex));
  }
});

const commitFilesHandler = createRoute(routeDefinition.commitFiles.validators, async ({ body, user }, _req, res, next) => {
  try {
    const accessToken = await resolveAccessToken(user.id, body.repoSourceId);
    const result = await commitFiles(accessToken, body.owner, body.repo, body.branch, body.message, body.files as BatchCommitFile[]);
    sendJson(res, result, 201);
  } catch (ex) {
    next(new UserFacingError(ex));
  }
});
