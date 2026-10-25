import { Prisma } from "../generated/prisma/client.js";
import { StatusTransaction, UserRole } from "../generated/prisma/enums.js";
import { prisma } from "../lib/prisma.js";

// 1. Konfigurasi Timeout Prisma Transaction (mencegah error timeout 5000ms di cloud DB)
const TX_OPTIONS = {
  maxWait: 10000,
  timeout: 20000,
};

// Konstanta aturan bisnis sesuai spesifikasi
const MIN_TRX_AFTER_VOUCHER_FOR_COUPON = 30000; // Ketentuan h: Minimal Rp 30.000 setelah dikurang voucher
const FIXED_COUPON_DISCOUNT = 10000;            // Ketentuan j: Nilai coupon hanya Rp 10.000
const MIN_TRX_FOR_POINTS = 100000;              // Ketentuan o: Minimal transaksi Rp 100.000 untuk pakai poin
const MAX_POINTS_PER_TRX = 20000;               // Ketentuan o: Maksimal 20.000 poin dalam 1x transaksi
const POINT_MULTIPLE = 10000;                   // Ketentuan o: Penggunaan kelipatan 10.000 dari 0

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

// Reusable Prisma include untuk menampilkan detail transaksi secara konsisten
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
 * Ketentuan n: Mengambil saldo poin aktif customer menggunakan fitur aggregate Prisma
 * dari tabel point_lots berdasarkan kolom remainingAmount dan expiresAt > now.
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
 * Ketentuan h, j, o: Pure helper kalkulasi harga IDR, diskon voucher, diskon coupon, dan poin.
 * - Coupon: Hanya berlaku jika (subtotal - voucherDiscount) >= 30.000, nilai diskon 10.000.
 * - Point: Sekali pakai sekaligus, minimal transaksi 100.000, maksimal 20.000 poin,
 *   dan wajib kelipatan 10.000 dari 0 (0, 10.000, atau 20.000).
 */
export const calculatePricing = (
  subtotal: number,
  voucherDiscount: number,
  couponDiscount: number,
  availableUserPoints: number,
  usePoints: boolean,
) => {
  // Harga setelah dikurangi voucher (tidak boleh minus)
  const priceAfterVoucher = Math.max(0, subtotal - voucherDiscount);

  // Harga setelah dikurangi coupon (tidak boleh minus)
  const priceAfterPromos = Math.max(0, priceAfterVoucher - couponDiscount);

  let pointsDiscount = 0;

  // Ketentuan o: Poin hanya bisa dipakai jika usePoints = true dan nilai transaksi >= 100.000
  if (usePoints && subtotal >= MIN_TRX_FOR_POINTS && priceAfterPromos >= POINT_MULTIPLE) {
    // Batasi maksimal 20.000 poin, tidak melebihi saldo pointLot aktif, dan tidak melebihi sisa tagihan
    const maxRawPoints = Math.min(
      Math.max(0, availableUserPoints),
      MAX_POINTS_PER_TRX,
      priceAfterPromos,
    );

    // Bulatkan ke bawah ke kelipatan 10.000 terdekat (0, 10.000, atau 20.000)
    pointsDiscount = Math.floor(maxRawPoints / POINT_MULTIPLE) * POINT_MULTIPLE;
  }

  // Total akhir yang harus dibayar dalam IDR
  const totalAmount = Math.max(0, priceAfterPromos - pointsDiscount);

  return {
    priceAfterVoucher,
    priceAfterPromos,
    pointsDiscount,
    totalAmount,
  };
};

/**
 * Fungsi Rollback Terpusat (Dipicu saat status EXPIRED, REJECTED, atau CANCELED).
 * Mengembalikan 4 nilai secara atomik:
 * 1. Voucher (usedCount berkurang 1) -> Ketentuan e
 * 2. Coupon (isUsed kembali menjadi false) -> Ketentuan i
 * 3. Seat (availableSeat di tabel Event & TicketType bertambah kembali) -> Ketentuan m
 * 4. Point (remainingAmount di PointLot yang terpakai & User.points bertambah kembali) -> Ketentuan p
 */
