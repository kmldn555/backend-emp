import { Prisma } from "../generated/prisma/client.js";
import { StatusTransaction, UserRole } from "../generated/prisma/enums.js";
import { prisma } from "../lib/prisma.js";
import { PaginationQueryParams } from "../types/pagination.types.js";
import { ApiError } from "../utils/api-error.js";

// 1. Prisma Interactive Transaction Timeout Configuration (prevents 5000ms cloud DB timeout)
const TX_OPTIONS = {
  maxWait: 10000,
  timeout: 20000,
};

// Business rule constants
const MIN_TRX_AFTER_VOUCHER_FOR_COUPON = 30000; // Rule h: Minimum IDR 30,000 after voucher discount
const FIXED_COUPON_DISCOUNT = 10000;            // Rule j: Fixed coupon discount of IDR 10,000
const MIN_TRX_FOR_POINTS = 100000;              // Rule o: Minimum subtotal of IDR 100,000 to use points
const MAX_POINTS_PER_TRX = 20000;               // Rule o: Maximum 20,000 points per transaction
const POINT_MULTIPLE = 10000;                   // Rule o: Points must be used in multiples of 10,000

export interface CheckoutItemInput {
  ticketTypeId: number;
  quantity: number;
}

export interface CreateTransactionInput {
  userId: number;
  eventId: number;
  items: CheckoutItemInput[];
  voucherCode?: string;
  couponCode?: string;
  usePoints: boolean;
}

// Reusable Prisma include for consistent nested transaction details
export const transactionDetailInclude = {
  transactionItems: {
    include: {
      ticketType: {
        include: {
          event: {
            select: {
              id: true,
              name: true,
              location: true,
              startDate: true,
              endDate: true,
              thumbnail: true,
            },
          },
        },
      },
    },
  },
  voucher: true,
  coupon: true,
  attendances: {
    include: {
      reviews: true,
    },
  },
} satisfies Prisma.TransactionInclude;

/**
 * Rule n: Retrieve the customer's active points balance using Prisma aggregate
 * from the point_lots table where remainingAmount > 0 and expiresAt > now.
 */
export const getActivePointsBalance = async (
  db: Prisma.TransactionClient | typeof prisma,
  userId: number,
): Promise<number> => {
  const now = new Date();

  const aggregation = await db.pointLot.aggregate({
    where: {
      userId,
      remainingAmount: { gt: 0 },
      expiresAt: { gt: now },
    },
    _sum: {
      remainingAmount: true,
    },
  });

  return aggregation._sum.remainingAmount ?? 0;
};

/**
 * Rules h, j, o: Pure helper to calculate IDR subtotal, voucher discount, coupon discount, and points.
 * - Coupon: Only valid if (subtotal - voucherDiscount) >= 30,000; fixed discount of 10,000.
 * - Points: Single use per checkout, minimum transaction 100,000, maximum 20,000 points,
 *   and must be in multiples of 10,000 (0, 10,000, or 20,000).
 */
export const calculatePricing = (
  subtotal: number,
  voucherDiscount: number,
  couponDiscount: number,
  availableUserPoints: number,
  usePoints: boolean,
) => {
  // Price after subtracting voucher (never negative)
  const priceAfterVoucher = Math.max(0, subtotal - voucherDiscount);

  // Price after subtracting coupon (never negative)
  const priceAfterPromos = Math.max(0, priceAfterVoucher - couponDiscount);

  let pointsDiscount = 0;

  // Rule o: Points can only be used if usePoints = true and subtotal >= 100,000
  if (
    usePoints &&
    subtotal >= MIN_TRX_FOR_POINTS &&
    priceAfterPromos >= POINT_MULTIPLE
  ) {
    // Cap at 20,000 points, active PointLot balance, and remaining bill
    const maxRawPoints = Math.min(
      Math.max(0, availableUserPoints),
      MAX_POINTS_PER_TRX,
      priceAfterPromos,
    );

    // Round down to nearest multiple of 10,000 (0, 10,000, or 20,000)
    pointsDiscount = Math.floor(maxRawPoints / POINT_MULTIPLE) * POINT_MULTIPLE;
  }

  // Final payable amount in IDR
  const totalAmount = Math.max(0, priceAfterPromos - pointsDiscount);

  return {
    priceAfterVoucher,
    priceAfterPromos,
    pointsDiscount,
    totalAmount,
  };
};

