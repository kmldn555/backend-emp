import { NextFunction, Request, Response } from "express";
import { ApiError } from "./api-error.js";

export const globalError = (
  err: ApiError,
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const message = err.message || "Something went wrong";
  const status = err.status || 500;

  console.log(err)

  res.status(status).send({ message });
};

export const notFoundError = (req: Request, res: Response) => {
  res.status(404).send({ message: "Route not found!" });
};
