import { Request, Response } from "express";
import { loginService, registerService } from "../services/user.auth.service.js";

export const registerController = async (req: Request, res: Response) => {
  const result = await registerService(req.body);
  res.status(200).send(result);
};

export const loginController = async (req: Request, res: Response) => {
  const result = await loginService(req.body);
  res.status(200).send(result);
};