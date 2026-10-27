import { StatusTransaction } from "../generated/prisma/enums.js";

export interface PaginationQueryParams {
  page?: number;
  take?: number;
  sortOrder?: "asc" | "desc" | string;
  sortBy?: string;
  search?: string;
  role?: string;
  status?: StatusTransaction | "ALL";
}

export interface PaginationMeta {
  page: number;
  take: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}