/*
  Warnings:

  - You are about to drop the `JetstreamRepository` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "JetstreamRepository" DROP CONSTRAINT "JetstreamRepository_jetstreamOrganizationId_fkey";

-- DropTable
DROP TABLE "JetstreamRepository";

-- CreateTable
CREATE TABLE "jetstream_repo" (
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

    CONSTRAINT "jetstream_repo_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "jetstream_repo" ADD CONSTRAINT "jetstream_repo_jetstreamOrganizationId_fkey" FOREIGN KEY ("jetstreamOrganizationId") REFERENCES "jetstream_organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
