import axios from "axios";
import crypto from "crypto";
import FormData from "form-data";

const cloudName = process.env.CLOUDINARY_CLOUD_NAME!;
const apiKey = process.env.CLOUDINARY_API_KEY!;
const apiSecret = process.env.CLOUDINARY_API_SECRET!;

/**
 * Generate Cloudinary signature (SHA1)
 */
const generateSignature = (params: Record<string, string | number>): string => {
  const sortedParams = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");

  return crypto
    .createHash("sha1")
    .update(sortedParams + apiSecret)
    .digest("hex");
};

/**
 * Upload image using SIGNED request
 * Mendukung pemanggilan:
 * 1. uploadImage(req.file) -> untuk kode Dev 2
 * 2. uploadImage(req.file.buffer, "events") -> untuk event.controller.ts & transaction.controller.ts
 */
export const uploadImage = async (
  fileOrBuffer: Express.Multer.File | Buffer,
  folder?: string,
): Promise<string> => {
  const timestamp = Math.floor(Date.now() / 1000);

  // Jika parameter folder dikirim, wajib dimasukkan ke dalam signature Cloudinary
  const signatureParams: Record<string, string | number> = { timestamp };
  if (folder) {
    signatureParams.folder = folder;
  }

  const signature = generateSignature(signatureParams);
  const formData = new FormData();

  // Cek apakah input berupa Buffer langsung atau objek Express.Multer.File
  if (Buffer.isBuffer(fileOrBuffer)) {
    formData.append("file", fileOrBuffer, {
      filename: `upload-${timestamp}.jpg`,
      contentType: "image/jpeg",
    });
  } else {
    formData.append("file", fileOrBuffer.buffer, {
      filename: fileOrBuffer.originalname,
      contentType: fileOrBuffer.mimetype,
    });
  }

  formData.append("api_key", apiKey);
  formData.append("timestamp", timestamp.toString());
  formData.append("signature", signature);

  if (folder) {
    formData.append("folder", folder);
  }

  const response = await axios.post(
    `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
    formData,
    {
      headers: formData.getHeaders(),
    },
  );

  // Kembalikan string URL gambar agar sesuai dengan kolom String di Prisma
  return response.data.secure_url;
};

/**
 * Alias agar jika ada file lain (seperti transaction.controller.ts)
 * yang mengimpor uploadToCloudinary tetap berjalan tanpa error
 */
export const uploadToCloudinary = uploadImage;

/**
 * Extract public_id from secure_url
 */
const extractPublicIdFromUrl = (url: string): string => {
  const withoutQuery = url.split("?")[0];
  const parts = withoutQuery.split("/");
  const uploadIndex = parts.findIndex((part) => part === "upload");
  const publicIdParts = parts.slice(uploadIndex + 2);
  return publicIdParts.join("/").replace(/\.[^/.]+$/, "");
};

/**
 * Delete image by secure_url
 */
export const removeImageByUrl = async (secureUrl: string) => {
  const publicId = extractPublicIdFromUrl(secureUrl);
  const timestamp = Math.floor(Date.now() / 1000);

  const signature = generateSignature({
    public_id: publicId,
    timestamp,
  });

  const formData = new FormData();
  formData.append("public_id", publicId);
  formData.append("api_key", apiKey);
  formData.append("timestamp", timestamp.toString());
  formData.append("signature", signature);

  const response = await axios.post(
    `https://api.cloudinary.com/v1_1/${cloudName}/image/destroy`,
    formData,
    {
      headers: formData.getHeaders(),
    },
  );

  return response.data;
};