/**
 * Centralized Atomic Rollback Helper (Triggered when status becomes EXPIRED, REJECTED, or CANCELED).
 * Restores 4 resources atomically:
 * 1. Voucher (usedCount decremented by 1) -> Rule e
 * 2. Coupon (isUsed reset to false) -> Rule i
 * 3. Seats (availableSeat in Event & TicketType incremented back) -> Rule m
 * 4. Points (remainingAmount in used PointLots & User.points restored) -> Rule p
 */
export const rollbackTransactionResources = async (
  tx: Prisma.TransactionClient,
  transactionId: number,
  targetStatus: "EXPIRED" | "CANCELED" | "REJECTED",
) => {
  // 1. Fetch transaction and its ticket items
  const trx = await tx.transaction.findUnique({
    where: { id: transactionId },
    include: {
      transactionItems: {
        include: {
          ticketType: true,
        },
      },
    },
  });

  if (!trx) {
    throw new ApiError(
      `Transaction #${transactionId} not found for rollback.`,
      404,
    );
  }

  // Guard against double-rollback if already rolled back or completed
  if (
    trx.status === StatusTransaction.EXPIRED ||
    trx.status === StatusTransaction.CANCELED ||
    trx.status === StatusTransaction.REJECTED ||
    trx.status === StatusTransaction.DONE
  ) {
    return await tx.transaction.findUniqueOrThrow({
      where: { id: transactionId },
      include: transactionDetailInclude,
    });
  }

  // 2. Rule m: Restore availableSeat on TicketType and parent Event
  const eventSeatsMap = new Map<number, number>();

  for (const item of trx.transactionItems) {
    const qty = Number(item.quantity) || 0;
    if (qty <= 0) continue;

    const eventId = item.ticketType.eventId;
    eventSeatsMap.set(eventId, (eventSeatsMap.get(eventId) || 0) + qty);

    await tx.ticketType.update({
      where: { id: item.ticketTypeId },
      data: { availableSeat: { increment: qty } },
    });
  }

  for (const [eventId, totalSeatsToRestore] of eventSeatsMap.entries()) {
    if (totalSeatsToRestore > 0) {
      await tx.event.update({
        where: { id: eventId },
        data: { availableSeat: { increment: totalSeatsToRestore } },
      });
    }
  }

  // 3. Rule e: Decrement usedCount on Voucher
  if (trx.voucherId) {
    await tx.voucher.update({
      where: { id: trx.voucherId },
      data: { usedCount: { decrement: 1 } },
    });
  }

  // 4. Rule i: Reset isUsed to false on Coupon
  if (trx.couponId) {
    await tx.coupon.update({
      where: { id: trx.couponId },
      data: { isUsed: false },
    });
  }

  // 5. Rule p: Restore remainingAmount on PointLots ordered by earliest expiration
  if (trx.pointsDiscount > 0) {
    const userLots = await tx.pointLot.findMany({
      where: { userId: trx.userId },
      orderBy: { expiresAt: "asc" },
    });

    let pointsLeftToRestore = trx.pointsDiscount;

    for (const lot of userLots) {
      if (pointsLeftToRestore <= 0) break;

      const usedInThisLot = Math.max(0, lot.amount - lot.remainingAmount);

      if (usedInThisLot > 0) {
        const restoreAmount = Math.min(pointsLeftToRestore, usedInThisLot);
        await tx.pointLot.update({
          where: { id: lot.id },
          data: { remainingAmount: { increment: restoreAmount } },
        });
        pointsLeftToRestore -= restoreAmount;
      }
    }

    // Sync aggregate points column on User table
    const newAggregatedPoints = await getActivePointsBalance(tx, trx.userId);
    await tx.user.update({
      where: { id: trx.userId },
      data: { points: newAggregatedPoints },
    });
  }

  // 6. Update transaction status to EXPIRED / REJECTED / CANCELED
  return await tx.transaction.update({
    where: { id: transactionId },
    data: { status: StatusTransaction[targetStatus] },
    include: transactionDetailInclude,
  });
};

