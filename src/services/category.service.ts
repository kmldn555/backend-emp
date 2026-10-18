import { prisma } from "../lib/prisma.js";
import { ApiError } from "../utils/api-error.js";
import {
  CreateCategorySchema,
  EditCategorySchema,
} from "../validators/category.validator.js";

export const getCategoriesService = async () => {
  return await prisma.category.findMany({
    orderBy: {
      id: "asc",
    },
  });
};

export const createCategoryService = async (body: CreateCategorySchema) => {
  const category = await prisma.category.findFirst({
    where: { name: { equals: body.name, mode: "insensitive" } },
  });

  if (category) {
    throw new ApiError("Category name already exists", 400);
  }

  await prisma.category.create({ data: { name: body.name } });

  return { message: "Create category success" };
};

export const editCategoryService = async (
  categoryId: number,
  body: EditCategorySchema,
) => {
  const category = await prisma.category.findUnique({
    where: { id: categoryId },
  });
  if (!category) {
    throw new ApiError("Category not found", 404);
  }

  const existingCategory = await prisma.category.findFirst({
    where: {
      name: { equals: body.name, mode: "insensitive" },
      id: { not: categoryId },
    },
  });

  if (existingCategory) {
    throw new ApiError("Category name already exists", 400);
  }

  await prisma.category.update({
    where: { id: categoryId },
    data: { name: body.name },
  });

  return { message: "Update category success" };
};

export const deleteCategoryService = async (categoryId: number) => {
  const category = await prisma.category.findUnique({
    where: { id: categoryId },
  });

  if (!category) {
    throw new ApiError("Category not found", 404);
  }

  const categoryUsed = await prisma.event.count({
    where: { categoryId: categoryId },
  });

  if (categoryUsed > 0) {
    throw new ApiError("Category is still in use", 409);
  }

  await prisma.category.delete({
    where: { id: categoryId },
  });

  return { message: "Delete category success" };
};
