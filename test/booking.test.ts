import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateRental, peakReservedQuantity, readRentalPeriod } from "../src/utils/booking.js";

const now = new Date("2028-01-01T00:00:00Z");
const period = (startDate: string, endDate: string, quantity = 1) => readRentalPeriod({ startDate, endDate, quantity }, now);

test("daily and weekly prices use integer cents, quantity, and rounded-up rental units", () => {
  const dates = period("2028-01-10", "2028-01-18", 3);
  assert.equal(calculateRental("daily", 2.35, dates).totalAmountMinor, 5640);
  assert.equal(calculateRental("weekly", 20, dates).billableUnits, 2);
  assert.equal(calculateRental("weekly", 20, dates).totalAmountMinor, 12000);
  assert.equal(calculateRental("weekly", 20, period("2028-01-10", "2028-01-17")).billableUnits, 1);
  assert.equal(calculateRental("daily", 1.005, period("2028-01-10", "2028-01-11")).unitPriceMinor, 101);
});

test("calendar month pricing clamps February and retains the original anniversary day", () => {
  assert.equal(calculateRental("monthly", 100, period("2028-01-31", "2028-02-29")).billableUnits, 1);
  assert.equal(calculateRental("monthly", 100, period("2028-01-31", "2028-03-01")).billableUnits, 2);
  assert.equal(calculateRental("monthly", 100, period("2028-01-31", "2028-03-31")).billableUnits, 2);
  assert.equal(calculateRental("monthly", 100, period("2028-01-31", "2028-04-01")).billableUnits, 3);
  assert.equal(calculateRental("monthly", 100, period("2028-12-31", "2029-01-01")).billableUnits, 1);
});

test("rejects invalid dates, same-day and past starts, reversed ranges, and invalid quantities", () => {
  assert.throws(() => period("2028-02-30", "2028-03-02"), /valid start and end/);
  assert.throws(() => period("2028-01-01", "2028-01-03"), /future/);
  assert.throws(() => period("2027-12-31", "2028-01-03"), /future/);
  assert.throws(() => period("2028-01-10", "2028-01-10"), /end date/);
  assert.throws(() => period("2028-01-11", "2028-01-10"), /end date/);
  for (const quantity of [0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => period("2028-01-10", "2028-01-11", quantity), /positive whole number/);
  }
});

test("adjacent reservations share stock while overlapping quantities add only at the peak", () => {
  const first = period("2028-01-10", "2028-01-12", 2);
  const next = period("2028-01-12", "2028-01-16", 3);
  const overlap = period("2028-01-11", "2028-01-14", 1);
  assert.equal(peakReservedQuantity([first, next]), 3);
  assert.equal(peakReservedQuantity([first, next, overlap]), 4);
  assert.equal(peakReservedQuantity([]), 0);
});
