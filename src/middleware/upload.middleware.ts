// src/middleware/upload.middleware.ts
import multer from "multer";
import { ApiError } from "../utils/api-error.js";

export const upload = (maxSize: number = 5) => {
  const storage = multer.memoryStorage();

  return multer({
    storage,
    limits: {
      fileSize: maxSize * 1024 * 1024, // Default 5 MB
    },
    fileFilter: (_req, file, callback) => {
      const allowedMimeTypes = [
        "image/jpeg",
        "image/jpg",
        "image/png",
        "image/webp",
      ];

      if (!allowedMimeTypes.includes(file.mimetype)) {
        return callback(
          new ApiError("Only JPEG, PNG, and WebP images are allowed", 400),
        );
      }

      callback(null, true);
    },
  });
};