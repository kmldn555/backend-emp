// Defines a single ticket tier selection sent from the frontend checkout box
export interface CheckoutTicketItemDTO {
  ticketTypeId: number;
  quantity: number;
}

// Defines the complete payload sent when a customer clicks "Checkout Now"
export interface CreateTransactionDTO {
  eventId: number;
  items: CheckoutTicketItemDTO[];
  voucherCode?: string;
  couponCode?: string;
  usePoints?: boolean;
}