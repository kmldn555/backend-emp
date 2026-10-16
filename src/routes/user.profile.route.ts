import express from "express";
import { verifyToken } from "../middleware/auth.middleware.js";
import { upload } from "../middleware/upload.middleware.js";
import {
  updateNameController,
  updateProfilePictureController,
} from "../controllers/user.profile.controller.js";
import { validate } from "../middleware/validation.middleware.js";
import { updateNameSchema } from "../validators/user.profile.validator.js";

const profileRoutes = express.Router();

profileRoutes.patch(
  "/picture",
  verifyToken(process.env.JWT_SECRET!),
  upload(2).single("profilePicture"),
  updateProfilePictureController,
);

profileRoutes.patch(
  "/name",
  verifyToken(process.env.JWT_SECRET!),
  validate(updateNameSchema),
  updateNameController,
);

export { profileRoutes };
