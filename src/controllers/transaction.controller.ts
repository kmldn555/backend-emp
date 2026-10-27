import { NextFunction, Request, Response } from "express";
import {
  createTransaction,
  evaluateAndSyncTransactionStatus,
  getActivePointsBalance,
  getCustomerTransactions,
  submitPaymentProof,
} from "../services/transaction.service.js";
import { prisma } from "../lib/prisma.js";
import { uploadImage } from "../lib/cloudinary.js";
import { ApiError } from "../utils/api-error.js";
import { StatusTransaction } from "../generated/prisma/enums.js";

// Helper function to safely extract the logged-in user's ID from verifyToken middleware
const getAuthenticatedUserId = (req: Request, res: Response): number => {
  const rawId =
    res.locals.user?.id ?? res.locals.user?.userId ?? (req as any).user?.id;

  const userId = Number(rawId);
  if (!rawId || isNaN(userId)) {
    throw new ApiError("Unauthorized: Valid user session not found.", 401);
  }
  return userId;
};

// POST /transactions — Create a new ticket purchase transaction
export const handleCreateTransaction = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = getAuthenticatedUserId(req, res);
    const { eventId, items, voucherCode, couponCode, usePoints } = req.body;

    if (!eventId || isNaN(Number(eventId))) {
      throw new ApiError("Valid eventId is required.", 400);
    }

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
      message:
        "Transaction created. Please upload payment proof within 2 hours.",
      data: transaction,
    });
  } catch (error) {
    next(error);
  }
};

// GET /transactions/:id — Fetch transaction details (with automatic deadline evaluation)
export const handleGetTransactionById = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const transactionId = Number(req.params.id);

    if (isNaN(transactionId) || transactionId <= 0) {
      throw new ApiError("Invalid transaction ID parameter.", 400);
    }

    const transaction = await evaluateAndSyncTransactionStatus(transactionId);

    return res.status(200).json({
      success: true,
      data: transaction,
    });
  } catch (error) {
    next(error);
  }
};

// PATCH /transactions/:id/payment-proof — Upload payment proof image
export const handleUploadPaymentProof = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = getAuthenticatedUserId(req, res);
    const transactionId = Number(req.params.id);

    if (isNaN(transactionId) || transactionId <= 0) {
      throw new ApiError("Invalid transaction ID parameter.", 400);
    }

    if (!req.file) {
      throw new ApiError(
        "Please select an image file for payment proof.",
        400,
      );
    }

    const paymentProofUrl = await uploadImage(
      req.file.buffer,
      "payment-proofs",
    );

    const updated = await submitPaymentProof(
      transactionId,
      userId,
      paymentProofUrl,
    );

    return res.status(200).json({
      success: true,
      message: "Payment proof uploaded! Waiting for admin confirmation.",
      data: updated,
    });
  } catch (error) {
    next(error);
  }
};

// GET /transactions/wallet — Fetch customer's points & active coupons for checkout
export const handleGetCustomerWallet = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = getAuthenticatedUserId(req, res);
    const now = new Date();

    // 1. Rule n: Calculate total active points from point_lots table via prisma.pointLot.aggregate
    const aggregatedPoints = await getActivePointsBalance(prisma, userId);

    // 2. Rules b & g: Fetch coupons belonging to the same user where isUsed = false and not expired
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        coupons: {
          where: {
            userId,
            isUsed: false,
            expiresAt: { gt: now },
          },
          orderBy: { expiresAt: "asc" },
        },
      },
    });

    if (!user) {
      throw new ApiError("Customer account not found.", 404);
    }

    return res.status(200).json({
      success: true,
      data: {
        role: user.role,
        points: aggregatedPoints,
        coupons: user.coupons,
      },
    });
  } catch (error) {
    next(error);
  }
};

// GET /transactions — Fetch paginated transactions for the logged-in customer
export const handleGetCustomerTransactions = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = getAuthenticatedUserId(req, res);
    const { page, take, limit, status, search, sortBy, sortOrder } = req.query;

    const result = await getCustomerTransactions(userId, {
      page: page ? Number(page) : 1,
      take: take ? Number(take) : limit ? Number(limit) : 5,
      status: (status as StatusTransaction | "ALL") || "ALL",
      search: (search as string) || "",
      sortBy: (sortBy as string) || "createdAt",
      sortOrder: (sortOrder as string) || "desc",
    });

    return res.status(200).json({
      success: true,
      data: result.data,
      meta: result.meta,
    });
  } catch (error) {
    next(error);
  }
};