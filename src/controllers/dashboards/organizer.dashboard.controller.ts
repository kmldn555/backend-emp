import type { Request, Response } from "express";
import {
  approveTransactionsService,
  findMyEventsService,
  getEventGuestListService,
  getOrganizerDonePaymentService,
  getOrganizerEventService,
  getOrganizerPendingPaymentService,
  getOrganizerRejectedPaymentService,
  getOrganizerSalesAnalyticsService,
  getOrganizerTicketSoldService,
  getOrganizerTotalRevenueService,
  getOrganizerTotalTransactionsService,
  getOrganizerTransactionsService,
  rejectTransactionsService,
  updateEventService,
} from "../../services/dashboard/organizer.dashboard.service.js";
import { ApiError } from "../../utils/api-error.js";
import { uploadImage } from "../../lib/cloudinary.js";

// overview
export const getOrganizerEventController = async (
  req: Request,
  res: Response,
) => {
  const organizerId = res.locals.user.id;
  const result = await getOrganizerEventService(organizerId);

  res.status(200).send(result);
};

export const getOrganizerTicketSoldController = async (
  req: Request,
  res: Response,
) => {
  const organizerId = res.locals.user.id;
  const result = await getOrganizerTicketSoldService(organizerId);

  res.status(200).send(result);
};

export const getOrganizerTotalRevenueController = async (
  req: Request,
  res: Response,
) => {
  const organizerId = res.locals.user.id;
  const result = await getOrganizerTotalRevenueService(organizerId);

  res.status(200).send(result);
};

export const getOrganizerSalesAnalyticsController = async (
  req: Request,
  res: Response,
) => {
  const organizerId = res.locals.user.id;

  const { period, selectedDate } = req.query;

  const result = await getOrganizerSalesAnalyticsService(
    organizerId,
    period as "year" | "month" | "day",
    selectedDate as string,
  );

  res.status(200).send(result);
};

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

export const getOrganizerPendingPaymentController = async (
  req: Request,
  res: Response,
) => {
  const organizerId = res.locals.user.id;
  const result = await getOrganizerPendingPaymentService(organizerId);

  res.status(200).send(result);
};

export const getOrganizerDonePaymentController = async (
  req: Request,
  res: Response,
) => {
  const organizerId = res.locals.user.id;
  const result = await getOrganizerDonePaymentService(organizerId);

  res.status(200).send(result);
};

export const getOrganizerRejectedPaymentController = async (
  req: Request,
  res: Response,
) => {
  const organizerId = res.locals.user.id;
  const result = await getOrganizerRejectedPaymentService(organizerId);

  res.status(200).send(result);
};

export const getOrganizerTransactionsController = async (
  req: Request,
  res: Response,
) => {
  const organizerId = res.locals.user.id;

  const page = Math.max(1, Number(req.query.page) || 1);
  const take = Math.min(100, Math.max(1, Number(req.query.take) || 10));

  const search = String(req.query.search ?? "");
  const allowedStatuses = [
    "ALL",
    "WAITING_FOR_ADMIN_CONFIRMATION",
    "DONE",
    "REJECTED",
  ] as const;

  const queryStatus = String(req.query.status ?? "ALL");

  const status = allowedStatuses.includes(
    queryStatus as (typeof allowedStatuses)[number],
  )
    ? (queryStatus as (typeof allowedStatuses)[number])
    : "ALL";

  const result = await getOrganizerTransactionsService(
    organizerId,
    page,
    take,
    search,
    status,
  );

  res.status(200).send(result);
};

export const getOrganizerTotalTransactionsController = async (
  req: Request,
  res: Response,
) => {
  const organizerId = res.locals.user.id;

  const result = await getOrganizerTotalTransactionsService(organizerId);

  res.status(200).send(result);
};

export const approveTransactionsController = async (
  req: Request,
  res: Response,
) => {
  const transactionId = Number(req.params.transactionId);
  const result = await approveTransactionsService(transactionId);

  res.status(200).send(result);
};

export const rejectTransactionsController = async (
  req: Request,
  res: Response,
) => {
  const transactionId = Number(req.params.transactionId);
  const result = await rejectTransactionsService(transactionId);

  res.status(200).send(result);
};
