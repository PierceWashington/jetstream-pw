/*
  Warnings:

  - Added the required column `jetstreamUserId` to the `repository_source` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "repository_source" ADD COLUMN     "jetstreamOrganizationId" UUID,
ADD COLUMN     "jetstreamUserId" VARCHAR NOT NULL;

-- AddForeignKey
ALTER TABLE "repository_source" ADD CONSTRAINT "repository_source_jetstreamOrganizationId_fkey" FOREIGN KEY ("jetstreamOrganizationId") REFERENCES "jetstream_organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
