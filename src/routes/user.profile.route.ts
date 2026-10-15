import express from "express";
import { verifyToken } from "../middleware/auth.middleware.js";
import { upload } from "../middleware/upload.middleware.js";
import { updateProfilePictureController } from "../controllers/user.profile.controller.js";

const profileRoutes = express.Router();

profileRoutes.patch(
  "/picture",
  verifyToken(process.env.JWT_SECRET!),
  upload(2).single("profilePicture"),
  updateProfilePictureController,
);

export { profileRoutes };
