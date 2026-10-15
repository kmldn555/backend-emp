import argon from "argon2";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../utils/api-error.js";
import {
  ChangePasswordSchema,
  ForgotPasswordSchema,
  LoginUserSchema,
  RegisterUserSchema,
  ResetPasswordSchema,
} from "../validators/user.auth.validator.js";
import { randomBytes } from "node:crypto";
import { sendMail } from "../lib/mail.js";

export const registerService = async (body: RegisterUserSchema) => {
  // 1. Protect the password
  const hashedPassword = await argon.hash(body.password);

  // 2. Generate referall code for new user
  const generateReferralCode = (): string => {
    return randomBytes(5).toString("hex").toUpperCase();
  };

  const generateCouponCode = (): string => {
    return randomBytes(5).toString("hex").toUpperCase();
  };

  await prisma.$transaction(
    async (tx) => {
      // 1. cek email tersedia atau tidak
      const userEmail = await tx.user.findUnique({
        where: { email: body.email },
      });

      if (userEmail) {
        throw new ApiError("Email already used", 400);
      }

      // 2. cek referral code
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

      // 5. Generate point untuk refererr.id (user yang digunakan referralnya)
      if (referrer) {
        const creditedAt = new Date();

        const expiresAt = new Date(creditedAt);
        expiresAt.setMonth(expiresAt.getMonth() + 3);

        await tx.pointLot.create({
          data: {
            userId: referrer.id,
            amount: 10000,
            remainingAmount: 10000,
            creditedAt: creditedAt,
            expiresAt: expiresAt,
          },
        });
      }

      // 6. generate coupon untuk user
      if (referrer) {
        const expiresCoupon = new Date();
        expiresCoupon.setMonth(expiresCoupon.getMonth() + 3);

        await tx.coupon.create({
          data: {
            userId: newUser.id,
            code: generateCouponCode(),
            discountValue: 10000,
            minTransaction: 30000,
            expiresAt: expiresCoupon,
          },
        });
      }
    },
    {
      maxWait: 5000, // Waktu maksimal menunggu antrean koneksi (5 detik)
      timeout: 10000, // Waktu maksimal eksekusi transaksi (10 detik)
    },
  );

  // 5. Kirim email welcoming (perbaikannya tidak perlu diawait)
  sendMail({
    to: body.email,
    subject: "Welcome to APPTIX",
    templateName: "welcome.hbs",
    context: {
      name: body.name,
    },
  });

  // 6. Send result
  return { message: "register success" };
};

export const loginService = async (body: LoginUserSchema) => {
  // 1. cek dulu emailnya udah ada di db atau tidak
  const user = await prisma.user.findUnique({
    where: { email: body.email },
  });
  // 2. kalo emailnya tidak ada di db, throw error
  if (!user) throw new ApiError("Invalid credentials", 400);

  // 3. cek passwordnya, bener atau tidak
  const isPassMatch = await argon.verify(user.password, body.password);
  // 4. kalo passwordnya salah, throw error
  if (!isPassMatch) throw new ApiError("Invalid credentials", 400);
  // 5. generate accessToken (jwt)
  const payload = { id: user.id, role: user.role };
  const accessToken = jwt.sign(payload, process.env.JWT_SECRET!, {
    expiresIn: "1d",
  });
  // pengambilan data point
  const pointLots = await prisma.pointLot.aggregate({
    where: {
      userId: user.id,
      expiresAt: { gt: new Date() },
    },
    _sum: { remainingAmount: true },
  });

  const points = pointLots._sum.remainingAmount ?? 0;

  // 6. return message login success + data user + access tokennya
  return {
    message: "Login Success",
    accessToken: accessToken,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      points: points,
      profilePicture: user.profilePicture,
    },
  };
};

export const forgotPasswordService = async (body: ForgotPasswordSchema) => {
  const user = await prisma.user.findUnique({
    where: { email: body.email },
  });

  // 1. jika email tidak ada, tetap kirim notif, tapi tidak ada aksi yg dilakukan
  if (!user) {
    return { message: "Send email Success" };
  }

  // 2. generate accessToken (jwt)
  const payload = { id: user.id, role: user.role };
  const token = jwt.sign(payload, process.env.JWT_SECRET_RESET!, {
    expiresIn: "15m",
  });

  // 3. Kirim email reset password
  await sendMail({
    to: body.email,
    subject: "Reset Password",
    templateName: "resetPassword.hbs",
    context: {
      linkReset: `${process.env.BASE_URL_FE}/reset-password?token=${token}`,
    },
  });

  return { message: "Send email Success" };
};

export const resetPasswordService = async (
  body: ResetPasswordSchema,
  userId: number,
) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user) {
    throw new ApiError("User not found", 404);
  }

  const hashedPassword = await argon.hash(body.password);

  await prisma.user.update({
    where: { id: userId },
    data: { password: hashedPassword },
  });
  return { message: "Reset password success" };
};

export const changePasswordService = async (
  body: ChangePasswordSchema,
  userId: number,
) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
  });
  if (!user) {
    throw new ApiError("user not found", 400);
  }

  const isPassMatch = await argon.verify(user.password, body.oldPassword);

  if (!isPassMatch) {
    throw new ApiError("Password do not match", 400);
  }

  const newPassword = await argon.hash(body.newPassword);

  await prisma.user.update({
    where: { id: userId },
    data: { password: newPassword },
  });

  return { message: "Change password success" };
};
