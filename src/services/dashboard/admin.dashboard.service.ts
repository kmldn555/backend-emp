import { Prisma, UserRole } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { PaginationQueryParams } from "../../types/pagination.js";

// 1. Admin Overview
// ambil data semua customer
export const getTotalCustomerService = async () => {
  const totalCustomers = await prisma.user.count({
    where: {
      role: "CUSTOMER",
    },
  });

  return { totalCustomers };
};
// ambil data semua organizer
export const getTotalOrganizerService = async () => {
  const totalOrganizers = await prisma.user.count({
    where: {
      role: "EVENTORGANIZER",
    },
  });

  return { totalOrganizers };
};
// ambil data semua event
export const getTotalEventService = async () => {
  const totalEvents = await prisma.event.count();

  return { totalEvents };
};
// ambil data semua category
export const getTotalCategoriesService = async () => {
  const totalCategories = await prisma.category.count();

  return { totalCategories };
};

//2. Admin ManageUsers
export const getUsersService = async (query: PaginationQueryParams) => {
  const { page, take, sortOrder, sortBy, search, role } = query;

  const whereClause: Prisma.UserWhereInput = {};

  if (search) {
    whereClause.OR = [
      {
        name: {
          contains: search,
          mode: "insensitive",
        },
      },
      {
        email: {
          contains: search,
          mode: "insensitive",
        },
      },
    ];
  }

  if (role && Object.values(UserRole).includes(role as UserRole)) {
    whereClause.role = role as UserRole;
  }

  const users = await prisma.user.findMany({
    where: whereClause,
    skip: (page - 1) * take,
    take,
    orderBy: {
      [sortBy]: sortOrder,
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      createdAt: true,
    },
  });

  const total = await prisma.user.count({
    where: whereClause,
  });

  return {
    data: users,
    meta: {
      page,
      take,
      total,
    },
  };
};
