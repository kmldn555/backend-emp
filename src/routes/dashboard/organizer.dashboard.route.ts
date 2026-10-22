import express from "express";


import {
  findMyEventsController,
  getEventGuestListController,
  updateEventController,
} from "../../controllers/dashboards/organizer.dashboard.controller.js";
import { verifyRole, verifyToken } from "../../middleware/auth.middleware.js";
import { parseEventData } from "../../middleware/parse.event.data.middleware.js";
import { validate } from "../../middleware/validation.middleware.js";
import {
  guestListParamsSchema,
  guestListQuerySchema,
  updateEventSchema,
} from "../../validators/organizer.dashboard.validator.js";
import { upload } from "../../middleware/upload.middleware.js";

export const organizerDashboardRoutes = express.Router();

// My Events
organizerDashboardRoutes.get(
  "/my-events",
  verifyToken(process.env.JWT_SECRET!),
  verifyRole(["EVENTORGANIZER"]),
  findMyEventsController,
);

// Edit Event
organizerDashboardRoutes.put(
  "/my-events/:id",
  verifyToken(process.env.JWT_SECRET!),
  verifyRole(["EVENTORGANIZER"]),
  upload(5).single("thumbnail"),
  parseEventData,
  validate(updateEventSchema),
  updateEventController,
);

// Get Guest List
organizerDashboardRoutes.get(
  "/my-events/:id/guest-list",
  verifyToken(process.env.JWT_SECRET!),
  verifyRole(["EVENTORGANIZER"]),
  validate(guestListParamsSchema, "params"),
  validate(guestListQuerySchema, "query"),
  getEventGuestListController,
);