/**
 * Create a new ticket purchase transaction atomically using prisma.$transaction.
 */
export const createTransaction = async (input: CreateTransactionInput) => {
  const { userId, eventId, items, voucherCode, couponCode, usePoints } = input;

  const validItems = (items || []).filter(
    (item) =>
      Number.isInteger(Number(item.quantity)) && Number(item.quantity) > 0,
  );

  if (validItems.length === 0) {
    throw new ApiError(
      "Please select at least 1 ticket to proceed with the transaction.",
      400,
    );
  }

  return await prisma.$transaction(
    async (tx) => {
      const now = new Date();

      // Rule a: Ensure only users with the CUSTOMER role can purchase tickets
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) {
        throw new ApiError("User account not found.", 404);
      }
      if (user.role !== UserRole.CUSTOMER) {
        throw new ApiError(
          "Only Customer accounts are allowed to purchase event tickets.",
          403,
        );
      }

      let subtotal = 0;
      let totalTicketsRequested = 0;

      // 1. Rule l: Validate seats and decrement availableSeat on TicketType & Event
      const validatedItems: Array<{
        ticketTypeId: number;
        quantity: number;
        price: number;
      }> = [];

      for (const rawItem of validItems) {
        const ticketTypeId = Number(rawItem.ticketTypeId);
        const quantity = Number(rawItem.quantity);

        const ticket = await tx.ticketType.findUnique({
          where: { id: ticketTypeId },
        });

        if (!ticket || ticket.eventId !== eventId) {
          throw new ApiError(`Invalid ticket tier ID ${ticketTypeId}.`, 400);
        }

        if (ticket.availableSeat < quantity) {
          throw new ApiError(
            `Not enough seats for "${ticket.name}". Remaining: ${ticket.availableSeat}.`,
            400,
          );
        }

        subtotal += ticket.price * quantity;
        totalTicketsRequested += quantity;

        validatedItems.push({
          ticketTypeId: ticket.id,
          quantity,
          price: ticket.price,
        });

        await tx.ticketType.update({
          where: { id: ticket.id },
          data: { availableSeat: { decrement: quantity } },
        });
      }

      const eventRecord = await tx.event.findUnique({ where: { id: eventId } });
      if (!eventRecord || eventRecord.availableSeat < totalTicketsRequested) {
        throw new ApiError(
          "Total available seats for this event are insufficient.",
          400,
        );
      }

      await tx.event.update({
        where: { id: eventId },
        data: { availableSeat: { decrement: totalTicketsRequested } },
      });

      // 2. Rules c, d, f: Validate & apply Event Voucher (1 voucher per transaction)
      let voucherId: number | null = null;
      let voucherDiscount = 0;

      if (voucherCode && voucherCode.trim() !== "") {
        const voucher = await tx.voucher.findUnique({
          where: { code: voucherCode.trim().toUpperCase() },
        });

        // Rule d: Voucher can only be used if maxUsage > usedCount
        if (
          !voucher ||
          voucher.eventId !== eventId ||
          !voucher.isActive ||
          voucher.startAt > now ||
          voucher.expiresAt < now ||
          !(voucher.maxUsage > voucher.usedCount)
        ) {
          throw new ApiError(
            "Voucher is invalid, expired, or its usage quota has been reached.",
            400,
          );
        }

        voucherId = voucher.id;
        // Rule f: 1 voucher per transaction, not multiplied by ticket quantity
        voucherDiscount = Math.min(subtotal, voucher.discountValue);

        await tx.voucher.update({
          where: { id: voucher.id },
          data: { usedCount: { increment: 1 } },
        });
      }

      const priceAfterVoucher = Math.max(0, subtotal - voucherDiscount);

      // 3. Rules b, g, h, i, j: Validate & apply Coupon
      let couponId: number | null = null;
      let couponDiscount = 0;

      if (couponCode && couponCode.trim() !== "") {
        const coupon = await tx.coupon.findUnique({
          where: { code: couponCode.trim().toUpperCase() },
        });

        if (!coupon) {
          throw new ApiError("Coupon code not found.", 404);
        }

        // Rule b: Coupon can only be used by the owner
        if (coupon.userId !== userId) {
          throw new ApiError(
            "This coupon does not belong to your account.",
            403,
          );
        }

        // Rule g: isUsed must be false
        if (coupon.isUsed) {
          throw new ApiError("This coupon has already been used.", 400);
        }

        if (coupon.expiresAt < now) {
          throw new ApiError("This coupon has expired.", 400);
        }

        // Rule h: Transaction amount AFTER voucher discount must be at least IDR 30,000
        const minRequiredAfterVoucher = Math.max(
          MIN_TRX_AFTER_VOUCHER_FOR_COUPON,
          coupon.minTransaction,
        );

        if (priceAfterVoucher < minRequiredAfterVoucher) {
          throw new ApiError(
            `Coupon requires a minimum transaction of IDR ${minRequiredAfterVoucher.toLocaleString("id-ID")} after voucher discount.`,
            400,
          );
        }

        couponId = coupon.id;
        // Rule j: Coupon value is fixed at IDR 10,000
        couponDiscount = Math.min(priceAfterVoucher, FIXED_COUPON_DISCOUNT);

        // Rule i: Mark isUsed = true upon transaction creation
        await tx.coupon.update({
          where: { id: coupon.id },
          data: { isUsed: true },
        });
      }

      // 4. Rules n, o, p: Aggregate PointLot balance & deduct FIFO by earliest expiresAt
      const availablePointsFromLots = await getActivePointsBalance(tx, userId);

      if (usePoints && subtotal < MIN_TRX_FOR_POINTS) {
        throw new ApiError(
          `Minimum subtotal of IDR ${MIN_TRX_FOR_POINTS.toLocaleString("id-ID")} is required to use points.`,
          400,
        );
      }

      const { pointsDiscount, totalAmount } = calculatePricing(
        subtotal,
        voucherDiscount,
        couponDiscount,
        availablePointsFromLots,
        usePoints,
      );

      // Rule p: Deduct points from PointLots ordered by earliest expiresAt
      if (pointsDiscount > 0) {
        let remainingToDeduct = pointsDiscount;

        const activeLots = await tx.pointLot.findMany({
          where: {
            userId,
            remainingAmount: { gt: 0 },
            expiresAt: { gt: now },
          },
          orderBy: { expiresAt: "asc" },
        });

        for (const lot of activeLots) {
          if (remainingToDeduct <= 0) break;
          const deductFromLot = Math.min(
            lot.remainingAmount,
            remainingToDeduct,
          );

          await tx.pointLot.update({
            where: { id: lot.id },
            data: { remainingAmount: { decrement: deductFromLot } },
          });

          remainingToDeduct -= deductFromLot;
        }

        const updatedPointsBalance = await getActivePointsBalance(tx, userId);
        await tx.user.update({
          where: { id: userId },
          data: { points: updatedPointsBalance },
        });
      }

      // 5. Set 2-hour payment proof upload deadline
      const paymentDeadline = new Date(now.getTime() + 2 * 60 * 60 * 1000);

      const initialStatus: StatusTransaction =
        totalAmount === 0
          ? StatusTransaction.WAITING_FOR_ADMIN_CONFIRMATION
          : StatusTransaction.WAITING_FOR_PAYMENT;

      const adminDeadline =
        totalAmount === 0
          ? new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000)
          : null;

      // 6. Save transaction to database
      return await tx.transaction.create({
        data: {
          userId,
          voucherId,
          couponId,
          status: initialStatus,
          subtotal,
          voucherDiscount,
          couponDiscount,
          pointsDiscount,
          totalAmount,
          paymentDeadline,
          adminDeadline,
          paymentProof: totalAmount === 0 ? "FREE_OR_FULLY_COVERED" : null,
          transactionItems: {
            create: validatedItems,
          },
        },
        include: transactionDetailInclude,
      });
    },
    TX_OPTIONS,
  );
};

