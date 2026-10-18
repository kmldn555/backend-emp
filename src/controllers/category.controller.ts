import { Request, Response } from "express";
import {
  createCategoryService,
  deleteCategoryService,
  editCategoryService,
  getCategoriesService,
} from "../services/category.service.js";
import { ApiError } from "../utils/api-error.js";

export const getCategoriesController = async (req: Request, res: Response) => {
  const result = await getCategoriesService();
  res.status(200).send(result);
};
export const createCategoryController = async (req: Request, res: Response) => {
  const result = await createCategoryService(req.body);
  res.status(201).send(result);
};

export const editCategoryController = async (req: Request, res: Response) => {
  const categoryId = Number(req.params.id);

  // Memastikan id yg diterima berupa bilangaan bulat
  if (!Number.isInteger(categoryId) || categoryId <= 0) {
    throw new ApiError("Invalid category ID", 400);
  }

  const result = await editCategoryService(categoryId, req.body);
  res.status(200).send(result);
};

export const deleteCategoryController = async (req: Request, res: Response) => {
  const categoryId = Number(req.params.id);

  if (!Number.isInteger(categoryId) || categoryId <= 0) {
    throw new ApiError("Invalid category ID", 400);
  }

  const result = await deleteCategoryService(categoryId);
  res.status(200).send(result);
};
