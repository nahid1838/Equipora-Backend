import type { ObjectId } from "mongodb";
import { getDB } from "../config/db.js";
import type { RentalType } from "./equipment.js";

export type BookingDetails = {
  customerId: string;
  customerName: string;
  ownerId: string;
  ownerName: string;
  equipmentId: ObjectId;
  equipmentName: string;
  startDate: Date;
  endDate: Date;
  quantity: number;
  durationDays: number;
  rentalType: RentalType;
  unitPriceMinor: number;
  billableUnits: number;
  totalAmountMinor: number;
  currency: "usd";
  contactNumber: string;
  deliveryAddress: string;
  notes: string;
};

export type CheckoutDraft = {
  _id: ObjectId;
  details: BookingDetails;
  requestKey: string;
  fingerprint: string;
  stripeSessionId?: string;
  state: "open" | "expired" | "failed";
  createdAt: Date;
};

export type Booking = BookingDetails & {
  _id: ObjectId;
  paymentStatus: "paid";
  bookingStatus: "confirmed";
  createdAt: Date;
};

export type Payment = {
  _id: ObjectId;
  stripeSessionId: string;
  stripePaymentIntentId: string;
  stripeEventId: string;
  amountMinor: number;
  currency: string;
  outcome: "booked" | "refund_required" | "refund_pending" | "refunded";
  stripeRefundId?: string;
  createdAt: Date;
};

export const bookingCollection = () => getDB().collection<Booking>("bookings");
export const checkoutCollection = () => getDB().collection<CheckoutDraft>("booking_checkouts");
export const paymentCollection = () => getDB().collection<Payment>("payments");

export async function createBookingIndexes() {
  await Promise.all([
    checkoutCollection().createIndex({ "details.customerId": 1, requestKey: 1 }, { unique: true }),
    bookingCollection().createIndex({ equipmentId: 1, endDate: 1 }),
    bookingCollection().createIndex({ customerId: 1, createdAt: -1, _id: -1 }),
    bookingCollection().createIndex({ ownerId: 1, createdAt: -1, _id: -1 }),
    bookingCollection().createIndex({ createdAt: -1, _id: -1 }),
  ]);
}
