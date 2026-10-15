import { Request, Response } from "express";
import { updateProfilePictureService } from "../services/user.profile.service.js";

export const updateProfilePictureController = async (
  req: Request,
  res: Response,
) => {
  const userId = res.locals.user.id;
  const file = req.file;

  if (!file) {
    res.status(400).send({
      message: "Profile picture is required",
    });
    return;
  }

  const result = await updateProfilePictureService(userId, file);

  res.status(200).send(result);
};
