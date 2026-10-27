import express from "express";
import { verifyRole, verifyToken } from "../../middleware/auth.middleware.js";
import {
  getCustomerHistoryPointsController,
  getCustomerPointsController,
} from "../../controllers/dashboards/customer.dasboard.controller.js";

export const customerDashboardRoutes = express.Router();

customerDashboardRoutes.get(
  "/total-points",
  verifyToken(process.env.JWT_SECRET!),
  verifyRole(["CUSTOMER"]),
  getCustomerPointsController,
);

customerDashboardRoutes.get(
  "/points-history",
  verifyToken(process.env.JWT_SECRET!),
  verifyRole(["CUSTOMER"]),
  getCustomerHistoryPointsController,
);
