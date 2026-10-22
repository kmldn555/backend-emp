import { Request, Response } from "express";
import { getTotalCategoriesService, getTotalCustomerService, getTotalEventService, getTotalOrganizerService, getUsersService } from "../../services/dashboard/admin.dashboard.service.js";

export const getTotalCustomerController = async (
  req: Request,
  res: Response,
) => {
  const result = await getTotalCustomerService();
  res.status(200).send(result);
};

export const getTotalOrganizerController = async (
  req: Request,
  res: Response,
) => {
  const result = await getTotalOrganizerService();
  res.status(200).send(result);
};

export const getTotalEventController = async (
  req: Request,
  res: Response,
) => {
  const result = await getTotalEventService();
  res.status(200).send(result);
};

export const getTotalCategoriesController = async (
  req: Request,
  res: Response,
) => {
  const result = await getTotalCategoriesService();
  res.status(200).send(result);
};

export const getUsersController = async (req: Request, res: Response) => {
  const query = {
    page: parseInt(req.query.page as string) || 1,
    take: parseInt(req.query.take as string) || 10,
    sortOrder: (req.query.sortOrder as string) || "desc",
    sortBy: (req.query.sortBy as string) || "createdAt",
    search: (req.query.search as string) || "",
    role: (req.query.role as string) || "",
  };

  const result = await getUsersService(query);
  res.status(200).send(result);
};
