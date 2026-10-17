// src/routes/event.route.ts
import { Router } from "express";
import { verifyToken, verifyRole } from "../middleware/auth.middleware.js";
import { upload } from "../middleware/upload.middleware.js";
import { UserRole } from "../generated/prisma/enums.js";
import {
  createEventController,
  getEventsController,
  getEventByIdController,
} from "../controllers/event.controller.js";

const eventRoutes = Router();

// Public routes: anyone can browse and view event details
eventRoutes.get("/", getEventsController);
eventRoutes.get("/:id", getEventByIdController);

// Protected route: only logged-in EVENTORGANIZER can create an event with a 5MB max thumbnail
eventRoutes.post(
  "/",
  verifyToken(process.env.JWT_SECRET!),
  verifyRole([UserRole.EVENTORGANIZER]),
  upload(5).single("thumbnail"),
  createEventController,
);

export { eventRoutes };