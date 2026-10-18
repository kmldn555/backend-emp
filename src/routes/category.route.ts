import express from "express";
import {
  createCategoryController,
  deleteCategoryController,
  editCategoryController,
  getCategoriesController,
} from "../controllers/category.controller.js";

import {
  createCategorySchema,
  editCategorySchema,
} from "../validators/category.validator.js";
import { validate } from "../middleware/validation.middleware.js";

const categoryRoutes = express.Router();

categoryRoutes.get("/", getCategoriesController);
categoryRoutes.post(
  "/",
  validate(createCategorySchema),
  createCategoryController,
);
categoryRoutes.patch(
  "/:id",
  validate(editCategorySchema),
  editCategoryController,
);

categoryRoutes.delete("/:id", deleteCategoryController);

export default categoryRoutes;
