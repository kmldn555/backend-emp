export interface CreateTicketTypeDTO {
  name: string;
  price: number; // 0 for free
  totalSeat: number;
}

export interface CreateVoucherDTO {
  code: string;
  notes?: string;
  discountValue: number;
  maxUsage: number;
  startAt: string;
  expiresAt: string;
}

export interface CreateEventDTO {
  name: string;
  description: string;
  categoryId: number;
  location: string;
  startDate: string;
  endDate: string;
  tickets: CreateTicketTypeDTO[];
  voucher?: CreateVoucherDTO;
}

export interface EventQueryFilter {
  search?: string;
  categoryId?: number;
  location?: string;
  page?: number;
  limit?: number;
}