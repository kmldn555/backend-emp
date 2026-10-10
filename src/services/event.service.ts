import { prisma } from "../lib/prisma.js";
import { CreateEventDTO, EventQueryFilter } from "../types/event.types.js";

export class EventService {
  static async createEvent(
    organizerId: number,
    data: CreateEventDTO,
    thumbnailUrl: string,
  ) {
    console.log("Data DTO diterima:", data);
    console.log("Organizer ID: ", organizerId);
    const totalSeat = data.tickets.reduce(
      (acc, curr) => acc + Number(curr.totalSeat),
      0,
    );

    try {
      return await prisma.$transaction(async (tx) => {
        // 1. Create Base Event
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

        // 2. Create Ticket Tiers
        await tx.ticketType.createMany({
          data: data.tickets.map((t) => ({
            eventId: event.id,
            name: t.name,
            price: Number(t.price),
            totalSeat: Number(t.totalSeat),
            availableSeat: Number(t.totalSeat),
          })),
        });

        // 3. Create Voucher Promotion (if defined)
        if (data.voucher && data.voucher.code) {
          await tx.voucher.create({
            data: {
              eventId: event.id,
              code: data.voucher.code.toUpperCase(),
              notes: data.voucher.notes || "",
              discountValue: Number(data.voucher.discountValue),
              maxUsage: Number(data.voucher.maxUsage),
              usedCount: 0,
              startAt: new Date(data.voucher.startAt),
              expiresAt: new Date(data.voucher.expiresAt),
              isActive: true,
            },
          });
        }
        console.log("Event berhasil dibuat, ID:", event.id);
        return event;
      });
    } catch (error) {
      console.error("ERROR saat transaksi createEvent: ", error);
      throw error;
    }
  }

  static async findEvents(filters: EventQueryFilter) {
    const { search, categoryId, location, page = 1, limit = 12 } = filters;
    const skip = (Number(page) - 1) * Number(limit);

    const where: any = {};

    if (search) {
      where.name = { contains: search, mode: "insensitive" };
    }

    if (categoryId) {
      where.categoryId = Number(categoryId);
    }

    if (location && location !== "Semua Lokasi") {
      where.location = { contains: location, mode: "insensitive" };
    }

    const [events, total] = await Promise.all([
      prisma.event.findMany({
        where,
        include: {
          category: true,
          ticketTypes: true,
          vouchers: true,
        },
        orderBy: { startDate: "asc" },
        skip,
        take: Number(limit),
      }),
      prisma.event.count({ where }),
    ]);

    return {
      data: events,
      meta: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit)),
      },
    };
  }

  static async findEventById(id: number) {
    return prisma.event.findUnique({
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
  }
}
