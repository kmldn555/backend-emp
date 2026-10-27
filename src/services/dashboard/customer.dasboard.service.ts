import { prisma } from "../../lib/prisma.js";

export const getCustomerPointsService = async (userId: number) => {
  const totalPoints = await prisma.pointLot.aggregate({
    where: {
      userId: userId,
      expiresAt: {
        gt: new Date(),
      },
      remainingAmount: {
        gt: 0,
      },
    },
    _sum: {
      remainingAmount: true,
    },
  });

  return totalPoints._sum.remainingAmount ?? 0;
};

export const getCustomerHistoryPointsService = async (
  userId: number,
  page: number,
  take: number,
) => {
  const where = {
    userId,
  };

  const [pointsHistory, total] = await Promise.all([
    prisma.pointLot.findMany({
      where,
      select: {
        id: true,
        creditedAt: true,
        amount: true,
        remainingAmount: true,
        expiresAt: true,
      },
      orderBy: {
        creditedAt: "desc",
      },
      skip: (page - 1) * take,
      take,
    }),
    prisma.pointLot.count({ where }),
  ]);

  return {
    data: pointsHistory,
    meta: {
      page,
      take,
      total,
      totalPages: Math.ceil(total / take),
    },
  };
};