/**
 * Evaluate transaction deadlines (2 hours for payment proof, 3 days for admin confirmation).
 * Triggers automatic rollback if overdue.
 */
export const evaluateAndSyncTransactionStatus = async (
  transactionId: number,
) => {
  const now = new Date();

  const trx = await prisma.transaction.findUnique({
    where: { id: transactionId },
    include: transactionDetailInclude,
  });

  if (!trx) {
    throw new ApiError("Transaction not found.", 404);
  }

  // Rollback Condition 1: EXPIRED (past 2-hour payment proof deadline)
  if (
    trx.status === StatusTransaction.WAITING_FOR_PAYMENT &&
    now >= trx.paymentDeadline
  ) {
    return await prisma.$transaction(
      (tx) => rollbackTransactionResources(tx, trx.id, "EXPIRED"),
      TX_OPTIONS,
    );
  }

  // Rollback Condition 2: CANCELED (past 3-day admin confirmation deadline)
  if (
    trx.status === StatusTransaction.WAITING_FOR_ADMIN_CONFIRMATION &&
    trx.adminDeadline &&
    now >= trx.adminDeadline
  ) {
    return await prisma.$transaction(
      (tx) => rollbackTransactionResources(tx, trx.id, "CANCELED"),
      TX_OPTIONS,
    );
  }

  return trx;
};

