import { Request, Response } from "express";
import {
  createReviewService,
  getOrganizerReviewsService,
} from "../services/review.service.js";

const getAuthenticatedUserId = (req: Request, res: Response): number => {
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

// POST /reviews — Customer submits a review
export const handleCreateReview = async (req: Request, res: Response) => {
  try {
    const userId = getAuthenticatedUserId(req, res);
    const { transactionId, rating, comment } = req.body;

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
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      message: error.message || "Failed to submit review.",
    });
  }
};

// GET /reviews/organizer — Logged-in Organizer fetches all reviews for their events
export const handleGetOrganizerReviews = async (req: Request, res: Response) => {
  try {
    const organizerId = getAuthenticatedUserId(req, res);
    const data = await getOrganizerReviewsService(organizerId);

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      message: error.message || "Failed to load organizer reviews.",
    });
  }
};