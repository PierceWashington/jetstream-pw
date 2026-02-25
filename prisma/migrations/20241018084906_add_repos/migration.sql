-- CreateEnum
CREATE TYPE "RepositoryType" AS ENUM ('GITHUB', 'BITBUCKET', 'AZURE_DEVOPS');

-- CreateTable
CREATE TABLE "JetstreamRepository" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "jetstreamUserId" VARCHAR NOT NULL,
    "jetstreamOrganizationId" UUID,
    "type" "RepositoryType" NOT NULL,
    "sourceId" UUID,
    "sourceUserName" VARCHAR,
    "sourceUserId" VARCHAR,
    "sourceOrgName" VARCHAR,
    "sourceOrgId" VARCHAR,
    "accessToken" VARCHAR NOT NULL,
    "path" VARCHAR NOT NULL,
    "color" VARCHAR(10),
    "label" VARCHAR(100),
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JetstreamRepository_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "JetstreamRepository" ADD CONSTRAINT "JetstreamRepository_jetstreamOrganizationId_fkey" FOREIGN KEY ("jetstreamOrganizationId") REFERENCES "jetstream_organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
