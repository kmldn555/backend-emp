import express from "express";
import { registerController } from "../controllers/user.auth.controller.js";
import { validate } from "../middleware/validation.middleware.js";
import { registerUserSchema } from "../validators/user.auth.validator.js";


const authRoutes = express.Router();

authRoutes.post("/register", validate (registerUserSchema), registerController);

export { authRoutes };
