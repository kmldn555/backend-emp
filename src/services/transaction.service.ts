import { Prisma } from "../generated/prisma/client.js";
import { StatusTransaction } from "../generated/prisma/enums.js";
import { prisma } from "../lib/prisma.js";

// 1. Prisma Interactive Transaction Timeout Configuration (prevents 5000ms cloud DB timeout)
const TX_OPTIONS = {
  maxWait: 10000, // Max 10s wait for connection pool
  timeout: 20000, // Max 20s execution time for multi-table rollback/checkout
};

// Type definition for each ticket tier chosen by the customer
export interface CheckoutItemInput {
  ticketTypeId: number;
  quantity: number;
}

// Type definition for the checkout payload sent from Frontend
export interface CreateTransactionInput {
  userId: number;
  eventId: number;
  items: CheckoutItemInput[];
  voucherCode?: string;
  couponCode?: string;
  usePoints: boolean;
}

// Reusable Prisma include object so all transaction queries return consistent nested data
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
  attendances: {
    include: {
      reviews: true,
    },
  },
} satisfies Prisma.TransactionInclude;

/**
 * Pure helper function to compute final IDR total and capped point deduction.
 * Ensures totalAmount never drops below 0 IDR.
 */
export const calculatePricing = (
  subtotal: number,
  voucherDiscount: number,
  couponDiscount: number,
  availableUserPoints: number,
  usePoints: boolean,
) => {
  const priceAfterPromos = Math.max(
    0,
    subtotal - voucherDiscount - couponDiscount,
  );

  const pointsDiscount = usePoints
    ? Math.min(Math.max(0, availableUserPoints), priceAfterPromos)
    : 0;

  const totalAmount = Math.max(0, priceAfterPromos - pointsDiscount);

  return { priceAfterPromos, pointsDiscount, totalAmount };
};

/**
 * Reusable functional rollback helper.
 * Restores seats, points, vouchers, and coupons when a transaction becomes
 * EXPIRED, CANCELED, or REJECTED.
 */
export const rollbackTransactionResources = async (
  tx: Prisma.TransactionClient,
  transactionId: number,
  targetStatus: "EXPIRED" | "CANCELED" | "REJECTED",
) => {
  // 1. Fetch transaction with its items and ticketType metadata inside the transaction lock
  const trx = await tx.transaction.findUnique({
    where: { id: transactionId },
    include: transactionDetailInclude,
  });

  if (!trx) {
    throw new Error(`Transaction #${transactionId} not found for rollback`);
  }

  // Guard against double-rollback if lazy evaluation and cron job run simultaneously
  if (
    trx.status === StatusTransaction.EXPIRED ||
    trx.status === StatusTransaction.CANCELED ||
    trx.status === StatusTransaction.REJECTED ||
    trx.status === StatusTransaction.DONE
  ) {
    console.log(
      `[Rollback Skipped] Transaction #${transactionId} is already ${trx.status}.`,
    );
    return trx;
  }

  // 2. Restore seats for each TicketType and aggregate seats per Event
  const eventSeatsMap = new Map<number, number>();
  const parallelUpdates: Promise<unknown>[] = [];

  for (const item of trx.transactionItems) {
    const qty = Number(item.quantity) || 0;
    if (qty <= 0) continue;

    // Resolve parent eventId safely from either scalar field or nested event relation
    const eventId = item.ticketType?.eventId ?? item.ticketType?.event?.id;
    if (eventId) {
      eventSeatsMap.set(eventId, (eventSeatsMap.get(eventId) || 0) + qty);
    }

    // Increment availableSeat back on the specific TicketType
    parallelUpdates.push(
      tx.ticketType.update({
        where: { id: item.ticketTypeId },
        data: { availableSeat: { increment: qty } },
      }),
    );

    console.log(
      `[Rollback] Transaction #${transactionId}: Restoring ${qty} seat(s) to TicketType #${item.ticketTypeId}`,
    );
  }

  // Increment availableSeat back on each parent Event
  for (const [eventId, totalSeatsToRestore] of eventSeatsMap.entries()) {
    if (totalSeatsToRestore > 0) {
      parallelUpdates.push(
        tx.event.update({
          where: { id: eventId },
          data: { availableSeat: { increment: totalSeatsToRestore } },
        }),
      );
      console.log(
        `[Rollback] Transaction #${transactionId}: Restoring ${totalSeatsToRestore} total seat(s) to Event #${eventId}`,
      );
    }
  }

  // 3. Restore Event Voucher usage count if one was used
  if (trx.voucherId) {
    parallelUpdates.push(
      tx.voucher.update({
        where: { id: trx.voucherId },
        data: { usedCount: { decrement: 1 } },
      }),
    );
  }

  // 4. Restore System Coupon to unused (isUsed = false) if one was used
  if (trx.couponId) {
    parallelUpdates.push(
      tx.coupon.update({
        where: { id: trx.couponId },
        data: { isUsed: false },
      }),
    );
  }

  // 5. Refund deducted Points back to User
  if (trx.pointsDiscount > 0) {
    parallelUpdates.push(
      tx.user.update({
        where: { id: trx.userId },
        data: { points: { increment: trx.pointsDiscount } },
      }),
    );
  }

  // Execute all seat, voucher, coupon, and user point updates in parallel
  await Promise.all(parallelUpdates);

  // Restore remainingAmount across active PointLots without exceeding original lot.amount
  if (trx.pointsDiscount > 0) {
    const activeLots = await tx.pointLot.findMany({
      where: { userId: trx.userId, expiresAt: { gt: new Date() } },
      orderBy: { expiresAt: "asc" },
    });

    let pointsLeftToRestore = trx.pointsDiscount;
    const lotUpdates: Promise<unknown>[] = [];

    for (const lot of activeLots) {
      if (pointsLeftToRestore <= 0) break;
      const capacityInLot = Math.max(0, lot.amount - lot.remainingAmount);

      if (capacityInLot > 0) {
        const restoreAmount = Math.min(pointsLeftToRestore, capacityInLot);
        lotUpdates.push(
          tx.pointLot.update({
            where: { id: lot.id },
            data: { remainingAmount: { increment: restoreAmount } },
          }),
        );
        pointsLeftToRestore -= restoreAmount;
      }
    }

    if (lotUpdates.length > 0) {
      await Promise.all(lotUpdates);
    }
  }

  // 6. Update the transaction status to targetStatus and return full nested details
  const updatedTrx = await tx.transaction.update({
    where: { id: transactionId },
    data: { status: StatusTransaction[targetStatus] },
    include: transactionDetailInclude,
  });

  console.log(
    `[Rollback Complete] Transaction #${transactionId} marked as ${targetStatus}.`,
  );

  return updatedTrx;
};

