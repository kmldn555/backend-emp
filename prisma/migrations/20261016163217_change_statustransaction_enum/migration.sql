/*
  Warnings:

  - The values [PENDING,PAID,CANCELLED,REFUNDED] on the enum `StatusTransaction` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "StatusTransaction_new" AS ENUM ('WAITING_FOR_PAYMENT', 'WAITING_FOR_ADMIN_CONFIRMATION', 'DONE', 'REJECTED', 'EXPIRED', 'CANCELED');
ALTER TABLE "public"."transactions" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "transactions" ALTER COLUMN "status" TYPE "StatusTransaction_new" USING ("status"::text::"StatusTransaction_new");
ALTER TYPE "StatusTransaction" RENAME TO "StatusTransaction_old";
ALTER TYPE "StatusTransaction_new" RENAME TO "StatusTransaction";
DROP TYPE "public"."StatusTransaction_old";
ALTER TABLE "transactions" ALTER COLUMN "status" SET DEFAULT 'WAITING_FOR_PAYMENT';
COMMIT;

-- AlterTable
ALTER TABLE "transactions" ALTER COLUMN "status" SET DEFAULT 'WAITING_FOR_PAYMENT';
