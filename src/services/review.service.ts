import { prisma } from "../lib/prisma.js";
import { StatusTransaction, UserRole } from "../generated/prisma/enums.js";

export interface CreateReviewInput {
  userId: number;
  transactionId: number;
  rating: number;
  comment: string;
}

/**
 * 1. Customer creates a review (Only if CUSTOMER, status === DONE, and event.endDate < now)
 */
export const createReviewService = async (input: CreateReviewInput) => {
  const { userId, transactionId, rating, comment } = input;

  const numericRating = Number(rating);
  if (isNaN(numericRating) || numericRating < 1 || numericRating > 5) {
    throw new Error("Rating must be between 1 and 5 stars.");
  }

  if (!comment || comment.trim().length < 3) {
    throw new Error("Review comment must be at least 3 characters long.");
  }

  return await prisma.$transaction(async (tx) => {
    // 1a. Verify user exists and has role === CUSTOMER
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    });

    if (!user || user.role !== UserRole.CUSTOMER) {
      throw new Error("Only customers are allowed to submit event reviews.");
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
      throw new Error("Transaction not found.");
    }

    if (transaction.userId !== userId) {
      throw new Error("Unauthorized: You can only review your own transaction.");
    }

    // 1c. Condition 1: Transaction status must be DONE
    if (transaction.status !== StatusTransaction.DONE) {
      throw new Error("You can only review a transaction when its status is DONE.");
    }

    const event = transaction.transactionItems[0]?.ticketType?.event;
    if (!event) {
      throw new Error("Event not found for this transaction.");
    }

    // 1d. Condition 2: Event's endDate must be earlier than current date
    const now = new Date();
    if (new Date(event.endDate) >= now) {
      throw new Error("You can only review this event after the event has ended.");
    }

    // 1e. Find or create the Attendance record linking User + Event + Transaction
    let attendance = transaction.attendances[0];
    if (!attendance) {
      const totalTickets = transaction.transactionItems.reduce(
        (sum, item) => sum + item.quantity,
        0
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
      throw new Error("You have already submitted a review for this transaction.");
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
 * 2. Fetch all reviews for the logged-in Event Organizer's panel (Sorted by newest)
 */
export const getOrganizerReviewsService = async (organizerId: number) => {
  // Fetch all events owned by this organizer (so the filter dropdown shows all their events)
  const organizerEvents = await prisma.event.findMany({
    where: { userId: organizerId },
    select: { id: true, name: true },
    orderBy: { createdAt: "desc" },
  });

  // Fetch all reviews for events organized by this organizer, sorted by newest first
  const rawReviews = await prisma.review.findMany({
    where: {
      attendance: {
        event: {
          userId: organizerId,
        },
      },
    },
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
  });

  // Map into the exact shape used by EventOrganizerReviews.tsx
  const formattedReviews = rawReviews.map((r) => ({
    id: r.id,
    customerName: r.user.name,
    eventName: r.attendance.event.name,
    rating: r.rating,
    comment: r.comment,
    reviewDate: r.createdAt.toISOString(),
  }));

  // Calculate overall Average Rating and Total Reviews across all reviews
  const totalReviews = formattedReviews.length;
  const averageRating =
    totalReviews > 0
      ? Number(
          (
            formattedReviews.reduce((sum, item) => sum + item.rating, 0) /
            totalReviews
          ).toFixed(1)
        )
      : 0;

  return {
    averageRating,
    totalReviews,
    events: organizerEvents.map((e) => e.name),
    reviews: formattedReviews,
  };
};