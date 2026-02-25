import express, { Router } from 'express';
import { routeDefinition as githubOauthController } from '../controllers/github-oauth.controller';
import { routeDefinition as oauthController } from '../controllers/oauth.controller';
import { checkAuth } from './route.middleware';

export const routes: express.Router = Router();

// salesforce org authentication
routes.get('/sfdc/auth', checkAuth, oauthController.salesforceOauthInitAuth.controllerFn());
routes.get('/sfdc/callback', checkAuth, oauthController.salesforceOauthCallback.controllerFn());

// GitHub repo source authentication
routes.get('/github/auth', checkAuth, githubOauthController.githubOauthInitAuth.controllerFn());
routes.get('/github/callback', checkAuth, githubOauthController.githubOauthCallback.controllerFn());

export default routes;
