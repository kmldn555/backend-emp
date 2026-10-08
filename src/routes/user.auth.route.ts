import express from "express";
import { loginController, registerController } from "../controllers/user.auth.controller.js";
import { validate } from "../middleware/validation.middleware.js";
import { loginUserSchema, registerUserSchema } from "../validators/user.auth.validator.js";


const authRoutes = express.Router();

authRoutes.post("/register", validate (registerUserSchema), registerController);
authRoutes.post("/login", validate (loginUserSchema), loginController);

export { authRoutes };
