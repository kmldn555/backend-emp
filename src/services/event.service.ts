import { prisma } from '../lib/prisma.js';
import { CreateEventDTO, EventQueryFilter } from '../types/event.types.js';

export const createEventService = async (
  organizerId: number,
  data: CreateEventDTO,
  thumbnailUrl: string
) => {
  const totalSeat = (data.tickets || []).reduce(
    (acc, curr) => acc + Number(curr.totalSeat),
    0
  );

  return await prisma.$transaction(async (tx) => {
    // 1. Simpan Data Event
    const event = await tx.event.create({
      data: {
        userId: organizerId,
        categoryId: Number(data.categoryId),
        name: data.name,
        description: data.description,
        location: data.location,
        totalSeat,
        availableSeat: totalSeat,
        startDate: new Date(data.startDate),
        endDate: new Date(data.endDate),
        thumbnail: thumbnailUrl,
      },
    });

    // 2. Simpan Jenis Tiket (jika ada)
    if (data.tickets && data.tickets.length > 0) {
      await tx.ticketType.createMany({
        data: data.tickets.map((t) => ({
          eventId: event.id,
          name: t.name,
          price: Number(t.price),
          totalSeat: Number(t.totalSeat),
          availableSeat: Number(t.totalSeat),
        })),
      });
    }

    // 3. Simpan Voucher Promo Terbatas (Opsional)
    if (data.voucher && data.voucher.code) {
      await tx.voucher.create({
        data: {
          eventId: event.id,
          code: data.voucher.code.toUpperCase().trim(),
          notes: data.voucher.notes || '',
          discountValue: Number(data.voucher.discountValue),
          maxUsage: Number(data.voucher.maxUsage),
          usedCount: 0,
          startAt: new Date(data.voucher.startAt),
          expiresAt: new Date(data.voucher.expiresAt),
          isActive: true,
        },
      });
    }

    return event;
  });
};

export const findEventsService = async (filters: EventQueryFilter) => {
  const { search, categoryId, location, page = 1, limit = 12 } = filters;
  const pageNum = Math.max(1, Number(page));
  const limitNum = Math.max(1, Number(limit));
  const skip = (pageNum - 1) * limitNum;

  const where: any = {};

  if (search && search.trim() !== '') {
    where.name = { contains: search.trim(), mode: 'insensitive' };
  }

  if (categoryId) {
    where.categoryId = Number(categoryId);
  }

  if (location && location !== 'Semua Lokasi') {
    where.location = { contains: location.trim(), mode: 'insensitive' };
  }

  const [events, total] = await Promise.all([
    prisma.event.findMany({
      where,
      include: {
        category: true,
        ticketTypes: true,
        vouchers: true,
      },
      orderBy: { startDate: 'asc' },
      skip,
      take: limitNum,
    }),
    prisma.event.count({ where }),
  ]);

  return {
    data: events,
    meta: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum),
    },
  };
};

export const findEventByIdService = async (id: number) => {
  return await prisma.event.findUnique({
    where: { id },
    include: {
      category: true,
      ticketTypes: true,
      vouchers: {
        where: { isActive: true, expiresAt: { gt: new Date() } },
      },
      user: {
        select: { id: true, name: true, profilePicture: true },
      },
    },
  });
};