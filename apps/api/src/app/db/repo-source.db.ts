/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { ENV, prisma } from '@jetstream/api-config';
import { decryptString, encryptString, hexToBase64 } from '@jetstream/shared/node-utils';
import { JetstreamRepoSourceUi, JetstreamRepoUi, Maybe, RepoSource } from '@jetstream/types';
import { Prisma, RepositorySource, RepositorySourceType } from '@jetstream/prisma';

const SELECT: Prisma.RepositorySourceSelect = {
  id: true,
  jetstreamUserId: true,
  jetstreamOrganizationId: true,
  type: true,
  userId: true,
  userName: true,
  description: true,
  accessToken: true,
  createdAt: true,
  updatedAt: true,
  resourceUrl_repos: true,
};

export const REPO_SELECT = SELECT;

/**
 * TODO: add better error handling with non-db error messages!
 */

const findUniqueRepoSource = ({ jetstreamUserId, id }: { jetstreamUserId: string; id: string }): Prisma.RepositorySourceWhereUniqueInput => ({
  uniqueRepoSource: { jetstreamUserId, id },
});

const findUsersRepoSources = ({ jetstreamUserId }: { jetstreamUserId: string }): Prisma.RepositorySourceWhereInput => ({
  jetstreamUserId,
});

const sourceToType = (source: JetstreamRepoUi['source']): RepositorySourceType => {
  switch (source) {
    case 'github':
      return RepositorySourceType.GITHUB;
    case 'bitbucket':
      return RepositorySourceType.BITBUCKET;
    case 'azure':
      return RepositorySourceType.AZURE_DEVOPS;
  }
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function unwrap(raw: any) {
  if (!raw) {
    return null;
  }
  if (Array.isArray(raw)) {
    return raw.map(unwrap);
  }
  const [accessToken, refreshToken] = decryptAccessToken(raw.accessToken);
  return {
    ...raw,
    type: raw.type.toLowerCase() as RepoSource,
    accessToken,
    refreshToken,
    // Map the DB column name back to the UI shape
    resourceUrls: raw.resourceUrl_repos ? { repositories: raw.resourceUrl_repos } : undefined,
  };
}

export function encryptAccessToken(accessToken: string, refreshToken: string) {
  return encryptString(`${accessToken} ${refreshToken}`, hexToBase64(ENV.SFDC_CONSUMER_SECRET!));
}

export function decryptAccessToken(encryptedAccessToken: string) {
  return decryptString(encryptedAccessToken, hexToBase64(ENV.SFDC_CONSUMER_SECRET!)).split(' ');
}

/**
 * Finds by unique id and returns all fields
 * This is unsafe to send to the browser and should only be used internally
 *
 * @param jetstreamUserId
 * @param uniqueId
 * @returns
 */
export async function findByUniqueId_UNSAFE(jetstreamUserId: string, id: string) {
  return await prisma.repositorySource.findUnique({
    where: findUniqueRepoSource({ jetstreamUserId, id }),
  });
}

export async function updateAccessToken_UNSAFE(id: string, accessToken: string, refreshToken: string) {
  return await prisma.repositorySource.update({
    where: { id },
    data: {
      accessToken: encryptAccessToken(accessToken, refreshToken),
    },
  });
}

export async function updateRepoSource_UNSAFE(id: string, data: Partial<RepositorySource>) {
  return await prisma.repositorySource.update({
    where: { id: id },
    data,
  });
}

export async function findByUniqueId(jetstreamUserId: string, id: string) {
  return await prisma.repositorySource
    .findUnique({
      select: SELECT,
      where: findUniqueRepoSource({ jetstreamUserId, id }),
    })
    .then(unwrap);
}

export async function findByUserId(jetstreamUserId: string) {
  return await prisma.repositorySource
    .findMany({
      select: SELECT,
      where: findUsersRepoSources({ jetstreamUserId }),
    })
    .then(unwrap);
}

export async function findByUserIdAndType(jetstreamUserId: string, userId: string, type: RepoSource) {
  return await prisma.repositorySource
    .findFirst({
      select: SELECT,
      where: {
        jetstreamUserId,
        type: sourceToType(type),
        userId,
      },
    })
    .then(unwrap);
}

export async function createOrUpdateRepoSource(jetstreamUserId: string, jetstreamRepoSourceUi: Partial<JetstreamRepoSourceUi>) {
  const existingRepoSource = await prisma.repositorySource.findFirst({
    where: {
      jetstreamUserId,
      type: sourceToType(jetstreamRepoSourceUi.type!),
      userId: jetstreamRepoSourceUi.userId!,
    },
  });

  // FIXME: need to include organization - added orgs should be added to current organization

  let repoSourceToDelete: Maybe<{ id: string }>;
  /**
   * After a sandbox refresh, the orgId will change but the username will remain the same
   * There cannot be two different orgs with the same username since this is globally unique on Salesforce
   * After a user does a sandbox refresh, this deletes the old org no matter how the user initiated the connection
   */
  if (
    jetstreamRepoSourceUi.id &&
    jetstreamRepoSourceUi.userId &&
    (!existingRepoSource || existingRepoSource.id !== jetstreamRepoSourceUi.id)
  ) {
    repoSourceToDelete = await prisma.repositorySource.findFirst({
      select: { id: true },
      where: {
        jetstreamUserId: { equals: jetstreamUserId },
        // jetstreamUrl: { equals: ENV.JETSTREAM_SERVER_URL! },
        type: { equals: sourceToType(jetstreamRepoSourceUi.type!) },
        userId: { equals: jetstreamRepoSourceUi.userId },
        id: { not: { equals: jetstreamRepoSourceUi.id! } },
      },
    });
  }

  if (existingRepoSource) {
    // const data: Prisma.XOR<Prisma.RepositoryUpdateInput, Prisma.RepositoryUncheckedUpdateInput> = {
    const data: Prisma.RepositorySourceUpdateInput = {
      id: jetstreamRepoSourceUi.id ?? existingRepoSource.id,
      jetstreamUserId,
      type: jetstreamRepoSourceUi.type ? sourceToType(jetstreamRepoSourceUi.type) : existingRepoSource.type,
      userId: jetstreamRepoSourceUi.userId ?? existingRepoSource.userId,
      userName: jetstreamRepoSourceUi.userName ?? existingRepoSource.userName,
      description: existingRepoSource.description,
      accessToken: jetstreamRepoSourceUi.accessToken ?? existingRepoSource.accessToken,
      resourceUrl_repos: jetstreamRepoSourceUi.resourceUrls?.repositories ?? existingRepoSource.resourceUrl_repos,
    };
    if (jetstreamRepoSourceUi.jetstreamOrganizationId) {
      data.jetstreamOrganization = {
        connect: {
          id: jetstreamRepoSourceUi.jetstreamOrganizationId ?? existingRepoSource.jetstreamOrganizationId,
        },
      };
    }
    // data.filterText = `${data.username}${data.orgName}${data.label}`;
    // update existing
    const repoSource = await prisma.repositorySource.update({
      select: SELECT,
      where: { id: existingRepoSource.id },
      data,
    });
    if (repoSourceToDelete) {
      await prisma.repositorySource.delete({ where: { id: repoSourceToDelete.id } });
    }
    return repoSource;
  } else {
    // create new
    const data: Prisma.RepositorySourceCreateInput = {
      jetstreamUserId,
      type: sourceToType(jetstreamRepoSourceUi.type!),
      userId: jetstreamRepoSourceUi.userId!,
      userName: jetstreamRepoSourceUi.userName!,
      description: '',
      accessToken: jetstreamRepoSourceUi.accessToken!,
      resourceUrl_repos: jetstreamRepoSourceUi.resourceUrls?.repositories,
    };
    if (jetstreamRepoSourceUi.jetstreamOrganizationId) {
      data.jetstreamOrganization = {
        connect: {
          id: jetstreamRepoSourceUi.jetstreamOrganizationId,
        },
      };
    }
    const repoSource = await prisma.repositorySource.create({
      select: SELECT,
      data,
    });
    if (repoSourceToDelete) {
      await prisma.repository.delete({ where: { id: repoSourceToDelete.id } });
    }
    return repoSource;
  }
}
/*
export async function updateRepoSource(jetstreamUserId: string, id: string, data: { label: string; color?: string | null }) {
  const existingRepo = await prisma.repository.findUnique({
    select: { id: true, path: true, label: true, sourceOrgName: true, color: true, source: { select: { userName: true } } },
    where: findUniqueRepo({ jetstreamUserId, id }),
  });

  if (!existingRepo) {
    throw new Error('An org does not exist with the provided input');
  }

  const label = data.label || existingRepo.path;
  const color = isUndefined(data.color) ? existingRepo.color : data.color;

  return await prisma.repository.update({
    select: SELECT,
    where: { id: existingRepo.id },
    data: {
      label,
      color,
    },
  });
}
*/
/*
export async function moveSalesforceOrg(jetstreamUserId: string, uniqueId: string, data: { jetstreamOrganizationId?: Maybe<string> }) {
  const existingOrg = await prisma.salesforceOrg.findUnique({
    select: { id: true },
    where: findUniqueOrg({ jetstreamUserId, uniqueId }),
  });

  if (!existingOrg) {
    throw new Error('An org does not exist with the provided input');
  }

  return await prisma.salesforceOrg.update({
    select: SELECT,
    where: { id: existingOrg.id },
    data: {
      jetstreamOrganizationId: data.jetstreamOrganizationId ?? null,
    },
  });
}
*/

export async function deleteRepoSource(jetstreamUserId: string, id: string) {
  const existingRepoSource = await prisma.repositorySource.findUnique({
    select: { id: true },
    where: findUniqueRepoSource({ jetstreamUserId, id }),
  });

  if (!existingRepoSource) {
    throw new Error('A repository source does not exist with the provided input');
  }

  await prisma.repositorySource.delete({
    select: { id: true },
    where: { id: existingRepoSource.id },
  });
}
