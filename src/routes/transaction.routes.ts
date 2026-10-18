// backend/src/routes/transaction.route.ts
import express from "express";
import { verifyToken, verifyRole } from "../middleware/auth.middleware.js";
import { upload } from "../middleware/upload.middleware.js";
import { UserRole } from "../generated/prisma/enums.js";
import {
  handleCreateTransaction,
  handleGetTransactionById,
  handleUploadPaymentProof,
  handleGetCustomerWallet,
} from "../controllers/transaction.controller.js";

const transactionRoutes = express.Router();

// 1. GET /api/transactions/wallet — MUST be placed BEFORE /:id
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

// 3. GET /api/transactions/:id — Fetch transaction details & 2-hour countdown
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

export { transactionRoutes };