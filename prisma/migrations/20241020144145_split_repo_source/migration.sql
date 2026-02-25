/*
  Warnings:

  - You are about to drop the `jetstream_repo` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "RepositorySourceType" AS ENUM ('GITHUB', 'BITBUCKET', 'AZURE_DEVOPS');

-- DropForeignKey
ALTER TABLE "jetstream_repo" DROP CONSTRAINT "jetstream_repo_jetstreamOrganizationId_fkey";

-- DropTable
DROP TABLE "jetstream_repo";

-- DropEnum
DROP TYPE "RepositoryType";

-- CreateTable
CREATE TABLE "repository" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "jetstreamUserId" VARCHAR NOT NULL,
    "jetstreamOrganizationId" UUID,
    "sourceId" UUID NOT NULL,
    "sourceOrgName" VARCHAR,
    "sourceOrgId" VARCHAR,
    "path" VARCHAR NOT NULL,
    "color" VARCHAR(10),
    "label" VARCHAR(100),
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "repository_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repository_source" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "type" "RepositorySourceType" NOT NULL,
    "userId" VARCHAR NOT NULL,
    "userName" VARCHAR NOT NULL,
    "description" VARCHAR,
    "accessToken" VARCHAR NOT NULL,
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "repository_source_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "repository" ADD CONSTRAINT "repository_jetstreamOrganizationId_fkey" FOREIGN KEY ("jetstreamOrganizationId") REFERENCES "jetstream_organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repository" ADD CONSTRAINT "repository_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "repository_source"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
