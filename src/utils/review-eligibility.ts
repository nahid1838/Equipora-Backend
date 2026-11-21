import { paymentCollection, type Booking } from "../models/booking.js";
import { reviewCollection } from "../models/review.js";

export function isCompletedPaidBooking(booking: Booking, now: Date) {
  return booking.bookingStatus === "confirmed" && booking.paymentStatus === "paid"
    && booking.endDate < now;
}

export async function reviewDetailsForBookings(bookings: Booking[]) {
  if (!bookings.length) return [];
  const now = new Date();
  const eligibleIds = bookings.filter((booking) => isCompletedPaidBooking(booking, now)).map(({ _id }) => _id);
  const [reviews, payments] = await Promise.all([
    reviewCollection().find({ bookingId: { $in: bookings.map(({ _id }) => _id) } }, { projection: { bookingId: 1, status: 1 } }).toArray(),
    eligibleIds.length ? paymentCollection().find(
      { _id: { $in: eligibleIds }, outcome: "booked" },
      { projection: { _id: 1, amountMinor: 1, currency: 1 } },
    ).toArray() : [],
  ]);
  const statuses = new Map(reviews.map(({ bookingId, status }) => [bookingId.toHexString(), status]));
  const verified = new Map(payments.map((payment) => [payment._id.toHexString(), payment]));
  return bookings.map((booking) => {
    const id = booking._id.toHexString();
    const reviewStatus = statuses.get(id) ?? null;
    const payment = verified.get(id);
    return {
      reviewStatus,
      canReview: !reviewStatus && Boolean(payment && payment.amountMinor === booking.totalAmountMinor && payment.currency === booking.currency),
    };
  });
}