export const rollbackTransactionResources = async (
  tx: Prisma.TransactionClient,
  transactionId: number,
  targetStatus: "EXPIRED" | "CANCELED" | "REJECTED",
) => {
  // 1. Ambil data transaksi beserta item tiketnya
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
    throw new Error(`Transaction #${transactionId} not found for rollback`);
  }

  // Guard anti double-rollback jika sudah pernah di-rollback atau sudah DONE
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

  // 2. Ketentuan m: Kembalikan availableSeat di tabel TicketType dan tabel Event
  const eventSeatsMap = new Map<number, number>();

  for (const item of trx.transactionItems) {
    const qty = Number(item.quantity) || 0;
    if (qty <= 0) continue;

    const eventId = item.ticketType.eventId;
    eventSeatsMap.set(eventId, (eventSeatsMap.get(eventId) || 0) + qty);

    // Kembalikan kursi pada masing-masing TicketType
    await tx.ticketType.update({
      where: { id: item.ticketTypeId },
      data: { availableSeat: { increment: qty } },
    });
  }

  // Kembalikan akumulasi kursi pada Event induk
  for (const [eventId, totalSeatsToRestore] of eventSeatsMap.entries()) {
    if (totalSeatsToRestore > 0) {
      await tx.event.update({
        where: { id: eventId },
        data: { availableSeat: { increment: totalSeatsToRestore } },
      });
    }
  }

  // 3. Ketentuan e: Kembalikan nilai usedCount pada tabel Voucher
  if (trx.voucherId) {
    await tx.voucher.update({
      where: { id: trx.voucherId },
      data: { usedCount: { decrement: 1 } },
    });
  }

  // 4. Ketentuan i: Kembalikan kolom isUsed menjadi false pada tabel Coupon
  if (trx.couponId) {
    await tx.coupon.update({
      where: { id: trx.couponId },
      data: { isUsed: false },
    });
  }

  // 5. Ketentuan p: Kembalikan remainingAmount pada PointLot berdasarkan PointLot ID yang telah digunakan
  // (diurutkan dari expiresAt terdekat yang memiliki selisih amount > remainingAmount)
  if (trx.pointsDiscount > 0) {
    const userLots = await tx.pointLot.findMany({
      where: { userId: trx.userId },
      orderBy: { expiresAt: "asc" },
    });

    let pointsLeftToRestore = trx.pointsDiscount;

    for (const lot of userLots) {
      if (pointsLeftToRestore <= 0) break;

      // Kapasitas poin yang sempat terpakai pada PointLot ID ini
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

    // Sinkronkan juga kolom points pada tabel User
    const newAggregatedPoints = await getActivePointsBalance(tx, trx.userId);
    await tx.user.update({
      where: { id: trx.userId },
      data: { points: newAggregatedPoints },
    });
  }

  // 6. Ubah status transaksi menjadi EXPIRED / REJECTED / CANCELED
  return await tx.transaction.update({
    where: { id: transactionId },
    data: { status: StatusTransaction[targetStatus] },
    include: transactionDetailInclude,
  });
};

/**
 * Membuat transaksi pembelian tiket baru secara atomik dengan prisma.$transaction.
 */
