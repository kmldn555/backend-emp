import { User } from "../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../utils/api-error.js";
import argon from "argon2";

 export const registerService = async (
  body: Pick<User, "name" | "email" | "password">,
) => {
  const user = await prisma.user.findUnique({
    where: { email: body.email },
  });

  if (user) {
    throw new ApiError("Email already used", 400);
  }

  const hashedPassword = await argon.hash(body.password);

  const generateReferralCode = (): string => {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  };

  await prisma.user.create({
    data: {
      name: body.name,
      email: body.email,
      password: hashedPassword,
      referralCode: generateReferralCode(),
    },
  });

  return { message: "register success" };
};

