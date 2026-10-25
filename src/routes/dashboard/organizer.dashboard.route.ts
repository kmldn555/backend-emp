import express from "express";

import {
  approveTransactionsController,
  findMyEventsController,
  getEventGuestListController,
  getOrganizerDonePaymentController,
  getOrganizerEventController,
  getOrganizerPendingPaymentController,
  getOrganizerRejectedPaymentController,
  getOrganizerSalesAnalyticsController,
  getOrganizerTicketSoldController,
  getOrganizerTotalRevenueController,
  getOrganizerTotalTransactionsController,
  getOrganizerTransactionsController,
  rejectTransactionsController,
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

// overview
organizerDashboardRoutes.get(
  "/total-events",
  verifyToken(process.env.JWT_SECRET!),
  verifyRole(["EVENTORGANIZER"]),
  getOrganizerEventController,
);

organizerDashboardRoutes.get(
  "/total-ticket-sold",
  verifyToken(process.env.JWT_SECRET!),
  verifyRole(["EVENTORGANIZER"]),
  getOrganizerTicketSoldController,
);

organizerDashboardRoutes.get(
  "/total-revenue",
  verifyToken(process.env.JWT_SECRET!),
  verifyRole(["EVENTORGANIZER"]),
  getOrganizerTotalRevenueController,
);

organizerDashboardRoutes.get(
  "/sales-analytics",
  verifyToken(process.env.JWT_SECRET!),
  verifyRole(["EVENTORGANIZER"]),
  getOrganizerSalesAnalyticsController,
);

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

// Get payment with status pending
organizerDashboardRoutes.get(
  "/total-pending-payments",
  verifyToken(process.env.JWT_SECRET!),
  verifyRole(["EVENTORGANIZER"]),
  getOrganizerPendingPaymentController,
);

// Get payment with status done
organizerDashboardRoutes.get(
  "/total-done-payments",
  verifyToken(process.env.JWT_SECRET!),
  verifyRole(["EVENTORGANIZER"]),
  getOrganizerDonePaymentController,
);

// Get payment with status pending
organizerDashboardRoutes.get(
  "/total-rejected-payments",
  verifyToken(process.env.JWT_SECRET!),
  verifyRole(["EVENTORGANIZER"]),
  getOrganizerRejectedPaymentController,
);

// Get table transactions
organizerDashboardRoutes.get(
  "/table-transactions",
  verifyToken(process.env.JWT_SECRET!),
  verifyRole(["EVENTORGANIZER"]),
  getOrganizerTransactionsController,
);

// get total transactions
organizerDashboardRoutes.get(
  "/total-transactions",
  verifyToken(process.env.JWT_SECRET!),
  verifyRole(["EVENTORGANIZER"]),
  getOrganizerTotalTransactionsController,
);

// Button approve transaction
organizerDashboardRoutes.patch(
  "/transactions/:transactionId/approve",
  verifyToken(process.env.JWT_SECRET!),
  verifyRole(["EVENTORGANIZER"]),
  approveTransactionsController,
);

// Button reject transaction
organizerDashboardRoutes.patch(
  "/transactions/:transactionId/reject",
  verifyToken(process.env.JWT_SECRET!),
  verifyRole(["EVENTORGANIZER"]),
  rejectTransactionsController,
);
