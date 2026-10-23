import { Request, Response } from "express";
import {
  createTransaction,
  evaluateAndSyncTransactionStatus,
  getCustomerTransactions,
  submitPaymentProof,
} from "../services/transaction.service.js";
import { prisma } from "../lib/prisma.js";
import { uploadImage } from "../lib/cloudinary.js";

// Helper function to safely extract the logged-in user's ID from Developer 2's verifyToken middleware
const getAuthenticatedUserId = (req: Request, res: Response): number => {
  // Developer 2's verifyToken sets `res.locals.user = payload`
  const rawId =
    res.locals.user?.id ??
    res.locals.user?.userId ??
    (req as any).user?.id;

  const userId = Number(rawId);
  if (!rawId || isNaN(userId)) {
    throw new Error("Unauthorized: Valid user session not found.");
  }
  return userId;
};

// POST /api/transactions — Create a new ticket purchase transaction
export const handleCreateTransaction = async (req: Request, res: Response) => {
  try {
    // 1. Get authenticated customer ID from res.locals.user
    const userId = getAuthenticatedUserId(req, res);
    const { eventId, items, voucherCode, couponCode, usePoints } = req.body;

    // 2. Call functional transaction creation service
    const transaction = await createTransaction({
      userId,
      eventId: Number(eventId),
      items,
      voucherCode,
      couponCode,
      usePoints: Boolean(usePoints),
    });

    return res.status(201).json({
      success: true,
      message: "Transaction created. Please upload payment proof within 2 hours.",
      data: transaction,
    });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      message: error.message || "Failed to create transaction",
    });
  }
};

// GET /api/transactions/:id — Fetch transaction details (with automatic deadline evaluation)
export const handleGetTransactionById = async (req: Request, res: Response) => {
  try {
    const transactionId = Number(req.params.id);

    // Guard against non-numeric IDs (e.g., if a wrong URL param is passed)
    if (isNaN(transactionId) || transactionId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid transaction ID parameter.",
      });
    }

    const transaction = await evaluateAndSyncTransactionStatus(transactionId);

    return res.status(200).json({
      success: true,
      data: transaction,
    });
  } catch (error: any) {
    return res.status(404).json({
      success: false,
      message: error.message || "Transaction not found",
    });
  }
};

// PATCH /api/transactions/:id/payment-proof — Upload payment proof image
export const handleUploadPaymentProof = async (req: Request, res: Response) => {
  try {
    // 1. Get authenticated customer ID from res.locals.user
    const userId = getAuthenticatedUserId(req, res);
    const transactionId = Number(req.params.id);

    if (isNaN(transactionId) || transactionId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid transaction ID parameter.",
      });
    }

    // 2. Ensure Developer 2's upload() Multer middleware captured the file
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Please select an image file for payment proof.",
      });
    }

    // 3. Upload image buffer to Cloudinary
    const paymentProofUrl = await uploadImage(
      req.file.buffer,
      "payment-proofs"
    );

    // 4. Save proof URL and update status to WAITING_FOR_ADMIN_CONFIRMATION
    const updated = await submitPaymentProof(
      transactionId,
      userId,
      paymentProofUrl
    );

    return res.status(200).json({
      success: true,
      message: "Payment proof uploaded! Waiting for admin confirmation.",
      data: updated,
    });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      message: error.message || "Failed to upload payment proof",
    });
  }
};

// GET /api/transactions/wallet — Fetch customer's points & active coupons for checkout
export const handleGetCustomerWallet = async (req: Request, res: Response) => {
  try {
    // 1. Get authenticated customer ID from res.locals.user
    const userId = getAuthenticatedUserId(req, res);

    // 2. Query User points and unused, non-expired coupons
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        points: true,
        coupons: {
          where: { isUsed: false, expiresAt: { gt: new Date() } },
        },
      },
    });

    return res.status(200).json({ success: true, data: user });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /transactions — Fetch all transactions for the logged-in customer
export const handleGetCustomerTransactions = async (
  req: Request,
  res: Response
) => {
  try {
    // 1. Extract the logged-in customer ID from res.locals.user / req.user
    const userId = getAuthenticatedUserId(req, res);

    // 2. Fetch synced transaction history from the service
    const transactions = await getCustomerTransactions(userId);

    return res.status(200).json({
      success: true,
      data: transactions,
    });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      message: error.message || "Failed to fetch transaction history.",
    });
  }
};