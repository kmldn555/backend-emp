import type { NextFunction, Request, Response } from "express";
import { ApiError } from "../utils/api-error.js";

export const parseEventData = (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  try {
    if (typeof req.body.data !== "string") {
      throw new ApiError("Event data is required", 400);
    }

    req.body = JSON.parse(req.body.data);
    next();
  } catch (error) {
    if (error instanceof ApiError) {
      return next(error);
    }

    return next(new ApiError("Invalid event data JSON", 400));
  }
};