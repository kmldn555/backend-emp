import express from "express";
import { verifyToken, verifyRole } from "../middleware/auth.middleware.js";
import { upload } from "../middleware/upload.middleware.js";
import { UserRole } from "../generated/prisma/enums.js";
import {
  handleCreateTransaction,
  handleGetTransactionById,
  handleUploadPaymentProof,
  handleGetCustomerWallet,
  handleGetCustomerTransactions,
} from "../controllers/transaction.controller.js";

const transactionRoutes = express.Router();

// 1. GET /api/transactions/wallet
transactionRoutes.get(
  "/wallet",
  verifyToken(process.env.JWT_SECRET!),
  verifyRole([UserRole.CUSTOMER]),
  handleGetCustomerWallet,
);

// 2. POST /api/transactions — Customer creates a ticket checkout transaction
transactionRoutes.post(
  "/",
  verifyToken(process.env.JWT_SECRET!),
  verifyRole([UserRole.CUSTOMER]),
  handleCreateTransaction,
);

// 3. GET /api/transactions/:id —
transactionRoutes.get(
  "/:id",
  verifyToken(process.env.JWT_SECRET!),
  handleGetTransactionById,
);

// 4. PATCH /api/transactions/:id/payment-proof — Upload receipt image (max 5MB)
transactionRoutes.patch(
  "/:id/payment-proof",
  verifyToken(process.env.JWT_SECRET!),
  verifyRole([UserRole.CUSTOMER]),
  upload(5).single("paymentProof"),
  handleUploadPaymentProof,
);


transactionRoutes.get(
  "/",
  verifyToken(process.env.JWT_SECRET!),
  verifyRole([UserRole.CUSTOMER]),
  handleGetCustomerTransactions,
);

export { transactionRoutes };