import type { Request, Response, NextFunction } from "express";
import {
  getCustomerHistoryPointsService,
  getCustomerPointsService,
} from "../../services/dashboard/customer.dasboard.service.js";

export const getCustomerPointsController = async (
  req: Request,
  res: Response,
) => {
  const userId = res.locals.user.id;
  const result = await getCustomerPointsService(userId);

  res.status(200).send(result);
};

export const getCustomerHistoryPointsController = async (
  req: Request,
  res: Response,
) => {
  const userId = res.locals.user.id;

  const page = Number(req.query.page) || 1;
  const take = Number(req.query.take) || 5;

  const result = await getCustomerHistoryPointsService(userId, page, take);

  res.status(200).send(result);
};
