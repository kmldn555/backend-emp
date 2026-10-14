import { Request, Response } from "express";
import { changePasswordService, forgotPasswordService, loginService, registerService, resetPasswordService } from "../services/user.auth.service.js";

export const registerController = async (req: Request, res: Response) => {
  const result = await registerService(req.body);
  res.status(200).send(result);
};

export const loginController = async (req: Request, res: Response) => {
  const result = await loginService(req.body);
  res.status(200).send(result);
};

export const forgotPasswordController = async (req: Request, res: Response) => {
  const result = await forgotPasswordService (req.body);
  res.status(200).send(result);
};

export const resetPasswordController = async (req: Request, res: Response) => {
  const userId = res.locals.user.id;
  const result = await resetPasswordService(req.body, userId);
  res.status(200).send(result);
};

export const changePasswordController = async (req: Request, res: Response) => {
  const userId = res.locals.user.id;
  const result = await changePasswordService(req.body, userId);
  res.status(200).send(result);
};