/**
 * Rollback Condition 3: REJECTED (When Organizer/Admin rejects a transaction).
 */
export const rejectTransactionByOrganizer = async (transactionId: number) => {
  return await prisma.$transaction(
    (tx) => rollbackTransactionResources(tx, transactionId, "REJECTED"),
    TX_OPTIONS,
  );
};

/**
 * Upload or re-upload payment proof image (only before admin confirms or rejects).
 */
export const submitPaymentProof = async (
  transactionId: number,
  userId: number,
  paymentProofUrl: string,
) => {
  const currentTrx = await evaluateAndSyncTransactionStatus(transactionId);

  if (currentTrx.userId !== userId) {
    throw new ApiError(
      "Forbidden: You do not have permission to modify this transaction.",
      403,
    );
  }

  if (currentTrx.status === StatusTransaction.EXPIRED) {
    throw new ApiError(
      "Transaction has expired (passed 2-hour payment deadline).",
      400,
    );
  }

  const isInitialUpload =
    currentTrx.status === StatusTransaction.WAITING_FOR_PAYMENT;
  const isReuploadBeforeAdminConfirm =
    currentTrx.status === StatusTransaction.WAITING_FOR_ADMIN_CONFIRMATION;

  if (!isInitialUpload && !isReuploadBeforeAdminConfirm) {
    throw new ApiError(
      `Cannot upload or re-upload payment proof when transaction status is ${currentTrx.status}.`,
      400,
    );
  }

  const adminDeadline =
    isReuploadBeforeAdminConfirm && currentTrx.adminDeadline
      ? currentTrx.adminDeadline
      : new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);

  return await prisma.transaction.update({
    where: { id: transactionId },
    data: {
      paymentProof: paymentProofUrl,
      status: StatusTransaction.WAITING_FOR_ADMIN_CONFIRMATION,
      adminDeadline,
    },
    include: transactionDetailInclude,
  });
};

let isSweeping = false;

/**
 * Background Cron Job that runs every minute to sweep EXPIRED and CANCELED transactions.
 */
