import { NextFunction, Request, Response } from "express";
import {
  createEventService,
  findEventByIdService,
  findEventsService,
} from "../services/event.service.js";
import { uploadImage } from "../lib/cloudinary.js";
import { ApiError } from "../utils/api-error.js";

// Controller create event
export const createEventController = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const organizerId = res.locals.user.id;

    if (!req.file) {
      throw new ApiError("Thumbnail file is required.", 400);
    }

    if (!req.body.data) {
      throw new ApiError("Payload data is required.", 400);
    }

    // Parsing payload form-data yang dikirim sebagai JSON string
    let parsedPayload;
    try {
      parsedPayload =
        typeof req.body.data === "string"
          ? JSON.parse(req.body.data)
          : req.body.data;
    } catch {
      throw new ApiError("Invalid JSON format in payload data.", 400);
    }

    // Upload image ke Cloudinary
    const thumbnailUrl = await uploadImage(req.file);

    // Panggil fungsi service secara langsung
    const createdEvent = await createEventService(
      organizerId,
      parsedPayload,
      thumbnailUrl,
    );

    return res.status(201).json({
      message: "Event and tickets successfully created.",
      data: createdEvent,
    });
  } catch (error) {
    next(error);
  }
};

// Controller get semua event (dengan Backend Pagination)
export const getEventsController = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { search, categoryId, location, page, limit } = req.query;

    const result = await findEventsService({
      search: search as string,
      categoryId: categoryId ? Number(categoryId) : undefined,
      location: location as string,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 8,
    });

    return res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

// Controller get spesifik event
export const getEventByIdController = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const eventId = Number(req.params.id);
    if (isNaN(eventId) || eventId <= 0) {
      throw new ApiError("Invalid Event ID format.", 400);
    }

    const event = await findEventByIdService(eventId);

    return res.status(200).json({ data: event });
  } catch (error) {
    next(error);
  }
};