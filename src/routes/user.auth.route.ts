import express from "express";
import {
  changePasswordController,
  forgotPasswordController,
  loginController,
  registerController,
} from "../controllers/user.auth.controller.js";
import { validate } from "../middleware/validation.middleware.js";
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginUserSchema,
  registerUserSchema,
} from "../validators/user.auth.validator.js";
import { verifyToken } from "../middleware/auth.middleware.js";

const authRoutes = express.Router();

authRoutes.post("/register", validate(registerUserSchema), registerController);
authRoutes.post("/login", validate(loginUserSchema), loginController);
authRoutes.post(
  "/forgot-password",
  validate(forgotPasswordSchema),
  forgotPasswordController,
);
authRoutes.post(
  "/change-password",
  verifyToken(process.env.JWT_SECRET!),
  validate(changePasswordSchema),
  changePasswordController,
);

export { authRoutes };
