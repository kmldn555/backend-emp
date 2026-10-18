import z from "zod";

export const createCategorySchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
});

export const editCategorySchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
});

export type EditCategorySchema = z.infer<typeof editCategorySchema>;
export type CreateCategorySchema = z.infer<typeof createCategorySchema>;
