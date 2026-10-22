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

//public route
eventRoutes.get("/", getEventsController);
eventRoutes.get("/:id", getEventByIdController);

//protected route, cuma role EVENTORGANIZER yg bisa akses
eventRoutes.post(
  "/",
  verifyToken(process.env.JWT_SECRET!),
  verifyRole([UserRole.EVENTORGANIZER]),
  upload(5).single("thumbnail"),
  createEventController,
);

export { eventRoutes };