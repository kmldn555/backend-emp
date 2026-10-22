import type { Request, Response } from "express";
import {
  findMyEventsService,
  getEventGuestListService,
  updateEventService,
} from "../../services/dashboard/organizer.dashboard.service.js";
import { ApiError } from "../../utils/api-error.js";
import { uploadImage } from "../../lib/cloudinary.js";

export const findMyEventsController = async (req: Request, res: Response) => {
  const organizerId = res.locals.user.id;
  const result = await findMyEventsService(organizerId);

  res.status(200).send(result);
};

export const updateEventController = async (req: Request, res: Response) => {
  const organizerId = res.locals.user.id;
  const eventId = Number(req.params.id);

  if (!Number.isInteger(eventId) || eventId <= 0) {
    throw new ApiError("Invalid event ID", 400);
  }

  let thumbnail: string | undefined;

  if (req.file) {
    thumbnail = await uploadImage(req.file);
  }

  const result = await updateEventService(eventId, organizerId, {
    ...req.body,
    ...(thumbnail ? { thumbnail } : {}),
  });

  res.status(200).send(result);
};

export const getEventGuestListController = async (
  req: Request,
  res: Response,
) => {
  const organizerId = res.locals.user.id;

  const { id: eventId } = res.locals.validatedParams as {
    id: number;
  };

  const { page, take, search } = res.locals.validatedQuery as {
    page: number;
    take: number;
    search: string;
  };

  const result = await getEventGuestListService(
    eventId,
    organizerId,
    page,
    take,
    search,
  );

  return res.status(200).json(result);
};
