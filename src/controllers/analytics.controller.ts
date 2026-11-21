import type { Request, Response } from "express";
import type { Filter } from "mongodb";
import { bookingCollection, type Booking } from "../models/booking.js";
import { equipmentCollection } from "../models/equipment.js";
import { userCollection } from "../models/user.js";

const MONTH_COUNT = 6;
const monthLabel = new Intl.DateTimeFormat("en-US", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

type MonthlyRow = {
  month: string;
  label: string;
  bookings: number;
  amountMinor: number;
};

// The first day of the oldest month in the series, plus one label per month.
// UTC keeps the buckets stable regardless of the server's timezone.
function recentMonths(now: Date) {
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (MONTH_COUNT - 1), 1));
  const points = Array.from({ length: MONTH_COUNT }, (_, index) => {
    const date = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + index, 1));
    return { month: date.toISOString().slice(0, 7), label: monthLabel.format(date) };
  });
  return { start: first, points };
}

// Sum of paid bookings for any filter (all bookings are paid by definition).
async function totalAmountMinor(filter: Filter<Booking>) {
  const rows = await bookingCollection().aggregate<{ total: number }>([
    { $match: filter },
    { $group: { _id: null, total: { $sum: "$totalAmountMinor" } } },
  ]).toArray();
  return rows[0]?.total ?? 0;
}

// Booking count and revenue for each of the last six months. Months without
// bookings are still returned with zeroes so the chart always has six points.
async function monthlyBookings(filter: Filter<Booking>, now: Date): Promise<MonthlyRow[]> {
  const { start, points } = recentMonths(now);
  const rows = await bookingCollection().aggregate<{
    _id: string;
    bookings: number;
    amountMinor: number;
  }>([
    { $match: { ...filter, createdAt: { $gte: start } } },
    {
      $group: {
        _id: { $dateToString: { format: "%Y-%m", date: "$createdAt", timezone: "UTC" } },
        bookings: { $sum: 1 },
        amountMinor: { $sum: "$totalAmountMinor" },
      },
    },
  ]).toArray();

  const byMonth = new Map(rows.map((row) => [row._id, row]));
  return points.map(({ month, label }) => {
    const row = byMonth.get(month);
    return { month, label, bookings: row?.bookings ?? 0, amountMinor: row?.amountMinor ?? 0 };
  });
}

/* =========================
   GET /api/analytics/admin
   ======================== */
export async function adminAnalytics(_req: Request, res: Response) {
  const now = new Date();
  const bookings = bookingCollection();

  const [
    totalUsers,
    totalEquipment,
    totalBookings,
    pendingApprovals,
    completedRentals,
    revenue,
    monthlyRows,
  ] = await Promise.all([
    userCollection().countDocuments({}),
    equipmentCollection().countDocuments({}),
    bookings.countDocuments({}),
    equipmentCollection().countDocuments({ status: "pending" }),
    bookings.countDocuments({ endDate: { $lt: now } }),
    totalAmountMinor({}),
    monthlyBookings({}, now),
  ]);

  res.json({
    success: true,
    data: {
      totalUsers,
      totalEquipment,
      totalBookings,
      pendingApprovals,
      completedRentals,
      totalRevenueMinor: revenue,
      currency: "usd",
      monthly: monthlyRows.map(({ amountMinor, ...row }) => ({
        ...row,
        revenueMinor: amountMinor,
      })),
    },
  });
}

/* =========================
   GET /api/analytics/owner
   ======================== */
export async function ownerAnalytics(req: Request, res: Response) {
  // verifyOwner already guarantees a user, but keep the check for safety.
  if (!req.user) {
    res.status(401).json({ success: false, message: "You must be logged in." });
    return;
  }

  const now = new Date();
  const ownerId = req.user.id;
  const bookings = bookingCollection();
  const ownerBookings: Filter<Booking> = { ownerId };

  const [totalEquipment, completedRentals, earnings, monthlyRows] = await Promise.all([
    equipmentCollection().countDocuments({ ownerId }),
    bookings.countDocuments({ ...ownerBookings, endDate: { $lt: now } }),
    totalAmountMinor(ownerBookings),
    monthlyBookings(ownerBookings, now),
  ]);

  res.json({
    success: true,
    data: {
      totalEquipment,
      completedRentals,
      totalEarningsMinor: earnings,
      currency: "usd",
      monthly: monthlyRows.map(({ amountMinor, ...row }) => ({
        ...row,
        earningsMinor: amountMinor,
      })),
    },
  });
}
