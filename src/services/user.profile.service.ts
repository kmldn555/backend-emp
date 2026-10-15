import { prisma } from "../lib/prisma.js";
import { uploadImage, removeImageByUrl } from "../lib/cloudinary.js";
import { ApiError } from "../utils/api-error.js";

export const getProfile = async () => {};
export const updateProfilePictureService = async (
  userId: number,
  file: Express.Multer.File,
) => {
  // 1. Pastikan user tersedia
  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user) {
    throw new ApiError("User not found", 404);
  }

  // 2. Upload foto ke Cloudinary
  const uploadedImage = await uploadImage(file);

  // 3. Update URL foto profil di database
  const updatedUser = await prisma.user.update({
    where: { id: userId },
    data: {
      profilePicture: uploadedImage.secure_url,
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      profilePicture: true,
    },
  });

  // 4. Hapus foto lama jika tersedia
  if (user.profilePicture) {
    try {
      await removeImageByUrl(user.profilePicture);
    } catch (error) {
      console.error("Failed to remove old profile picture:", error);
    }
  }

  // 5. Kembalikan data user terbaru
  return {
    message: "Profile picture updated successfully",
    user: updatedUser,
  };
};