export const createTransaction = async (input: CreateTransactionInput) => {
  const { userId, eventId, items, voucherCode, couponCode, usePoints } = input;

  const validItems = (items || []).filter(
    (item) =>
      Number.isInteger(Number(item.quantity)) && Number(item.quantity) > 0,
  );

  if (validItems.length === 0) {
    throw new Error("Pilih minimal 1 tiket untuk melakukan transaksi.");
  }

  return await prisma.$transaction(
    async (tx) => {
      const now = new Date();

      // Ketentuan a: Pastikan hanya user dengan role CUSTOMER yang bisa membeli tiket
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) {
        throw new Error("User tidak ditemukan.");
      }
      if (user.role !== UserRole.CUSTOMER) {
        throw new Error(
          "Hanya akun Customer yang diperbolehkan membeli tiket event.",
        );
      }

      let subtotal = 0;
      let totalTicketsRequested = 0;

      // 1. Ketentuan l: Validasi kursi dan kurangi availableSeat di TicketType & Event
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
          throw new Error(`Tipe tiket ID ${ticketTypeId} tidak valid.`);
        }

        if (ticket.availableSeat < quantity) {
          throw new Error(
            `Kursi untuk tiket "${ticket.name}" tidak mencukupi. Tersisa: ${ticket.availableSeat}`,
          );
        }

        subtotal += ticket.price * quantity;
        totalTicketsRequested += quantity;

        validatedItems.push({
          ticketTypeId: ticket.id,
          quantity,
          price: ticket.price,
        });

        // Kurangi availableSeat di tabel TicketType
        await tx.ticketType.update({
          where: { id: ticket.id },
          data: { availableSeat: { decrement: quantity } },
        });
      }

      // Cek dan kurangi availableSeat di tabel Event
      const eventRecord = await tx.event.findUnique({ where: { id: eventId } });
      if (!eventRecord || eventRecord.availableSeat < totalTicketsRequested) {
        throw new Error("Total kursi tersedia pada event ini tidak mencukupi.");
      }

      await tx.event.update({
        where: { id: eventId },
        data: { availableSeat: { decrement: totalTicketsRequested } },
      });

      // 2. Ketentuan c, d, f: Validasi & Gunakan Voucher Event (1 voucher per transaksi, tidak berlaku kelipatan)
      let voucherId: number | null = null;
      let voucherDiscount = 0;

      if (voucherCode && voucherCode.trim() !== "") {
        const voucher = await tx.voucher.findUnique({
          where: { code: voucherCode.trim().toUpperCase() },
        });

        // Ketentuan d: Voucher hanya bisa digunakan jika maxUsage > usedCount
        if (
          !voucher ||
          voucher.eventId !== eventId ||
          !voucher.isActive ||
          voucher.startAt > now ||
          voucher.expiresAt < now ||
          !(voucher.maxUsage > voucher.usedCount)
        ) {
          throw new Error(
            "Voucher tidak valid, sudah kedaluwarsa, atau kuota penggunaan sudah habis.",
          );
        }

        voucherId = voucher.id;
        // Ketentuan f: 1 transaksi hanya 1 voucher, tidak dikali jumlah tiket
        voucherDiscount = Math.min(subtotal, voucher.discountValue);

        // Update penggunaan voucher
        await tx.voucher.update({
          where: { id: voucher.id },
          data: { usedCount: { increment: 1 } },
        });
      }

      // Hitung nilai transaksi setelah dikurangi potongan voucher
      const priceAfterVoucher = Math.max(0, subtotal - voucherDiscount);

      // 3. Ketentuan b, g, h, i, j: Validasi & Gunakan Coupon
      let couponId: number | null = null;
      let couponDiscount = 0;

      if (couponCode && couponCode.trim() !== "") {
        const coupon = await tx.coupon.findUnique({
          where: { code: couponCode.trim().toUpperCase() },
        });

        if (!coupon) {
          throw new Error("Kode kupon tidak ditemukan.");
        }

        // Ketentuan b: Coupon hanya bisa digunakan untuk user yang sama
        if (coupon.userId !== userId) {
          throw new Error("Kupon ini bukan milik akun Anda.");
        }

        // Ketentuan g: Kolom isUsed harus false (jika true tidak bisa digunakan)
        if (coupon.isUsed) {
          throw new Error("Kupon ini sudah pernah digunakan.");
        }

        if (coupon.expiresAt < now) {
          throw new Error("Kupon ini sudah kedaluwarsa.");
        }

        // Ketentuan h: Nilai transaksi SETELAH dikurang potongan voucher minimal Rp 30.000
        const minRequiredAfterVoucher = Math.max(
          MIN_TRX_AFTER_VOUCHER_FOR_COUPON,
          coupon.minTransaction,
        );

        if (priceAfterVoucher < minRequiredAfterVoucher) {
          throw new Error(
            `Kupon hanya dapat digunakan jika nilai transaksi setelah potongan voucher minimal Rp ${minRequiredAfterVoucher.toLocaleString("id-ID")}.`,
          );
        }

        couponId = coupon.id;
        // Ketentuan j: Nilai coupon hanya Rp 10.000
        couponDiscount = Math.min(priceAfterVoucher, FIXED_COUPON_DISCOUNT);

        // Ketentuan i: Ubah status isUsed menjadi true saat transaksi dibuat
        await tx.coupon.update({
          where: { id: coupon.id },
          data: { isUsed: true },
        });
      }

      // 4. Ketentuan n, o, p: Aggregate saldo PointLot & potong berdasarkan expiresAt terdekat
      const availablePointsFromLots = await getActivePointsBalance(tx, userId);

      // Jika user memilih menggunakan poin tetapi transaksi belum mencapai Rp 100.000, beri pesan jelas
      if (usePoints && subtotal < MIN_TRX_FOR_POINTS) {
        throw new Error(
          `Minimal transaksi Rp ${MIN_TRX_FOR_POINTS.toLocaleString("id-ID")} untuk dapat menggunakan poin.`,
        );
      }

      const { pointsDiscount, totalAmount } = calculatePricing(
        subtotal,
        voucherDiscount,
        couponDiscount,
        availablePointsFromLots,
        usePoints,
      );

      // Ketentuan p: Potong poin dari PointLot ID dengan expiresAt paling dekat
      if (pointsDiscount > 0) {
        let remainingToDeduct = pointsDiscount;

        const activeLots = await tx.pointLot.findMany({
          where: {
            userId,
            remainingAmount: { gt: 0 },
            expiresAt: { gt: now },
          },
          orderBy: { expiresAt: "asc" }, // Paling dekat expire digunakan lebih dulu
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

        // Sinkronkan saldo poin di tabel User dengan hasil aggregate PointLot terbaru
        const updatedPointsBalance = await getActivePointsBalance(tx, userId);
        await tx.user.update({
          where: { id: userId },
          data: { points: updatedPointsBalance },
        });
      }

      // 5. Set batas waktu pembayaran 2 jam
      const paymentDeadline = new Date(now.getTime() + 2 * 60 * 60 * 1000);

      const initialStatus: StatusTransaction =
        totalAmount === 0
          ? StatusTransaction.WAITING_FOR_ADMIN_CONFIRMATION
          : StatusTransaction.WAITING_FOR_PAYMENT;

      const adminDeadline =
        totalAmount === 0
          ? new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000)
          : null;

      // 6. Simpan transaksi ke database
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
 * Mengevaluasi batas waktu transaksi (2 jam untuk upload bukti, 3 hari untuk konfirmasi admin).
 * Jika lewat batas waktu, memicu rollback otomatis.
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

  // Kondisi Rollback 1: EXPIRED (lewat 2 jam belum upload bukti pembayaran)
  if (
    trx.status === StatusTransaction.WAITING_FOR_PAYMENT &&
    now >= trx.paymentDeadline
  ) {
    return await prisma.$transaction(
      (tx) => rollbackTransactionResources(tx, trx.id, "EXPIRED"),
      TX_OPTIONS,
    );
  }

  // Kondisi Rollback 2: CANCELED (lewat 3 hari belum dikonfirmasi admin/organizer)
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
 * Kondisi Rollback 3: REJECTED (Saat Organizer/Admin menolak transaksi).
 * Fungsi ini dapat dipanggil oleh endpoint Dashboard Organizer (Developer 2)
 * agar ketika transaksi di-REJECT, Voucher, Coupon, Seat, dan Point otomatis dikembalikan!
 */
export const rejectTransactionByOrganizer = async (transactionId: number) => {
  return await prisma.$transaction(
    (tx) => rollbackTransactionResources(tx, transactionId, "REJECTED"),
    TX_OPTIONS,
  );
};

/**
 * Upload atau Re-upload bukti pembayaran (hanya sebelum dikonfirmasi/ditolak admin).
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

let isSweeping = false;

/**
 * Fungsi Cron Job yang berjalan setiap menit untuk mengecek transaksi EXPIRED & CANCELED.
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