/**
 * Creates a new ticket transaction atomically using Prisma $transaction.
 */
export const createTransaction = async (input: CreateTransactionInput) => {
  const { userId, eventId, items, voucherCode, couponCode, usePoints } = input;

  const validItems = (items || []).filter(
    (item) =>
      Number.isInteger(Number(item.quantity)) && Number(item.quantity) > 0,
  );

  if (validItems.length === 0) {
    throw new Error("Please select at least one ticket.");
  }

  return await prisma.$transaction(
    async (tx) => {
      const now = new Date();
      let subtotal = 0;
      let totalTicketsRequested = 0;

      // 1. Validate each TicketType and calculate subtotal in IDR
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
          throw new Error(`Invalid ticket type ID ${ticketTypeId}`);
        }

        if (ticket.availableSeat < quantity) {
          throw new Error(
            `Not enough seats for ${ticket.name}. Remaining: ${ticket.availableSeat}`,
          );
        }

        subtotal += ticket.price * quantity;
        totalTicketsRequested += quantity;

        validatedItems.push({
          ticketTypeId: ticket.id,
          quantity,
          price: ticket.price,
        });

        // Immediately reserve/deduct seats from TicketType
        await tx.ticketType.update({
          where: { id: ticket.id },
          data: { availableSeat: { decrement: quantity } },
        });
      }

      // Deduct aggregate availableSeat from the parent Event
      await tx.event.update({
        where: { id: eventId },
        data: { availableSeat: { decrement: totalTicketsRequested } },
      });

      // 2. Validate & lock Organizer Voucher (if provided)
      let voucherId: number | null = null;
      let voucherDiscount = 0;

      if (voucherCode && voucherCode.trim() !== "") {
        const voucher = await tx.voucher.findUnique({
          where: { code: voucherCode.trim().toUpperCase() },
        });

        if (
          !voucher ||
          voucher.eventId !== eventId ||
          !voucher.isActive ||
          voucher.startAt > now ||
          voucher.expiresAt < now ||
          voucher.usedCount >= voucher.maxUsage
        ) {
          throw new Error(
            "Voucher is invalid, expired, or has reached maximum usage.",
          );
        }

        voucherId = voucher.id;
        voucherDiscount = Math.min(subtotal, voucher.discountValue);

        await tx.voucher.update({
          where: { id: voucher.id },
          data: { usedCount: { increment: 1 } },
        });
      }

      // 3. Validate & lock Referral/System Coupon (if provided)
      let couponId: number | null = null;
      let couponDiscount = 0;

      if (couponCode && couponCode.trim() !== "") {
        const coupon = await tx.coupon.findUnique({
          where: { code: couponCode.trim().toUpperCase() },
        });

        if (
          !coupon ||
          coupon.userId !== userId ||
          coupon.isUsed ||
          coupon.expiresAt < now ||
          subtotal < coupon.minTransaction
        ) {
          throw new Error(
            "Coupon is invalid, expired, or minimum transaction not met.",
          );
        }

        couponId = coupon.id;
        couponDiscount = Math.min(
          Math.max(0, subtotal - voucherDiscount),
          coupon.discountValue,
        );

        await tx.coupon.update({
          where: { id: coupon.id },
          data: { isUsed: true },
        });
      }

      // 4. Fetch User & calculate Points deduction
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw new Error("User not found.");

      const { pointsDiscount, totalAmount } = calculatePricing(
        subtotal,
        voucherDiscount,
        couponDiscount,
        user.points,
        usePoints,
      );

      // If points are used, deduct from User.points and FIFO from PointLot
      if (pointsDiscount > 0) {
        await tx.user.update({
          where: { id: userId },
          data: { points: { decrement: pointsDiscount } },
        });

        let remainingToDeduct = pointsDiscount;
        const activeLots = await tx.pointLot.findMany({
          where: { userId, remainingAmount: { gt: 0 }, expiresAt: { gt: now } },
          orderBy: { expiresAt: "asc" },
        });

        const lotUpdates: Promise<unknown>[] = [];
        for (const lot of activeLots) {
          if (remainingToDeduct <= 0) break;
          const deductFromLot = Math.min(
            lot.remainingAmount,
            remainingToDeduct,
          );

          lotUpdates.push(
            tx.pointLot.update({
              where: { id: lot.id },
              data: { remainingAmount: { decrement: deductFromLot } },
            }),
          );
          remainingToDeduct -= deductFromLot;
        }

        if (lotUpdates.length > 0) {
          await Promise.all(lotUpdates);
        }
      }

      // 5. Set 2-hour payment deadline (2 * 60 * 60 * 1000 ms)
      const paymentDeadline = new Date(now.getTime() + 2 * 60 * 60 * 1000);

      const initialStatus: StatusTransaction =
        totalAmount === 0
          ? StatusTransaction.WAITING_FOR_ADMIN_CONFIRMATION
          : StatusTransaction.WAITING_FOR_PAYMENT;

      const adminDeadline =
        totalAmount === 0
          ? new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000)
          : null;

      // 6. Create the Transaction and TransactionItems records
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
 * Checks a single transaction's deadlines and automatically transitions + rolls back
 * if overdue. Called lazily on GET requests and before payment proof upload.
 */
