import type { RentalType } from "../models/equipment.js";

const DAY_MS = 86_400_000;
const marketplaceDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka", dateStyle: "short" });

export function bookingError(status: number, message: string) {
  return Object.assign(new Error(message), { status });
}

function dateOnly(value: unknown): Date {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = new Date(`${value}T00:00:00.000Z`);
    if (Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value) return date;
  }
  throw bookingError(400, "Enter valid start and end dates.");
}

export function readRentalPeriod(input: Record<string, unknown>, now = new Date()) {
  const startDate = dateOnly(input.startDate);
  const endDate = dateOnly(input.endDate);
  const durationDays = (endDate.getTime() - startDate.getTime()) / DAY_MS;
  if (startDate <= dateOnly(marketplaceDate.format(now))) {
    throw bookingError(400, "The rental start date must be in the future.");
  }
  if (durationDays <= 0) {
    throw bookingError(400, "The end date must follow the start date.");
  }
  const quantity = input.quantity;
  if (typeof quantity !== "number" || !Number.isSafeInteger(quantity) || quantity < 1) {
    throw bookingError(400, "Quantity must be a positive whole number.");
  }
  return { startDate, endDate, durationDays, quantity };
}

export function calculateRental(
  rentalType: RentalType, rentalPrice: number,
  period: { startDate: Date; endDate: Date; durationDays: number; quantity: number }
) {
  const { startDate, endDate, durationDays, quantity } = period;
  let billableUnits = rentalType === "weekly" ? Math.ceil(durationDays / 7) : durationDays;
  if (rentalType === "monthly") {
    // Month anniversaries stay anchored to the original day and clamp at month end.
    const year = endDate.getUTCFullYear();
    const month = endDate.getUTCMonth();
    const months = (year - startDate.getUTCFullYear()) * 12 + month - startDate.getUTCMonth();
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const anniversaryDay = Math.min(startDate.getUTCDate(), lastDay);
    billableUnits = Math.max(1, months + Number(endDate.getUTCDate() > anniversaryDay));
  }
  // Shift the decimal before converting to cents to avoid binary rounding at half-cent boundaries.
  const [decimal, exponent = "0"] = rentalPrice.toString().split("e");
  const unitPriceMinor = Math.round(Number(`${decimal}e${Number(exponent) + 2}`));
  const totalAmountMinor = unitPriceMinor * billableUnits * quantity;
  if (unitPriceMinor < 1 || !Number.isSafeInteger(totalAmountMinor)) {
    throw bookingError(400, "The rental price or total amount is outside the supported range.");
  }
  return { unitPriceMinor, billableUnits, totalAmountMinor, currency: "usd" as const };
}

export function peakReservedQuantity(rows: { startDate: Date; endDate: Date; quantity: number }[]) {
  const changes = new Map<number, number>();
  for (const { startDate, endDate, quantity } of rows) {
    const start = startDate.getTime();
    const end = endDate.getTime();
    changes.set(start, (changes.get(start) ?? 0) + quantity);
    changes.set(end, (changes.get(end) ?? 0) - quantity);
  }
  let current = 0;
  let peak = 0;
  for (const date of [...changes.keys()].sort((a, b) => a - b)) {
    current += changes.get(date)!;
    peak = Math.max(peak, current);
  }
  return peak;
}
