import { JetstreamRepoUi, SalesforceOrgUi } from '../types';

export type EndpointType = 'SOURCE' | 'TARGET';
export type MetadataEndpoint =
  | {
      type: 'ORG';
      org: SalesforceOrgUi;
    }
  | {
      type: 'REPO';
      repo: JetstreamRepoUi;
      branch: string;
    };
