import multer from "multer";

export const upload = (maxSize: number = 2) => {
  const storage = multer.memoryStorage();

  return multer({
    storage,
    limits: {
      fileSize: maxSize * 1024 * 1024,
    },
    fileFilter: (_req, file, callback) => {
      const allowedMimeTypes = ["image/jpeg", "image/png", "image/webp"];

      if (!allowedMimeTypes.includes(file.mimetype)) {
        return callback(
          new Error("Only JPEG, PNG, and WebP images are allowed"),
        );
      }

      callback(null, true);
    },
  });
};
