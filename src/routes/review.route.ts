// backend/src/routes/review.route.ts
import { Router } from "express";
import { verifyToken, verifyRole } from "../middleware/auth.middleware.js";
import { UserRole } from "../generated/prisma/enums.js";
import {
  handleCreateReview,
  handleGetOrganizerReviews,
} from "../controllers/review.controller.js";

const reviewRoutes = Router();

// Customer submits review (Only CUSTOMER role)
reviewRoutes.post(
  "/",
  verifyToken(process.env.JWT_SECRET!),
  verifyRole([UserRole.CUSTOMER]),
  handleCreateReview
);

// Organizer fetches all reviews across their events
reviewRoutes.get(
  "/organizer",
  verifyToken(process.env.JWT_SECRET!),
  verifyRole([UserRole.EVENTORGANIZER]),
  handleGetOrganizerReviews
);

export default reviewRoutes;