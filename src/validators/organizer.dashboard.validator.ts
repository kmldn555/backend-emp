import { z } from "zod";

export const updateEventSchema = z
  .object({
    categoryId: z.coerce.number().int().positive(),
    name: z.string().trim().min(1, "Event name is required"),
    description: z.string().trim().min(1, "Description is required"),
    location: z.string().trim().min(1, "Location is required"),
    totalSeat: z.coerce.number().int().positive(),
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
    thumbnail: z.string().url("Thumbnail must be a valid URL").optional(),
  })
  .refine((data) => data.endDate >= data.startDate, {
    message: "End date must be after or equal to start date",
    path: ["endDate"],
  });

export type UpdateEventInput = z.infer<typeof updateEventSchema>;

export const guestListParamsSchema = z.object({
  id: z.coerce.number().int().positive("Event ID must be a positive integer"),
});

export const guestListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  take: z.coerce.number().int().min(1).max(100).default(5),
  search: z.string().trim().default(""),
});

export type GuestListParamsInput = z.infer<typeof guestListParamsSchema>;

export type GuestListQueryInput = z.infer<typeof guestListQuerySchema>;