export const sweepOverdueTransactions = async () => {
  if (isSweeping) return { expiredCount: 0, canceledCount: 0 };
  isSweeping = true;

  let expiredProcessed = 0;
  let canceledProcessed = 0;

  try {
    const now = new Date();

    const expiredList = await prisma.transaction.findMany({
      where: {
        status: StatusTransaction.WAITING_FOR_PAYMENT,
        paymentDeadline: { lte: now },
      },
      select: { id: true },
    });

    for (const item of expiredList) {
      try {
        await prisma.$transaction(
          (tx) => rollbackTransactionResources(tx, item.id, "EXPIRED"),
          TX_OPTIONS,
        );
        expiredProcessed++;
      } catch (err) {
        console.error(
          `[Cron Rollback Error] Failed to expire Transaction #${item.id}:`,
          err,
        );
      }
    }

    const canceledList = await prisma.transaction.findMany({
      where: {
        status: StatusTransaction.WAITING_FOR_ADMIN_CONFIRMATION,
        adminDeadline: { lte: now },
      },
      select: { id: true },
    });

    for (const item of canceledList) {
      try {
        await prisma.$transaction(
          (tx) => rollbackTransactionResources(tx, item.id, "CANCELED"),
          TX_OPTIONS,
        );
        canceledProcessed++;
      } catch (err) {
        console.error(
          `[Cron Rollback Error] Failed to cancel Transaction #${item.id}:`,
          err,
        );
      }
    }

    return {
      expiredCount: expiredProcessed,
      canceledCount: canceledProcessed,
    };
  } finally {
    isSweeping = false;
  }
};

/**
 * Fetch paginated customer transactions from the backend (with status & search filtering).
 */
export const getCustomerTransactions = async (
  userId: number,
  query: PaginationQueryParams = {},
) => {
  // 1. Sync any pending transactions for this user first so expired/canceled statuses are up-to-date
  const pendingTransactions = await prisma.transaction.findMany({
    where: {
      userId,
      status: {
        in: [
          StatusTransaction.WAITING_FOR_PAYMENT,
          StatusTransaction.WAITING_FOR_ADMIN_CONFIRMATION,
        ],
      },
    },
    select: { id: true },
  });

  if (pendingTransactions.length > 0) {
    await Promise.all(
      pendingTransactions.map((trx) =>
        evaluateAndSyncTransactionStatus(trx.id),
      ),
    );
  }

  // 2. Sanitize pagination & sorting parameters
  const page = Math.max(1, Number(query.page) || 1);
  const take = Math.max(1, Math.min(50, Number(query.take) || 5));
  const skip = (page - 1) * take;
  const sortOrder: Prisma.SortOrder =
    query.sortOrder === "asc" ? "asc" : "desc";
  const allowedSortFields = ["createdAt", "totalAmount", "paymentDeadline"];
  const sortBy = allowedSortFields.includes(query.sortBy || "")
    ? (query.sortBy as string)
    : "createdAt";

  // 3. Build Prisma where clause for backend filtering
  const where: Prisma.TransactionWhereInput = { userId };

  if (
    query.status &&
    query.status !== "ALL" &&
    Object.values(StatusTransaction).includes(query.status as StatusTransaction)
  ) {
    where.status = query.status as StatusTransaction;
  }

  if (query.search && query.search.trim() !== "") {
    const searchTerm = query.search.trim();
    const numericId = Number(searchTerm.replace(/^#/, ""));

    where.OR = [
      {
        transactionItems: {
          some: {
            ticketType: {
              event: {
                name: { contains: searchTerm, mode: "insensitive" },
              },
            },
          },
        },
      },
      ...(Number.isInteger(numericId) && numericId > 0
        ? [{ id: numericId }]
        : []),
    ];
  }

  // 4. Execute paginated query and total count in parallel
  const [transactions, total] = await Promise.all([
    prisma.transaction.findMany({
      where,
      include: transactionDetailInclude,
      orderBy: { [sortBy]: sortOrder },
      skip,
      take,
    }),
    prisma.transaction.count({ where }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / take));

  return {
    data: transactions,
    meta: {
      page,
      take,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    },
  };
};