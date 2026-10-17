-- AlterTable
ALTER TABLE "transactions" ALTER COLUMN "adminDeadline" DROP NOT NULL,
ALTER COLUMN "paymentProof" DROP NOT NULL;
