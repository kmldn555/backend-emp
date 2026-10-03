import { NextFunction, Request, Response } from "express";
import { ZodError, ZodType } from "zod";
import { ApiError } from "../utils/api-error.js";

export const validate = (schema: ZodType) => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const message = error.issues
          .map((issue) => `${issue.path.join(".")} : ${issue.message}`)
          .join(",");

        throw new ApiError(message, 400);
      }
      next(error);
    }
  };
};
