import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";
import express from "express";
import { ObjectId } from "mongodb";
import Stripe from "stripe";

const signingSecret = "isolated-booking-test-secret";
Object.assign(process.env, {
  DOTENV_CONFIG_PATH: "nonexistent-equipora-test.env",
  MONGODB_URI: "mongodb://127.0.0.1:1/test",
  BETTER_AUTH_URL: "http://localhost:3000",
  CLIENT_URL: "http://localhost:3000",
  IMGBB_API_KEY: "isolated-test",
  STRIPE_SECRET_KEY: "sk_test_isolated",
  STRIPE_WEBHOOK_SECRET: signingSecret,
});

const ids = { equipment: new ObjectId(), customer: new ObjectId().toHexString() };
const date = (day: number) => new Date(Date.UTC(2099, 0, day));
const rows: Record<string, Record<string, unknown>[]> = {
  equipments: [{ _id: ids.equipment, status: "approved", availableQuantity: 5,
    rentalType: "daily", price: 10, name: "Test equipment", ownerId: "owner", ownerName: "Owner" }],
  bookings: [], payments: [], booking_checkouts: [],
};
let afterDraftInsert: (() => void) | undefined;

function lookup(row: Record<string, unknown>, key: string) {
  return key.split(".").reduce<unknown>((value, part) => (value as Record<string, unknown> | undefined)?.[part], row);
}

function equal(left: unknown, right: unknown) {
  return left instanceof ObjectId ? left.equals(right as ObjectId) : left === right;
}

function matches(row: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([key, value]) => {
    if (key === "$or") return (value as Record<string, unknown>[]).some((part) => matches(row, part));
    const actual = lookup(row, key);
    if (value && typeof value === "object" && !(value instanceof ObjectId)) {
      if ("$lt" in value) return (actual as Date) < (value.$lt as Date);
      if ("$gt" in value) return (actual as Date) > (value.$gt as Date);
      if ("$in" in value) return (value.$in as unknown[]).some((candidate) => equal(actual, candidate));
      if ("$exists" in value) return (actual !== undefined) === value.$exists;
    }
    return equal(actual, value);
  });
}

const db = {
  collection(name: string) {
    const collection = rows[name]!;
    const find = (filter: Record<string, unknown>) => collection.filter((row) => matches(row, filter));
    return {
      find: (filter: Record<string, unknown>) => ({ toArray: async () => find(filter) }),
      async findOne(filter: Record<string, unknown>) {
        const row = find(filter)[0];
        return row ? { ...row } : null;
      },
      async insertOne(row: Record<string, unknown>) {
        collection.push({ ...row });
        if (name === "booking_checkouts") afterDraftInsert?.();
      },
      async findOneAndUpdate(filter: Record<string, unknown>, update: { $set: object }) {
        const row = find(filter)[0];
        return row ? { ...Object.assign(row, update.$set) } : null;
      },
      async updateOne(filter: Record<string, unknown>, update: { $set?: object; $setOnInsert?: object }, options?: { upsert: boolean }) {
        const row = find(filter)[0];
        if (row) Object.assign(row, update.$set);
        else if (options?.upsert) collection.push({ ...filter, ...update.$setOnInsert });
      },
    };
  },
};

const stripe = new Stripe("sk_test_isolated");
const sessions = new Map<string, Stripe.Checkout.Session>();
let sessionCreations = 0;
let refunds = 0;
stripe.checkout.sessions.create = (async (params: Stripe.Checkout.SessionCreateParams) => {
  const id = `cs_test_${++sessionCreations}`;
  const session = {
    id, status: "open", payment_status: "unpaid", mode: "payment", currency: "usd",
    amount_total: params.line_items?.[0]?.price_data?.unit_amount,
    client_reference_id: params.client_reference_id, metadata: params.metadata,
    payment_intent: `pi_${id}`, url: `https://example.test/${id}`,
  } as Stripe.Checkout.Session;
  sessions.set(id, session);
  return session;
}) as typeof stripe.checkout.sessions.create;
stripe.checkout.sessions.retrieve = (async (id: string) => sessions.get(id)) as typeof stripe.checkout.sessions.retrieve;
stripe.paymentIntents.retrieve = (async (id: string) => {
  const amount = [...sessions.values()].find((session) => session.payment_intent === id)!.amount_total;
  return { id, status: "succeeded", amount_received: amount, currency: "usd", latest_charge: {
    paid: true, captured: true, status: "succeeded", amount_captured: amount, payment_intent: id,
    currency: "usd", created: Math.floor(Date.now() / 1000),
  } };
}) as typeof stripe.paymentIntents.retrieve;
stripe.refunds.create = (async (params: Stripe.RefundCreateParams) => {
  refunds++;
  return { id: "re_test", status: "succeeded", payment_intent: params.payment_intent };
}) as typeof stripe.refunds.create;

Object.assign(globalThis, { availabilityTestDb: db, availabilityTestStripe: stripe });
registerHooks({ resolve(specifier, context, next) {
  if (specifier.endsWith("/config/db.js")) return {
    url: "data:text/javascript,export const getDB=()=>globalThis.availabilityTestDb", shortCircuit: true,
  };
  if (specifier.endsWith("/stripe.js")) return {
    url: "data:text/javascript,export const stripe=globalThis.availabilityTestStripe", shortCircuit: true,
  };
  return next(specifier, context);
} });

