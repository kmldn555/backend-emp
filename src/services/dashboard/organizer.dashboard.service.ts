import { StatusTransaction } from "../../generated/prisma/enums.js";
import { sendMail } from "../../lib/mail.js";
import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../utils/api-error.js";
import { UpdateEventInput } from "../../validators/organizer.dashboard.validator.js";

// 1. Overview
export const getOrganizerEventService = async (organizerId: number) => {
  const totalEvents = await prisma.event.count({
    where: { userId: organizerId },
  });

  return totalEvents;
};

export const getOrganizerTicketSoldService = async (organizerId: number) => {
  const totalTicketSold = await prisma.attendance.aggregate({
    where: {
      event: {
        userId: organizerId,
      },
    },
    _sum: {
      ticketQuantity: true,
    },
  });

  return totalTicketSold._sum.ticketQuantity ?? 0;
};

export const getOrganizerTotalRevenueService = async (organizerId: number) => {
  const result = await prisma.transaction.aggregate({
    where: {
      attendances: {
        some: {
          event: {
            userId: organizerId,
          },
        },
      },
    },
    _sum: {
      totalAmount: true,
    },
  });

  return result._sum.totalAmount ?? 0;
};

type SalesPeriod = "year" | "month" | "day";

export const getOrganizerSalesAnalyticsService = async (
  organizerId: number,
  period: SalesPeriod,
  selectedDate: string,
) => {
  const [year, month, day] = selectedDate.split("-").map(Number);

  let startDate: Date;
  let endDate: Date;
  let labels: string[];

  const monthLabels = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];

  if (period === "year") {
    startDate = new Date(year, 0, 1);
    endDate = new Date(year + 1, 0, 1);
    labels = monthLabels;
  } else if (period === "month") {
    startDate = new Date(year, month - 1, 1);
    endDate = new Date(year, month, 1);

    const daysInMonth = new Date(year, month, 0).getDate();

    labels = Array.from({ length: daysInMonth }, (_, index) =>
      String(index + 1),
    );
  } else {
    startDate = new Date(year, month - 1, day);
    endDate = new Date(year, month - 1, day + 1);

    labels = Array.from(
      { length: 24 },
      (_, index) => `${String(index).padStart(2, "0")}:00`,
    );
  }

  // Query pengambilan data
  const attendances = await prisma.attendance.findMany({
    where: {
      event: {
        userId: organizerId,
      },
      transaction: {
        createdAt: {
          gte: startDate,
          lt: endDate,
        },
      },
    },
    select: {
      ticketQuantity: true,
      transaction: {
        select: {
          createdAt: true,
          totalAmount: true,
        },
      },
    },
  });

  const groupedData: Record<
    string,
    {
      label: string;
      tickets: number;
      revenue: number;
    }
  > = {};

  for (const attendance of attendances) {
    const date = attendance.transaction.createdAt;

    const label =
      period === "year"
        ? monthLabels[date.getMonth()]
        : period === "month"
          ? String(date.getDate())
          : `${String(date.getHours()).padStart(2, "0")}:00`;

    if (!groupedData[label]) {
      groupedData[label] = {
        label,
        tickets: 0,
        revenue: 0,
      };
    }

    groupedData[label].tickets += attendance.ticketQuantity;
    groupedData[label].revenue += attendance.transaction.totalAmount;
  }

  return labels.map(
    (label) =>
      groupedData[label] ?? {
        label,
        tickets: 0,
        revenue: 0,
      },
  );
};

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

export const getOrganizerDonePaymentService = async (organizerId: number) => {
  const result = await prisma.transaction.count({
    where: {
      status: StatusTransaction.DONE,
      transactionItems: {
        some: {
          ticketType: {
            event: {
              userId: organizerId,
            },
          },
        },
      },
    },
  });

  return result ?? 0;
};

export const getOrganizerPendingPaymentService = async (
  organizerId: number,
) => {
  const result = await prisma.transaction.count({
    where: {
      status: StatusTransaction.WAITING_FOR_ADMIN_CONFIRMATION,
      transactionItems: {
        some: {
          ticketType: {
            event: {
              userId: organizerId,
            },
          },
        },
      },
    },
  });

  return result ?? 0;
};

export const getOrganizerRejectedPaymentService = async (
  organizerId: number,
) => {
  const result = await prisma.transaction.count({
    where: {
      status: StatusTransaction.REJECTED,
      transactionItems: {
        some: {
          ticketType: {
            event: {
              userId: organizerId,
            },
          },
        },
      },
    },
  });

  return result ?? 0;
};

// Table Transaction
type TransactionStatusFilter =
  | "ALL"
  | "WAITING_FOR_ADMIN_CONFIRMATION"
  | "DONE"
  | "REJECTED";

