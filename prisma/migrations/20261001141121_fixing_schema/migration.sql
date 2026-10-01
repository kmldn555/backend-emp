/*
  Warnings:

  - The values [pending,paid,cancelled,refunded] on the enum `StatusTransaction` will be removed. If these variants are still used in the database, this will fail.
  - The values [customer,eventOrganizer] on the enum `UserRole` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `is_read` on the `notifications` table. All the data in the column will be lost.
  - You are about to drop the column `admin_deadline` on the `transactions` table. All the data in the column will be lost.
  - You are about to drop the column `payment_proof` on the `transactions` table. All the data in the column will be lost.
  - You are about to drop the column `total_amount` on the `transactions` table. All the data in the column will be lost.
  - You are about to drop the `pointLots` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ticketTypes` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `transactionItems` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `adminDeadline` to the `transactions` table without a default value. This is not possible if the table is not empty.
  - Added the required column `paymentProof` to the `transactions` table without a default value. This is not possible if the table is not empty.
  - Added the required column `totalAmount` to the `transactions` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "StatusTransaction_new" AS ENUM ('PENDING', 'PAID', 'CANCELLED', 'REFUNDED');
ALTER TABLE "public"."transactions" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "transactions" ALTER COLUMN "status" TYPE "StatusTransaction_new" USING ("status"::text::"StatusTransaction_new");
ALTER TYPE "StatusTransaction" RENAME TO "StatusTransaction_old";
ALTER TYPE "StatusTransaction_new" RENAME TO "StatusTransaction";
DROP TYPE "public"."StatusTransaction_old";
ALTER TABLE "transactions" ALTER COLUMN "status" SET DEFAULT 'PENDING';
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "UserRole_new" AS ENUM ('CUSTOMER', 'EVENTORGANIZER');
ALTER TABLE "public"."users" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "users" ALTER COLUMN "role" TYPE "UserRole_new" USING ("role"::text::"UserRole_new");
ALTER TYPE "UserRole" RENAME TO "UserRole_old";
ALTER TYPE "UserRole_new" RENAME TO "UserRole";
DROP TYPE "public"."UserRole_old";
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'CUSTOMER';
COMMIT;

-- DropForeignKey
ALTER TABLE "pointLots" DROP CONSTRAINT "pointLots_userId_fkey";

-- DropForeignKey
ALTER TABLE "ticketTypes" DROP CONSTRAINT "ticketTypes_eventId_fkey";

-- DropForeignKey
ALTER TABLE "transactionItems" DROP CONSTRAINT "transactionItems_ticketTypeId_fkey";

-- DropForeignKey
ALTER TABLE "transactionItems" DROP CONSTRAINT "transactionItems_transactionId_fkey";

-- AlterTable
ALTER TABLE "notifications" DROP COLUMN "is_read",
ADD COLUMN     "isRead" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "transactions" DROP COLUMN "admin_deadline",
DROP COLUMN "payment_proof",
DROP COLUMN "total_amount",
ADD COLUMN     "adminDeadline" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "paymentProof" TEXT NOT NULL,
ADD COLUMN     "totalAmount" INTEGER NOT NULL,
ALTER COLUMN "status" SET DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'CUSTOMER';

-- DropTable
DROP TABLE "pointLots";

-- DropTable
DROP TABLE "ticketTypes";

-- DropTable
DROP TABLE "transactionItems";

-- CreateTable
CREATE TABLE "point_lots" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "remainingAmount" INTEGER NOT NULL,
    "creditedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "point_lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_types" (
    "id" SERIAL NOT NULL,
    "eventId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "totalSeat" INTEGER NOT NULL,
    "availableSeat" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transaction_items" (
    "id" SERIAL NOT NULL,
    "transactionId" INTEGER NOT NULL,
    "ticketTypeId" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "price" INTEGER NOT NULL,

    CONSTRAINT "transaction_items_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "point_lots" ADD CONSTRAINT "point_lots_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_types" ADD CONSTRAINT "ticket_types_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_items" ADD CONSTRAINT "transaction_items_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_items" ADD CONSTRAINT "transaction_items_ticketTypeId_fkey" FOREIGN KEY ("ticketTypeId") REFERENCES "ticket_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
