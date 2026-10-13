import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { ApiError } from "../utils/api-error.js";

export const verifyToken = (secretKey: string) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const token = req.headers.authorization?.split(" ")[1]; // Bearer tokennya

    if (!token) {
      throw new ApiError("No token provided", 401);
    }

    try {
      const payload = jwt.verify(token, secretKey);
      res.locals.user = payload;
      next();
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        return next(new ApiError("Token expired", 401));
      }

      return next(new ApiError("Token invalid", 401));
    }
  };
};
