import { User } from "../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../utils/api-error.js";
import argon from "argon2";

export const registerService = async (
  body: Pick<User, "name" | "email" | "password" | "role" | "referralCode">, // bisa diganti validator
) => {
  // 1. Protect the password
  const hashedPassword = await argon.hash(body.password);

  // 2. Generate referall code for new user
  const generateReferralCode = (): string => {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  };

  await prisma.$transaction(async (tx) => {
    // 1. cek email tersedia atau tidak
    const userEmail = await tx.user.findUnique({
      where: { email: body.email },
    });

    if (userEmail) {
      throw new ApiError("Email already used", 400);
    }

    // 2, cek referral code
    let referrer = undefined;

    if (body.referralCode) {
      referrer = await tx.user.findUnique({
        where: {
          referralCode: body.referralCode,
        },
      });

      if (!referrer) {
        throw new ApiError("Code referral is not valid", 400);
      }
    }

    // 3. create data user
    const newUser = await tx.user.create({
      data: {
        name: body.name,
        email: body.email,
        role: body.role,
        password: hashedPassword,
        referralCode: generateReferralCode(),
      },
    });

    // 4. create data referall
    if (referrer) {
      await tx.referral.create({
        data: {
          userId: referrer.id,
          referredUserId: newUser.id,
        },
      });
    }
  });

  // 5. send result
  return { message: "register success" };
};
