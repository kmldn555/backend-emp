import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../utils/api-error.js";
import { UpdateEventInput } from "../../validators/organizer.dashboard.validator.js";

// 1. Overview
// 2. MyEvents

export const findMyEventsService = async (organizerId: number) => {
  const events = await prisma.event.findMany({
    where: { userId: organizerId },
    include: { category: true, ticketTypes: true, vouchers: true },
    orderBy: { startDate: "asc" },
  });

  return {
    data: events.map((event) => ({
      ...event,
      ticketSold: event.ticketTypes.reduce(
        (total, ticket) => total + ticket.totalSeat - ticket.availableSeat,
        0,
      ),
    })),
  };
};

export const updateEventService = async (
  eventId: number,
  organizerId: number,
  data: UpdateEventInput,
) => {
  return prisma.$transaction(
    async (tx) => {
      // 1. Cari event beserta ticket types miliknya
      const event = await tx.event.findUnique({
        where: { id: eventId },
        include: {
          ticketTypes: true,
        },
      });

      if (!event) {
        throw new ApiError("Event not found", 404);
      }

      // 2. Pastikan event milik organizer yang login
      if (event.userId !== organizerId) {
        throw new ApiError("You are not allowed to edit this event", 403);
      }

      // 3. Pastikan kategori tersedia di database
      const category = await tx.category.findUnique({
        where: { id: data.categoryId },
      });

      if (!category) {
        throw new ApiError("Category not found", 404);
      }

      // 4. Hitung jumlah tiket yang sudah terjual
      const ticketSold = event.ticketTypes.reduce(
        (total, ticket) => total + ticket.totalSeat - ticket.availableSeat,
        0,
      );

      // 5. Organizer tidak boleh mengurangi total seat
      if (data.totalSeat < event.totalSeat) {
        throw new ApiError("Total seat cannot be reduced", 400);
      }

      // 6. Pastikan kapasitas baru cukup untuk tiket yang terjual
      if (data.totalSeat < ticketSold) {
        throw new ApiError("Total seat cannot be less than tickets sold", 400);
      }

      // 7. Hitung sisa kursi berdasarkan kapasitas baru
      const availableSeat = data.totalSeat - ticketSold;

      // 8. Update data event
      const updatedEvent = await tx.event.update({
        where: { id: eventId },
        data: {
          categoryId: data.categoryId,
          name: data.name,
          description: data.description,
          location: data.location,
          totalSeat: data.totalSeat,
          availableSeat,
          startDate: data.startDate,
          endDate: data.endDate,
          ...(data.thumbnail ? { thumbnail: data.thumbnail } : {}),
        },
        include: {
          category: true,
          ticketTypes: true,
          vouchers: true,
        },
      });

      return { data: updatedEvent };
    },
    {
      maxWait: 10000,
      timeout: 20000,
    },
  );
};

export const getEventGuestListService = async (
  eventId: number,
  organizerId: number,
  page: number,
  take: number,
  search: string,
) => {
  // Pastikan event tersedia dan dimiliki organizer yang login.
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: {
      id: true,
      userId: true,
    },
  });

  if (!event) {
    throw new ApiError("Event not found", 404);
  }

  if (event.userId !== organizerId) {
    throw new ApiError("You are not allowed to view this guest list", 403);
  }

  // Filter Attendance berdasarkan event dan pencarian nama.
  const where = {
    eventId,
    ...(search
      ? {
          user: {
            name: {
              contains: search,
              mode: "insensitive" as const,
            },
          },
        }
      : {}),
  };

  // Hitung total data untuk pagination.
  const total = await prisma.attendance.count({
    where,
  });

  // Ambil data yang diminta
  const attendances = await prisma.attendance.findMany({
    where,
    select: {
      id: true,
      ticketQuantity: true,
      user: {
        select: {
          name: true,
        },
      },
      transaction: {
        select: {
          totalAmount: true,
        },
      },
    },
    orderBy: {
      id: "desc",
    },
    skip: (page - 1) * take,
    take,
  });

  const data = attendances.map((attendance) => ({
    id: attendance.id,
    name: attendance.user.name,
    ticketQuantity: attendance.ticketQuantity,
    totalAmount: attendance.transaction.totalAmount,
  }));

  return {
    data,
    meta: {
      page,
      take,
      total,
    },
  };
};

// 3. Transaction
