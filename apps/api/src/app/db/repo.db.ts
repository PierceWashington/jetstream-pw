/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { ENV, prisma } from '@jetstream/api-config';
import { decryptString, encryptString, hexToBase64 } from '@jetstream/shared/node-utils';
import { JetstreamRepoUi, Maybe } from '@jetstream/types';
import { Prisma, Repository, RepositorySourceType } from '@jetstream/prisma';
import isUndefined from 'lodash/isUndefined';

const SELECT: Prisma.RepositorySelect = {
  id: true,
  jetstreamUserId: true,
  jetstreamOrganizationId: true,
  source: {
    select: {
      id: true,
      type: true,
      userId: true,
      accessToken: true,
    },
  },
  sourceOrgName: true,
  sourceOrgId: true,
  path: true,
  label: true,
  color: true,
  createdAt: true,
  updatedAt: true,
};

export const REPO_SELECT = SELECT;

/**
 * TODO: add better error handling with non-db error messages!
 */

const findUniqueRepo = ({ jetstreamUserId, id }: { jetstreamUserId: string; id: string }): Prisma.RepositoryWhereUniqueInput => ({
  uniqueRepo: { jetstreamUserId, id },
});

const findUsersRepos = ({ jetstreamUserId }: { jetstreamUserId: string }): Prisma.RepositoryWhereInput => ({
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
  return await prisma.repository.findUnique({
    where: findUniqueRepo({ jetstreamUserId, id }),
  });
}

export async function updateAccessToken_UNSAFE(repo: Repository, accessToken: string, refreshToken: string) {
  return await prisma.repository.update({
    where: { id: repo.id },
    data: {
      source: {
        update: {
          accessToken: encryptAccessToken(accessToken, refreshToken),
        },
      },
    },
  });
}

export async function updateRepo_UNSAFE(repo: Repository, data: Partial<Repository>) {
  return await prisma.repository.update({
    where: { id: repo.id },
    data,
  });
}

export async function findByUniqueId(jetstreamUserId: string, id: string) {
  return await prisma.repository.findUnique({
    select: SELECT,
    where: findUniqueRepo({ jetstreamUserId, id }),
  });
}

export async function findByUserId(jetstreamUserId: string) {
  return await prisma.repository.findMany({
    select: SELECT,
    where: findUsersRepos({ jetstreamUserId }),
  });
}

export async function createOrUpdateRepo(jetstreamUserId: string, jetstreamRepoUi: Partial<JetstreamRepoUi>) {
  const existingRepo = await prisma.repository.findUnique({
    include: { source: true },
    where: findUniqueRepo({ jetstreamUserId, id: jetstreamRepoUi.id! }),
  });

  // FIXME: need to include organization - added orgs should be added to current organization

  let repoToDelete: Maybe<{ id: string }>;
  /**
   * After a sandbox refresh, the orgId will change but the username will remain the same
   * There cannot be two different orgs with the same username since this is globally unique on Salesforce
   * After a user does a sandbox refresh, this deletes the old org no matter how the user initiated the connection
   */
  if (jetstreamRepoUi.sourceId && jetstreamRepoUi.userId) {
    repoToDelete = await prisma.repository.findFirst({
      select: { id: true },
      where: {
        jetstreamUserId: { equals: jetstreamUserId },
        // jetstreamUrl: { equals: ENV.JETSTREAM_SERVER_URL! },
        sourceId: { equals: jetstreamRepoUi.sourceId },
        path: { equals: jetstreamRepoUi.path },
        id: { not: { equals: jetstreamRepoUi.id! } },
      },
    });
  }

  if (existingRepo) {
    // const data: Prisma.XOR<Prisma.RepositoryUpdateInput, Prisma.RepositoryUncheckedUpdateInput> = {
    const data: Prisma.RepositoryUpdateInput = {
      id: jetstreamRepoUi.id ?? existingRepo.id,
      source: {
        update: {
          // where: { id: existingRepo.sourceId! },
          data: {
            accessToken: jetstreamRepoUi.accessToken ?? existingRepo!.source!.accessToken,
            userId: jetstreamRepoUi.userId ?? existingRepo!.source!.userId,
            userName: jetstreamRepoUi.userName ?? existingRepo!.source!.userName,
          },
        },
      },
      label: jetstreamRepoUi.label ?? existingRepo.label,
      sourceOrgName: jetstreamRepoUi.orgName ?? existingRepo.sourceOrgName,
      sourceOrgId: jetstreamRepoUi.orgId ?? existingRepo.sourceOrgId,
      path: jetstreamRepoUi.path ?? existingRepo.path,
      color: jetstreamRepoUi.color ?? existingRepo.color,
    };
    if (jetstreamRepoUi.jetstreamOrganizationId) {
      data.jetstreamOrganization = {
        connect: {
          id: jetstreamRepoUi.jetstreamOrganizationId ?? existingRepo.jetstreamOrganizationId,
        },
      };
    }
    data.label = data.label || data.path;
    // data.filterText = `${data.username}${data.orgName}${data.label}`;
    // update existing
    const repo = await prisma.repository.update({
      select: SELECT,
      where: { id: existingRepo.id },
      data,
    });
    if (repoToDelete) {
      await prisma.repository.delete({ where: { id: repoToDelete.id } });
    }
    return repo;
  } else {
    // create new
    const repo = await prisma.repository.create({
      select: SELECT,
      data: {
        jetstreamUserId,
        jetstreamOrganization: {
          connect: {
            id: jetstreamRepoUi.jetstreamOrganizationId!,
          },
        },
        source: {
          connectOrCreate: {
            where: { id: jetstreamRepoUi.sourceId },
            create: {
              type: sourceToType(jetstreamRepoUi.source!),
              jetstreamUserId,
              userId: jetstreamRepoUi.userId!,
              userName: jetstreamRepoUi.userName!,
              accessToken: jetstreamRepoUi.accessToken!,
            },
          },
        },
        sourceOrgName: jetstreamRepoUi.orgName,
        sourceOrgId: jetstreamRepoUi.orgId,
        path: jetstreamRepoUi.path!,
        color: jetstreamRepoUi.color,
        label: jetstreamRepoUi.label || jetstreamRepoUi.path,
      },
    });
    if (repoToDelete) {
      await prisma.repository.delete({ where: { id: repoToDelete.id } });
    }
    return repo;
  }
}

export async function updateRepo(jetstreamUserId: string, id: string, data: { label: string; color?: string | null }) {
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

export async function deleteRepo(jetstreamUserId: string, id: string) {
  const existingRepo = await prisma.repository.findUnique({
    select: { id: true, label: true, sourceOrgName: true, source: { select: { userName: true } } },
    where: findUniqueRepo({ jetstreamUserId, id }),
  });

  if (!existingRepo) {
    throw new Error('An org does not exist with the provided input');
  }

  await prisma.repository.delete({
    select: { id: true },
    where: { id: existingRepo.id },
  });
}
