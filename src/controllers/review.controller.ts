import { NextFunction, Request, Response } from "express";
import {
  createReviewService,
  getOrganizerReviewsService,
} from "../services/review.service.js";
import { ApiError } from "../utils/api-error.js";

const getAuthenticatedUserId = (req: Request, res: Response): number => {
  const rawId =
    res.locals.user?.id ?? res.locals.user?.userId ?? (req as any).user?.id;

  const userId = Number(rawId);
  if (!rawId || isNaN(userId)) {
    throw new ApiError("Unauthorized: Valid user session not found.", 401);
  }
  return userId;
};

// POST /reviews — Customer submits a review
export const handleCreateReview = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = getAuthenticatedUserId(req, res);
    const { transactionId, rating, comment } = req.body;

    if (!transactionId || isNaN(Number(transactionId))) {
      throw new ApiError("Valid transactionId is required.", 400);
    }

    const review = await createReviewService({
      userId,
      transactionId: Number(transactionId),
      rating: Number(rating),
      comment: String(comment || ""),
    });

    return res.status(201).json({
      success: true,
      message: "Review submitted successfully!",
      data: review,
    });
  } catch (error) {
    next(error);
  }
};

// GET /reviews/organizer — Logged-in Organizer fetches paginated reviews for their events
export const handleGetOrganizerReviews = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const organizerId = getAuthenticatedUserId(req, res);
    const { page, take, limit, search, event, rating } = req.query;

    const data = await getOrganizerReviewsService(organizerId, {
      page: page ? Number(page) : 1,
      take: take ? Number(take) : limit ? Number(limit) : 5,
      search: (search as string) || "",
      eventName: (event as string) || "ALL",
      rating: (rating as string) || "ALL",
    });

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    next(error);
  }
};