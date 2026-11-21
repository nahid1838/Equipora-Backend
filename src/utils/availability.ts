import type { ObjectId } from "mongodb";
import { bookingCollection, paymentCollection } from "../models/booking.js";
import { peakReservedQuantity } from "./booking.js";

// Quantity of this equipment that stays free for every day in [startDate, endDate).
export async function remainingQuantity(equipmentId: ObjectId, stock: number, startDate: Date, endDate: Date) {
  const overlapping = await bookingCollection().find({
    equipmentId, bookingStatus: "confirmed", paymentStatus: "paid",
    startDate: { $lt: endDate }, endDate: { $gt: startDate },
  }, { projection: { startDate: 1, endDate: 1, quantity: 1 } }).toArray();
  if (!overlapping.length) return Math.max(0, stock);

  // A recorded refund decision takes precedence over a booking snapshot.
  // Keep counting older paid/confirmed bookings without a payment record.
  const released = await paymentCollection().find({
    _id: { $in: overlapping.map(({ _id }) => _id) },
    outcome: { $in: ["refund_required", "refund_pending", "refunded"] },
  }, { projection: { _id: 1 } }).toArray();
  const releasedIds = new Set(released.map(({ _id }) => _id.toHexString()));
  const inRange = overlapping.filter(({ _id }) => !releasedIds.has(_id.toHexString())).map((booking) => ({
    startDate: booking.startDate < startDate ? startDate : booking.startDate,
    endDate: booking.endDate > endDate ? endDate : booking.endDate,
    quantity: booking.quantity,
  }));
  return Math.max(0, stock - peakReservedQuantity(inRange));
}
