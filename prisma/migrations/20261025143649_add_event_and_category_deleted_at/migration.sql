-- AlterTable
ALTER TABLE "categories" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "events" ADD COLUMN     "deletedAt" TIMESTAMP(3);
