import express from "express";
import { getTotalCategoriesController, getTotalCustomerController, getTotalEventController, getTotalOrganizerController, getUsersController } from "../../controllers/dashboards/admin.dashboard.controller.js";
import { verifyRole, verifyToken } from "../../middleware/auth.middleware.js";

export const adminDashboardRoutes = express.Router();

adminDashboardRoutes.get(
  "/total-customer",
  verifyToken(process.env.JWT_SECRET!),
  verifyRole(["ADMIN"]),
  getTotalCustomerController,
);

adminDashboardRoutes.get(
  "/total-organizer",
  verifyToken(process.env.JWT_SECRET!),
  verifyRole(["ADMIN"]),
  getTotalOrganizerController,
);

adminDashboardRoutes.get(
  "/total-event",
  verifyToken(process.env.JWT_SECRET!),
  verifyRole(["ADMIN"]),
  getTotalEventController,
);

adminDashboardRoutes.get(
  "/total-category",
  verifyToken(process.env.JWT_SECRET!),
  verifyRole(["ADMIN"]),
  getTotalCategoriesController,
);

adminDashboardRoutes.get(
  "/users",
  verifyToken(process.env.JWT_SECRET!),
  verifyRole(["ADMIN"]),
  getUsersController,
);