export const getOrganizerTransactionsService = async (
  organizerId: number,
  page: number,
  take: number,
  search: string,
  status: TransactionStatusFilter,
) => {
  const where = {
    status: {
      in:
        status === "ALL"
          ? [
              StatusTransaction.WAITING_FOR_ADMIN_CONFIRMATION,
              StatusTransaction.DONE,
              StatusTransaction.REJECTED,
            ]
          : [status],
    },
    transactionItems: {
      some: {
        ticketType: {
          event: {
            userId: organizerId,
          },
        },
      },
    },
    ...(search
      ? {
          OR: [
            {
              id: Number.isInteger(Number(search)) ? Number(search) : -1,
            },
            {
              user: {
                name: {
                  contains: search,
                  mode: "insensitive" as const,
                },
              },
            },
            {
              transactionItems: {
                some: {
                  ticketType: {
                    event: {
                      name: {
                        contains: search,
                        mode: "insensitive" as const,
                      },
                    },
                  },
                },
              },
            },
          ],
        }
      : {}),
  };

  const [transactions, total] = await prisma.$transaction([
    prisma.transaction.findMany({
      where,
      select: {
        id: true,
        status: true,
        totalAmount: true,
        paymentProof: true,
        createdAt: true,

        user: {
          select: {
            name: true,
            email: true,
          },
        },

        transactionItems: {
          select: {
            quantity: true,
            ticketType: {
              select: {
                event: {
                  select: {
                    id: true,
                    name: true,
                    startDate: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      skip: (page - 1) * take,
      take,
    }),

    prisma.transaction.count({ where }),
  ]);

  const data = transactions.map((transaction) => ({
    id: transaction.id,
    status: transaction.status,
    customerName: transaction.user.name,
    customerEmail: transaction.user.email,
    eventName: transaction.transactionItems[0]?.ticketType.event.name ?? "",
    eventDate:
      transaction.transactionItems[0]?.ticketType.event.startDate ?? null,
    transactionDate: transaction.createdAt,
    ticketQuantity: transaction.transactionItems.reduce(
      (total, item) => total + item.quantity,
      0,
    ),
    totalPayment: transaction.totalAmount,
    paymentProof: transaction.paymentProof,
  }));

  return {
    data,
    meta: {
      page,
      take,
      total,
      totalPages: Math.ceil(total / take),
    },
  };
};

type TransactionStatusForTotal =
  | "WAITING_FOR_ADMIN_CONFIRMATION"
  | "DONE"
  | "REJECTED";

export const getOrganizerTotalTransactionsService = async (
  organizerId: number,
) => {
  const totalTransactions = await prisma.transaction.count({
    where: {
      status: {
        in: ["WAITING_FOR_ADMIN_CONFIRMATION", "DONE", "REJECTED"],
      },
      transactionItems: {
        some: {
          ticketType: {
            event: {
              userId: organizerId,
            },
          },
        },
      },
    },
  });

  return totalTransactions;
};

// update status by button approved
export const approveTransactionsService = async (transactionId: number) => {
  const result = await prisma.$transaction(async (tx) => {
    // 1. Ambil transaksi jika ada
    const transaction = await tx.transaction.findUnique({
      where: { id: transactionId },
      include: {
        user: {
          select: { name: true, email: true },
        },
        transactionItems: {
          include: {
            ticketType: {
              include: {
                event: true,
              },
            },
          },
        },
      },
    });

    // 2. Cek transaction apakah memang ada
    if (!transaction) {
      throw new ApiError("Transaction not found", 404);
    }

    // 3. Memastikan status masih waiting for admin confirmation
    if (transaction.status !== "WAITING_FOR_ADMIN_CONFIRMATION") {
      throw new ApiError("Transaction cannot be approved", 400);
    }

    // 4. update status pada transaction
    const newStatus = await tx.transaction.update({
      where: { id: transactionId },
      data: {
        status: "DONE",
      },
    });

    // 5. mengambil data eventId dan ticket quantity untuk attendance
    const eventId = transaction.transactionItems[0].ticketType.event.id;
    const ticketQuantity = transaction.transactionItems.reduce((sum, item) => {
      return sum + item.quantity;
    }, 0);

    // 6. Membuat guest list di table attendance
    const newGuest = await tx.attendance.create({
      data: {
        attended: true,
        transactionId: transaction.id,
        eventId: eventId,
        ticketQuantity: ticketQuantity,
        checkedInAt: new Date(),
        userId: transaction.userId,
      },
    });

    // 7.mengirimkan email status approval
    const customerName = transaction.user.name;
    const customerEmail = transaction.user.email;

    const eventName = transaction.transactionItems[0]?.ticketType.event.name;

    const tickets = transaction.transactionItems.map((item) => ({
      ticketName: item.ticketType.name,
      quantity: item.quantity,
      price: new Intl.NumberFormat("id-ID", {
        style: "currency",
        currency: "IDR",
        maximumFractionDigits: 0,
      }).format(item.price),
    }));

    const totalAmount = new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      maximumFractionDigits: 0,
    }).format(transaction.totalAmount);

    const status = newStatus.status;

    return {
      newStatus,
      customerEmail,
      customerName,
      eventName,
      tickets,
      totalAmount,
      status,
      transactionId: transaction.id,
    };
  });

  await sendMail({
    to: result.customerEmail,
    subject: "Transaction Approved",
    templateName: "transactionApprove.hbs",
    context: {
      transactionId: result.transactionId,
      customerName: result.customerName,
      customerEmail: result.customerEmail,
      eventName: result.eventName,
      ticketRows: result.tickets,
      totalAmount: result.totalAmount,
      status: result.status,
    },
  });

  return {
    message: "Transaction approved successfully",
    transaction: result.newStatus,
  };
};

// update status by button reject
export const rejectTransactionsService = async (transactionId: number) => {
  const result = await prisma.$transaction(async (tx) => {
    // 1. Ambil transaksi jika ada
    const transaction = await tx.transaction.findUnique({
      where: { id: transactionId },
      include: {
        user: {
          select: { name: true, email: true },
        },
        transactionItems: {
          include: {
            ticketType: {
              include: {
                event: true,
              },
            },
          },
        },
      },
    });

    // 2. Cek transaction apakah memang ada
    if (!transaction) {
      throw new ApiError("Transaction not found", 404);
    }

    // 3. Memastikan status masih waiting for admin confirmation
    if (transaction.status !== "WAITING_FOR_ADMIN_CONFIRMATION") {
      throw new ApiError("Transaction cannot be rejected", 400);
    }

    // 4. Kembalikan kursi setiap ticket type
    for (const item of transaction.transactionItems) {
      await tx.ticketType.update({
        where: { id: item.ticketTypeId },
        data: {
          availableSeat: {
            increment: item.quantity,
          },
        },
      });
    }

    // 5. Hitung total seluruh tiket dalam transaksi
    const totalTickets = transaction.transactionItems.reduce(
      (total, item) => total + item.quantity,
      0,
    );

    // 6. Kembalikan kursi event
    const eventId = transaction.transactionItems[0]?.ticketType.eventId;

    if (eventId !== undefined) {
      await tx.event.update({
        where: { id: eventId },
        data: {
          availableSeat: {
            increment: totalTickets,
          },
        },
      });
    }

    // 7. Aktifkan kembali coupon jika transaksi menggunakan coupon
    if (transaction.couponId !== null) {
      await tx.coupon.update({
        where: {
          id: transaction.couponId,
        },
        data: {
          isUsed: false,
        },
      });
    }

    // 8. Kembalikan penggunaan voucher jika transaksi menggunakan voucher
    if (transaction.voucherId !== null) {
      await tx.voucher.update({
        where: {
          id: transaction.voucherId,
        },
        data: {
          usedCount: {
            decrement: 1,
          },
        },
      });
    }

    // pengembalian point


    // 9. update status pada transaction
    const newStatus = await tx.transaction.update({
      where: { id: transactionId },
      data: {
        status: "REJECTED",
      },
    });

    // 10. Mengambil data untuk email rejection
    const customerName = transaction.user.name;
    const customerEmail = transaction.user.email;

    const eventName = transaction.transactionItems[0]?.ticketType.event.name;

    const tickets = transaction.transactionItems.map((item) => ({
      ticketName: item.ticketType.name,
      quantity: item.quantity,
      price: new Intl.NumberFormat("id-ID", {
        style: "currency",
        currency: "IDR",
        maximumFractionDigits: 0,
      }).format(item.price),
    }));

    const totalAmount = new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      maximumFractionDigits: 0,
    }).format(transaction.totalAmount);

    const status = newStatus.status;

    return {
      newStatus,
      customerEmail,
      customerName,
      eventName,
      tickets,
      totalAmount,
      status,
      transactionId: transaction.id,
    };
  });

  // 11. Kirim  email
  try {
    await sendMail({
      to: result.customerEmail,
      subject: "Transaction Rejected",
      templateName: "transactionReject.hbs",
      context: {
        transactionId: result.transactionId,
        customerName: result.customerName,
        customerEmail: result.customerEmail,
        eventName: result.eventName,
        ticketRows: result.tickets,
        totalAmount: result.totalAmount,
        status: result.status,
      },
    });
  } catch (error) {
    throw new ApiError("Failed to send email rejected", 400);
  }

  return {
    message: "Transaction rejected successfully",
    transaction: result.newStatus,
  };
};