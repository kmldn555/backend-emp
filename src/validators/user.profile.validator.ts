import z from "zod";

// schema update name
export const updateNameSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, { error: "name must be at least 2 characters" }),
});

export type UpdateNameSchema = z.infer<typeof updateNameSchema>;
