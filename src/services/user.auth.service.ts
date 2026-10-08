import { User } from "../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../utils/api-error.js";
import argon from "argon2";
import { LoginUserSchema, RegisterUserSchema } from "../validators/user.auth.validator.js";

export const registerService = async (body: RegisterUserSchema) => {
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

    // 5. generate point untuk refererr.id (user yang digunakan referralnya)
    // 6. generate coupon untuk user
  });

  // 5. send result
  return { message: "register success" };
};

export const loginService = async (body: LoginUserSchema) => {
  // 1. cek dulu emailnya udah ada di db atau tidak
  // 2. kalo emailnya tidak ada di db, throw error
  // 3. cek passwordnya, bener atau tidak
  // 4. kalo passwordnya salah, throw error
  // 5. generate accessToken (jwt)
  // 6. return message login success + data user + access tokennya
  };