const { remainingQuantity } = await import("../src/utils/availability.js");
const { bookingAvailability, quoteBooking, startBookingCheckout, confirmCheckout } = await import("../src/controllers/booking.controller.js");
const { stripeWebhook } = await import("../src/controllers/stripe-webhook.controller.js");
const { errorHandler } = await import("../src/middlewares/errorHandler.js");

function reserve(start: number, end: number, quantity: number, bookingStatus = "confirmed", paymentStatus = "paid", outcome = "booked") {
  const _id = new ObjectId();
  rows.bookings!.push({ _id, equipmentId: ids.equipment, startDate: date(start), endDate: date(end), quantity, bookingStatus, paymentStatus });
  rows.payments!.push({ _id, outcome });
}

test("availability uses peak overlapping paid units, exclusive ends, and recorded refund states", async () => {
  rows.bookings!.length = 0;
  rows.payments!.length = 0;
  reserve(10, 12, 2);
  reserve(12, 14, 3);
  reserve(9, 10, 5);
  reserve(14, 15, 5);
  for (const status of ["cancelled", "failed", "expired"]) reserve(10, 14, 5, status);
  reserve(10, 14, 5, "confirmed", "unpaid");
  for (const outcome of ["refund_pending", "refund_required", "refunded"]) reserve(10, 14, 5, "confirmed", "paid", outcome);
  assert.equal(await remainingQuantity(ids.equipment, 5, date(10), date(12)), 3);
  assert.equal(await remainingQuantity(ids.equipment, 5, date(10), date(14)), 2);
  assert.equal(await remainingQuantity(ids.equipment, 5, date(15), date(16)), 5);
  reserve(11, 13, 2);
  assert.equal(await remainingQuantity(ids.equipment, 5, date(10), date(14)), 0);
});

test("checkout rechecks quantity, webhook refunds unavailable dates, and recovery is idempotent", async () => {
  rows.bookings!.length = 0;
  rows.payments!.length = 0;
  reserve(10, 13, 2);
  const app = express();
  app.post("/webhook", express.raw({ type: "application/json" }), stripeWebhook);
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: ids.customer, role: "customer", name: "Test customer", email: "test@example.test" };
    next();
  });
  app.post("/availability", bookingAvailability);
  app.post("/quote", quoteBooking);
  app.post("/checkout", startBookingCheckout);
  app.post("/confirm/:id", confirmCheckout);
  app.use(errorHandler);
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  const address = server.address() as import("node:net").AddressInfo;
  const base = `http://127.0.0.1:${address.port}`;
  const rental = { equipmentId: ids.equipment.toHexString(), startDate: "2099-01-10", endDate: "2099-01-13" };
  const order = { ...rental, quantity: 3, contactNumber: "01712345678", deliveryAddress: "Isolated test", requestKey: "isolated-request-key-1" };
  const post = (path: string, body?: unknown) => fetch(base + path, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const markPaid = (session: Stripe.Checkout.Session) => {
    session.payment_status = "paid";
    session.status = "complete";
  };
  const webhook = (session: Stripe.Checkout.Session) => {
    const payload = JSON.stringify({ id: "evt_availability", type: "checkout.session.completed", data: { object: session } });
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: signingSecret });
    return fetch(base + "/webhook", { method: "POST", headers: { "content-type": "application/json", "stripe-signature": signature }, body: payload });
  };

  try {
    assert.equal((await (await post("/availability", rental)).json()).data.availableQuantity, 3);
    assert.equal((await post("/quote", { ...rental, quantity: 4 })).status, 409);
    assert.equal((await post("/checkout", { ...order, quantity: 4 })).status, 409);
    afterDraftInsert = () => reserve(10, 13, 3);
    assert.equal((await post("/checkout", { ...order, requestKey: "isolated-stale-request" })).status, 409);
    afterDraftInsert = undefined;
    rows.bookings!.pop();
    rows.payments!.pop();
    assert.equal(sessionCreations, 0);
    assert.equal((await post("/checkout", order)).status, 200);
    const first = [...sessions.values()][0]!;
    // A saved Stripe session keeps its original amount even if the listing changes.
    rows.equipments![0]!.price = 0.001;
    assert.equal((await post("/checkout", order)).status, 200);
    assert.equal(first.amount_total, 9000);
    rows.equipments![0]!.price = 10;
    reserve(10, 13, 3);
    assert.equal((await post("/checkout", order)).status, 409);
    assert.equal(sessionCreations, 1);
    markPaid(first);
    assert.equal((await webhook(first)).status, 200);
    assert.equal((await webhook(first)).status, 200);
    assert.equal(refunds, 1);
    assert.equal(rows.bookings!.length, 2);
    assert.equal((await (await post(`/confirm/${first.client_reference_id}`)).json()).data.status, "refunded");

    const later = { ...order, startDate: "2099-01-13", endDate: "2099-01-15", quantity: 5, requestKey: "isolated-request-key-2" };
    assert.equal((await post("/checkout", later)).status, 200);
    const second = [...sessions.values()][1]!;
    markPaid(second);
    assert.equal((await (await post(`/confirm/${second.client_reference_id}`)).json()).data.status, "confirmed");
    assert.equal((await webhook(second)).status, 200);
    assert.equal((await (await post(`/confirm/${second.client_reference_id}`)).json()).data.status, "confirmed");
    assert.equal(rows.bookings!.length, 3);
    assert.equal(rows.equipments![0]!.availableQuantity, 5);
  } finally {
    server.close();
  }
});
