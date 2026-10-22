import type { NextFunction, Request, Response } from "express";
import { ZodError, type ZodType } from "zod";
import { ApiError } from "../utils/api-error.js";

type ValidationTarget = "body" | "params" | "query";

export const validate = (
  schema: ZodType,
  target: ValidationTarget = "body",
) => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsedData = schema.parse(req[target]);

      if (target === "body") {
        req.body = parsedData;
      } else {
        // Simpan hasil validasi agar tipe hasil Zod tetap terjaga
        // dan bisa digunakan oleh controller.
        res.locals[target === "params" ? "validatedParams" : "validatedQuery"] =
          parsedData;
      }

      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const message = error.issues
          .map((issue) => `${issue.path.join(".")} : ${issue.message}`)
          .join(",");

        next(new ApiError(message, 400));
        return;
      }

      next(error);
    }
  };
};
