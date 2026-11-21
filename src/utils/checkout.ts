import { MongoServerError, ObjectId } from "mongodb";
import type Stripe from "stripe";
import {
  bookingCollection,
  checkoutCollection,
  paymentCollection,
  type CheckoutDraft,
  type Payment,
} from "../models/booking.js";
import { equipmentCollection } from "../models/equipment.js";
import { bookingError, readRentalPeriod } from "./booking.js";
import { remainingQuantity } from "./availability.js";
import { stripe } from "./stripe.js";

const CHECKOUT_ID = /^[\da-f]{24}$/i;

export type CheckoutState =
  | "open"
  | "processing"
  | "confirmed"
  | "expired"
  | "failed"
  | "refund_required"
  | "refund_pending"
  | "refunded";

// Stripe expands references to either an id string or the expanded object.
export function stripeId(value: string | { id: string } | null | undefined) {
  return typeof value === "string" ? value : value?.id;
}

// Checkout ids are stored in Stripe metadata, so they arrive back as strings.
export function checkoutObjectId(value: string | null | undefined) {
  return value && CHECKOUT_ID.test(value) ? new ObjectId(value) : null;
}

export async function recordRefund(_id: ObjectId, refund: Stripe.Refund) {
  const intent = stripeId(refund.payment_intent);
  if (!intent) return;
  const outcome = refund.status === "succeeded" ? "refunded"
    : refund.status === "pending" || refund.status === "requires_action" ? "refund_pending"
    : "refund_required";
  await paymentCollection().updateOne({
    _id, stripePaymentIntentId: intent, outcome: { $in: ["refund_required", "refund_pending"] },
    $or: [{ stripeRefundId: { $exists: false } }, { stripeRefundId: refund.id }],
  }, { $set: { stripeRefundId: refund.id, outcome } });
}

// Links the Stripe session to its draft and returns it only when the session
// belongs to this checkout. Used by both the webhook and the confirm endpoint.
async function linkedDraft(session: Stripe.Checkout.Session) {
  const _id = checkoutObjectId(session.metadata?.equiporaCheckoutId);
  if (!_id || session.client_reference_id !== _id.toHexString() || session.mode !== "payment") return null;
  const draft = await checkoutCollection().findOneAndUpdate({
    _id, $or: [{ stripeSessionId: session.id }, { stripeSessionId: { $exists: false } }],
  }, { $set: { stripeSessionId: session.id } }, { returnDocument: "after" });
  return draft ? { _id, draft } : null;
}

export async function closeCheckout(session: Stripe.Checkout.Session, state: "expired" | "failed") {
  const linked = await linkedDraft(session);
  if (!linked) return;
  await checkoutCollection().updateOne({ _id: linked._id, state: "open" }, { $set: { state } });
}

async function paymentTime(intentId: string, session: Stripe.Checkout.Session) {
  let intent: Stripe.PaymentIntent;
  try {
    intent = await stripe.paymentIntents.retrieve(intentId, { expand: ["latest_charge"] });
  } catch {
    throw bookingError(502, "Could not verify the Stripe payment. Try again.");
  }
  const charge = intent.latest_charge;
  if (intent.id !== intentId || intent.status !== "succeeded" || !charge || typeof charge === "string"
    || !charge.paid || !charge.captured || charge.status !== "succeeded"
    || stripeId(charge.payment_intent) !== intentId
    || intent.amount_received !== session.amount_total || charge.amount_captured !== session.amount_total
    || intent.currency !== session.currency || charge.currency !== session.currency
    || !Number.isSafeInteger(charge.created) || charge.created <= 0) {
    throw bookingError(503, "Stripe payment details are not ready for verification.");
  }
  // Checkout uses automatic card capture. The successful Charge was created
  // at payment time, even when fulfillment happens much later.
  return new Date(charge.created * 1000);
}

/*
  Creates the payment decision and, when the rental is still available, the
  booking. Safe to call more than once: the payment insert is guarded by _id and
  the booking uses an upsert with $setOnInsert. The webhook and the customer
  confirm endpoint both call this, so they can never diverge.
*/
export async function fulfillCheckout(session: Stripe.Checkout.Session, sourceId: string) {
  const linked = await linkedDraft(session);
  if (!linked) return;
  if (session.payment_status !== "paid") return;
  const { _id, draft } = linked;

  const intent = stripeId(session.payment_intent);
  if (!intent || session.amount_total === null || !session.currency) throw bookingError(503, "Payment data unavailable.");

  const payments = paymentCollection();
  let payment = await payments.findOne({ _id });
  const details = draft.details;
  if (!payment) {
    const paidAt = await paymentTime(intent, session);
    const equipment = await equipmentCollection().findOne({ _id: details.equipmentId, status: "approved" });
    let validDates = true;
    try {
      readRentalPeriod({
        startDate: details.startDate.toISOString().slice(0, 10),
        endDate: details.endDate.toISOString().slice(0, 10), quantity: details.quantity,
      }, paidAt);
    } catch {
      validDates = false;
    }
    const available = equipment && validDates
      ? await remainingQuantity(details.equipmentId, equipment.availableQuantity, details.startDate, details.endDate)
      : 0;
    const canBook = available >= details.quantity && session.amount_total === details.totalAmountMinor && session.currency === details.currency;
    const decision: Payment = {
      _id, stripeSessionId: session.id, stripePaymentIntentId: intent, stripeEventId: sourceId,
      amountMinor: session.amount_total, currency: session.currency, createdAt: paidAt,
      outcome: canBook ? "booked" : "refund_required",
    };
    try {
      await payments.insertOne(decision);
      payment = decision;
    } catch (error) {
      if (!(error instanceof MongoServerError && error.code === 11000)) throw error;
      payment = await payments.findOne({ _id });
      if (!payment) throw error;
    }
  }
  if (payment.stripeSessionId !== session.id || payment.stripePaymentIntentId !== intent) {
    throw bookingError(500, "Checkout payment reference mismatch.");
  }

  if (payment.outcome === "booked") {
    try {
      await bookingCollection().updateOne({ _id }, { $setOnInsert: {
        ...details, bookingStatus: "confirmed", paymentStatus: "paid", createdAt: payment.createdAt,
      } }, { upsert: true });
    } catch (error) {
      if (!(error instanceof MongoServerError && error.code === 11000) || !await bookingCollection().findOne({ _id })) throw error;
    }
    return;
  }
  if (payment.outcome === "refunded" || payment.stripeRefundId) return;

  let refund;
  try {
    refund = await stripe.refunds.create({ payment_intent: intent, metadata: { equiporaCheckoutId: _id.toHexString() } }, {
      idempotencyKey: `equipora-unavailable-${_id.toHexString()}`,
    });
  } catch {
    // Keep the paid transaction in refund_required and let Stripe retry delivery.
    throw bookingError(502, "The refund could not be submitted yet.");
  }
  await recordRefund(_id, refund);
}

/*
  The single source of truth for the payment page status. A payment decision
  wins over the draft state; a booked payment counts as confirmed only after the
  booking document exists.
*/
export async function checkoutStatusFor(_id: ObjectId, draft: CheckoutDraft) {
  const payment = await paymentCollection().findOne({ _id });
  const booking = payment?.outcome === "booked" ? await bookingCollection().findOne({ _id }) : null;
  const status: CheckoutState = booking
    ? "confirmed"
    : payment?.outcome === "booked" ? "processing" : payment?.outcome ?? draft.state;
  return { status, equipmentId: draft.details.equipmentId.toHexString() };
}
