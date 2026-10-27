import { Prisma } from "../generated/prisma/client.js";
import { StatusTransaction, UserRole } from "../generated/prisma/enums.js";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../utils/api-error.js";

export interface CreateReviewInput {
  userId: number;
  transactionId: number;
  rating: number;
  comment: string;
}

export interface OrganizerReviewsFilter {
  page?: number;
  take?: number;
  search?: string;
  eventName?: string;
  rating?: number | string;
}

/**
 * 1. Customer creates a review (Only if CUSTOMER, status === DONE, and event.endDate < now)
 */
export const createReviewService = async (input: CreateReviewInput) => {
  const { userId, transactionId, rating, comment } = input;

  const numericRating = Number(rating);
  if (isNaN(numericRating) || numericRating < 1 || numericRating > 5) {
    throw new ApiError("Rating must be between 1 and 5 stars.", 400);
  }

  if (!comment || comment.trim().length < 3) {
    throw new ApiError(
      "Review comment must be at least 3 characters long.",
      400,
    );
  }

  return await prisma.$transaction(async (tx) => {
    // 1a. Verify user exists and has role === CUSTOMER
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    });

    if (!user) {
      throw new ApiError("User account not found.", 404);
    }

    if (user.role !== UserRole.CUSTOMER) {
      throw new ApiError(
        "Only customers are allowed to submit event reviews.",
        403,
      );
    }

    // 1b. Fetch transaction with event details and existing attendances/reviews
    const transaction = await tx.transaction.findUnique({
      where: { id: Number(transactionId) },
      include: {
        transactionItems: {
          include: {
            ticketType: {
              include: {
                event: true,
              },
            },
          },
        },
        attendances: {
          include: {
            reviews: true,
          },
        },
      },
    });

    if (!transaction) {
      throw new ApiError("Transaction not found.", 404);
    }

    if (transaction.userId !== userId) {
      throw new ApiError(
        "Forbidden: You can only review your own transaction.",
        403,
      );
    }

    // 1c. Condition 1: Transaction status must be DONE
    if (transaction.status !== StatusTransaction.DONE) {
      throw new ApiError(
        "You can only review a transaction when its status is DONE.",
        400,
      );
    }

    const event = transaction.transactionItems[0]?.ticketType?.event;
    if (!event) {
      throw new ApiError("Event not found for this transaction.", 404);
    }

    // 1d. Condition 2: Event's endDate must be earlier than current date
    const now = new Date();
    if (new Date(event.endDate) >= now) {
      throw new ApiError(
        "You can only review this event after the event has ended.",
        400,
      );
    }

    // 1e. Find or create the Attendance record linking User + Event + Transaction
    let attendance = transaction.attendances[0];
    if (!attendance) {
      const totalTickets = transaction.transactionItems.reduce(
        (sum, item) => sum + item.quantity,
        0,
      );

      attendance = await tx.attendance.create({
        data: {
          userId,
          eventId: event.id,
          transactionId: transaction.id,
          ticketQuantity: totalTickets,
          attended: true,
          checkedInAt: now,
        },
        include: {
          reviews: true,
        },
      });
    }

    // 1f. Prevent duplicate reviews for the same transaction
    if (attendance.reviews && attendance.reviews.length > 0) {
      throw new ApiError(
        "You have already submitted a review for this transaction.",
        409,
      );
    }

    // 1g. Save the Review
    const createdReview = await tx.review.create({
      data: {
        userId,
        attendanceId: attendance.id,
        rating: Math.round(numericRating),
        comment: comment.trim(),
      },
    });

    return createdReview;
  });
};

/**
 * 2. Fetch paginated & filtered reviews for the logged-in Event Organizer's panel (Sorted by newest)
 */
export const getOrganizerReviewsService = async (
  organizerId: number,
  filters: OrganizerReviewsFilter = {},
) => {
  const page = Math.max(1, Number(filters.page) || 1);
  const take = Math.max(1, Math.min(50, Number(filters.take) || 5));
  const skip = (page - 1) * take;

  // Base filter: all reviews belonging to events created by this organizer
  const baseWhere: Prisma.ReviewWhereInput = {
    attendance: {
      event: {
        userId: organizerId,
      },
    },
  };

  // Dynamic filter for paginated review list (search, eventName, rating)
  const filteredWhere: Prisma.ReviewWhereInput = {
    attendance: {
      event: {
        userId: organizerId,
        ...(filters.eventName && filters.eventName !== "ALL"
          ? { name: filters.eventName }
          : {}),
      },
    },
  };

  if (filters.rating && filters.rating !== "ALL") {
    const parsedRating = Number(filters.rating);
    if (!isNaN(parsedRating) && parsedRating >= 1 && parsedRating <= 5) {
      filteredWhere.rating = parsedRating;
    }
  }

  if (filters.search && filters.search.trim() !== "") {
    const keyword = filters.search.trim();
    filteredWhere.OR = [
      { user: { name: { contains: keyword, mode: "insensitive" } } },
      { comment: { contains: keyword, mode: "insensitive" } },
      {
        attendance: {
          event: {
            userId: organizerId,
            name: { contains: keyword, mode: "insensitive" },
          },
        },
      },
    ];
  }

  // Run all 4 queries in parallel:
  // 1) Organizer's events for dropdown
  // 2) Overall average rating & total review count (unfiltered)
  // 3) Paginated & filtered reviews list
  // 4) Count of filtered reviews for pagination metadata
  const [organizerEvents, overallAggregate, rawReviews, filteredTotal] =
    await Promise.all([
      prisma.event.findMany({
        where: { userId: organizerId },
        select: { id: true, name: true },
        orderBy: { createdAt: "desc" },
      }),
      prisma.review.aggregate({
        where: baseWhere,
        _avg: { rating: true },
        _count: { id: true },
      }),
      prisma.review.findMany({
        where: filteredWhere,
        include: {
          user: {
            select: { id: true, name: true, profilePicture: true },
          },
          attendance: {
            include: {
              event: {
                select: { id: true, name: true },
              },
            },
          },
        },
        orderBy: {
          createdAt: "desc", // Sorted by newest first
        },
        skip,
        take,
      }),
      prisma.review.count({ where: filteredWhere }),
    ]);

  const formattedReviews = rawReviews.map((r) => ({
    id: r.id,
    customerName: r.user.name,
    eventName: r.attendance.event.name,
    rating: r.rating,
    comment: r.comment,
    reviewDate: r.createdAt.toISOString(),
  }));

  const totalReviews = overallAggregate._count.id ?? 0;
  const averageRating = overallAggregate._avg.rating
    ? Number(overallAggregate._avg.rating.toFixed(1))
    : 0;

  const totalPages = Math.max(1, Math.ceil(filteredTotal / take));

  return {
    averageRating,
    totalReviews,
    events: organizerEvents.map((e) => e.name),
    reviews: formattedReviews,
    meta: {
      page,
      take,
      total: filteredTotal,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    },
  };
};