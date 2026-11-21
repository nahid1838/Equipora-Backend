import type { ObjectId } from "mongodb";
import { bookingCollection } from "../models/booking.js";
import { peakReservedQuantity } from "./booking.js";

// Quantity of this equipment that stays free for every day in [startDate, endDate).
export async function remainingQuantity(equipmentId: ObjectId, stock: number, startDate: Date, endDate: Date) {
  const overlapping = await bookingCollection().find({ equipmentId, startDate: { $lt: endDate }, endDate: { $gt: startDate } }, {
    projection: { startDate: 1, endDate: 1, quantity: 1 },
  }).toArray();
  const inRange = overlapping.map((booking) => ({
    startDate: booking.startDate < startDate ? startDate : booking.startDate,
    endDate: booking.endDate > endDate ? endDate : booking.endDate,
    quantity: booking.quantity,
  }));
  return Math.max(0, stock - peakReservedQuantity(inRange));
}