export const evaluateAndSyncTransactionStatus = async (
  transactionId: number,
) => {
  const now = new Date();

  const trx = await prisma.transaction.findUnique({
    where: { id: transactionId },
    include: transactionDetailInclude,
  });

  if (!trx) throw new Error("Transaction not found");

  // Auto-Expire if waiting for payment and 2-hour paymentDeadline has passed
  if (
    trx.status === StatusTransaction.WAITING_FOR_PAYMENT &&
    now >= trx.paymentDeadline
  ) {
    return await prisma.$transaction(
      (tx) => rollbackTransactionResources(tx, trx.id, "EXPIRED"),
      TX_OPTIONS,
    );
  }

  // Auto-Cancel if waiting for admin confirmation and 3-day adminDeadline has passed
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
 * Uploads or re-uploads payment proof.
 * Allowed when status is WAITING_FOR_PAYMENT (within 2 hours)
 * OR WAITING_FOR_ADMIN_CONFIRMATION (before admin confirms/rejects and within 3 days).
 */
export const submitPaymentProof = async (
  transactionId: number,
  userId: number,
  paymentProofUrl: string,
) => {
  const currentTrx = await evaluateAndSyncTransactionStatus(transactionId);

  if (!currentTrx || currentTrx.userId !== userId) {
    throw new Error("Unauthorized or transaction not found.");
  }

  if (currentTrx.status === StatusTransaction.EXPIRED) {
    throw new Error(
      "Transaction has expired (passed 2-hour payment deadline).",
    );
  }

  const isInitialUpload =
    currentTrx.status === StatusTransaction.WAITING_FOR_PAYMENT;
  const isReuploadBeforeAdminConfirm =
    currentTrx.status === StatusTransaction.WAITING_FOR_ADMIN_CONFIRMATION;

  if (!isInitialUpload && !isReuploadBeforeAdminConfirm) {
    throw new Error(
      `Cannot upload or re-upload payment proof when transaction status is ${currentTrx.status}.`,
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

// Prevent overlapping cron sweeps if the previous sweep is still running
let isSweeping = false;

/**
 * Batch job function called every minute by node-cron to sweep all overdue transactions.
 */
export const sweepOverdueTransactions = async () => {
  if (isSweeping) return { expiredCount: 0, canceledCount: 0 };
  isSweeping = true;

  let expiredProcessed = 0;
  let canceledProcessed = 0;

  try {
    const now = new Date();

    // 1. Find all WAITING_FOR_PAYMENT past 2 hours
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

    // 2. Find all WAITING_FOR_ADMIN_CONFIRMATION past 3 days
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

export const getCustomerTransactions = async (userId: number) => {
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

  await Promise.all(
    pendingTransactions.map((trx) => evaluateAndSyncTransactionStatus(trx.id)),
  );

  return await prisma.transaction.findMany({
    where: { userId },
    include: transactionDetailInclude,
    orderBy: { createdAt: "desc" },
  });
};