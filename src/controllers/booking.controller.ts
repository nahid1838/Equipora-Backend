import { createHash } from "node:crypto";
import type { Request, Response } from "express";
import { MongoServerError, ObjectId, type Filter } from "mongodb";
import { env } from "../config/env.js";
import { bookingCollection, checkoutCollection, paymentCollection, type Booking, type CheckoutDraft } from "../models/booking.js";
import { equipmentCollection } from "../models/equipment.js";
import { bookingError, calculateRental, readRentalPeriod } from "../utils/booking.js";
import { remainingQuantity } from "../utils/availability.js";
import { checkoutStatusFor, closeCheckout, fulfillCheckout, recordRefund } from "../utils/checkout.js";
import { stripe } from "../utils/stripe.js";
import { isValidObjectId } from "../utils/validation.js";

function objectId(value: unknown) {
  if (typeof value !== "string" || !isValidObjectId(value)) throw bookingError(400, "Invalid ID.");
  return new ObjectId(value);
}

function requestBody(req: Request): Record<string, unknown> {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    throw bookingError(400, "Enter your rental details.");
  }
  return req.body as Record<string, unknown>;
}

async function prepareRental(equipmentId: ObjectId, period: ReturnType<typeof readRentalPeriod>) {
  const equipment = await equipmentCollection().findOne({ _id: equipmentId, status: "approved" });
  if (!equipment) throw bookingError(404, "Equipment not found.");
  const available = await remainingQuantity(equipmentId, equipment.availableQuantity, period.startDate, period.endDate);
  if (available < period.quantity) {
    throw bookingError(409, `Only ${available} available for the requested dates. Choose different dates or quantity.`);
  }
  return { equipment, price: calculateRental(equipment.rentalType, equipment.price, period) };
}

export async function quoteBooking(req: Request, res: Response) {
  const body = requestBody(req);
  const period = readRentalPeriod(body);
  const { price } = await prepareRental(objectId(body.equipmentId), period);
  res.json({ success: true, data: { ...price, durationDays: period.durationDays } });
}

export async function startBookingCheckout(req: Request, res: Response) {
  const user = req.user!;
  const body = requestBody(req);
  const equipmentId = objectId(body.equipmentId);
  const text = (key: string) => typeof body[key] === "string" ? body[key].trim() : "";
  const contactNumber = text("contactNumber");
  const digits = contactNumber.replace(/\D/g, "").length;
  const deliveryAddress = text("deliveryAddress");
  const notes = text("notes");
  const requestKey = text("requestKey");
  if (!/^\+?[\d ()-]+$/.test(contactNumber) || digits < 7 || digits > 15 || contactNumber.length > 32) {
    throw bookingError(400, "Enter a valid contact number.");
  }
  if (!deliveryAddress || deliveryAddress.length > 500 || notes.length > 1000) {
    throw bookingError(400, "Enter a delivery address of up to 500 characters and notes of up to 1,000 characters.");
  }
  if (!/^[\w-]{16,80}$/.test(requestKey)) throw bookingError(400, "Invalid checkout request key.");

  const period = readRentalPeriod(body);
  const fingerprint = createHash("sha256").update(JSON.stringify([
    equipmentId, period.startDate, period.endDate, period.quantity, contactNumber, deliveryAddress, notes,
  ])).digest("hex");
  const filter = { "details.customerId": user.id, requestKey };
  const checkouts = checkoutCollection();
  let draft = await checkouts.findOne(filter);
  let availabilityChecked = false;

  if (!draft) {
    const { equipment, price } = await prepareRental(equipmentId, period);
    availabilityChecked = true;
    if (price.totalAmountMinor < 50 || price.totalAmountMinor > 99_999_999) {
      throw bookingError(400, "The rental total is outside the supported USD card payment range.");
    }
    const newDraft: CheckoutDraft = {
      _id: new ObjectId(), requestKey, fingerprint, state: "open", createdAt: new Date(),
      details: {
        ...period, ...price, equipmentId, equipmentName: equipment.name, rentalType: equipment.rentalType,
        customerId: user.id, customerName: user.name, ownerId: equipment.ownerId, ownerName: equipment.ownerName,
        contactNumber, deliveryAddress, notes,
      },
    };
    try {
      await checkouts.insertOne(newDraft);
      draft = newDraft;
    } catch (error) {
      if (!(error instanceof MongoServerError && error.code === 11000)) throw error;
      draft = await checkouts.findOne(filter);
      if (!draft) throw error;
    }
  }

  if (draft.fingerprint !== fingerprint) throw bookingError(409, "This checkout key already belongs to different rental details.");
  const checkoutId = draft._id.toHexString();
  const returnUrl = new URL(`/booking/payment/${checkoutId}`, env.clientUrl).toString();
  // Stripe replaces the placeholder after payment. The confirm endpoint can
  // verify the same session even when a local webhook is not delivered.
  const successUrl = `${returnUrl}?session_id={CHECKOUT_SESSION_ID}`;
  if (draft.state !== "open" || (!draft.stripeSessionId && Date.now() - draft.createdAt.getTime() >= 86_400_000)) {
    throw bookingError(409, "This checkout has ended. Close the form and start a new checkout.");
  }

  // A retry keeps the same price snapshot but still checks current availability before opening Checkout.
  if (!availabilityChecked && !draft.stripeSessionId) await prepareRental(equipmentId, period);
  let session;
  try {
    session = draft.stripeSessionId
      ? await stripe.checkout.sessions.retrieve(draft.stripeSessionId)
      : await stripe.checkout.sessions.create({
        mode: "payment",
        allowed_payment_method_types: ["card"],
        client_reference_id: checkoutId,
        metadata: { equiporaCheckoutId: checkoutId },
        success_url: successUrl,
        cancel_url: `${returnUrl}?cancelled=1`,
        line_items: [{
          quantity: 1,
          price_data: {
            currency: draft.details.currency,
            unit_amount: draft.details.totalAmountMinor,
            product_data: { name: draft.details.equipmentName },
          },
        }],
      }, { idempotencyKey: `equipora-booking-${checkoutId}` });
  } catch {
    throw bookingError(502, "Could not open payment checkout. Try again with the same rental details.");
  }

  await checkouts.updateOne({ _id: draft._id }, { $set: { stripeSessionId: session.id } });
  if (session.status === "complete") {
    res.json({ success: true, data: { url: `${returnUrl}?session_id=${encodeURIComponent(session.id)}` } });
    return;
  }
  if (session.status !== "open" || !session.url) throw bookingError(409, "This checkout has ended. Close the form and start a new checkout.");
  if (draft.stripeSessionId) await prepareRental(equipmentId, period);
  res.json({ success: true, data: { url: session.url } });
}

export async function checkoutStatus(req: Request, res: Response) {
  const _id = objectId(req.params.id);
  const draft = await checkoutCollection().findOne({ _id, "details.customerId": req.user!.id });
  if (!draft) throw bookingError(404, "Checkout not found.");
  res.json({ success: true, data: await checkoutStatusFor(_id, draft) });
}

/*
  Falls back to Stripe when the webhook has not arrived yet. The customer owns
  the draft, the stored session id must match, and only a paid session is
  fulfilled. Both this endpoint and the webhook share fulfillCheckout(), so
  repeated calls are safe.
*/
export async function confirmCheckout(req: Request, res: Response) {
  const _id = objectId(req.params.id);
  const checkouts = checkoutCollection();
  const draft = await checkouts.findOne({ _id, "details.customerId": req.user!.id });
  if (!draft) throw bookingError(404, "Checkout not found.");

  // Reconcile pending refunds even when their webhook has not arrived.
  // A refund_required payment without a refund id is retried below.
  const payment = await paymentCollection().findOne({ _id });
  if (payment?.outcome === "refund_pending" && payment.stripeRefundId) {
    try {
      const refund = await stripe.refunds.retrieve(payment.stripeRefundId);
      await recordRefund(_id, refund);
    } catch {
      throw bookingError(502, "Could not check the Stripe refund. Try again.");
    }
    res.json({ success: true, data: await checkoutStatusFor(_id, draft) });
    return;
  }
  if (payment) {
    const fulfilled = payment.outcome === "booked"
      ? Boolean(await bookingCollection().findOne({ _id }))
      : payment.outcome !== "refund_required" || Boolean(payment.stripeRefundId);
    if (fulfilled) {
      res.json({ success: true, data: await checkoutStatusFor(_id, draft) });
      return;
    }
  }
  if (!payment && draft.state !== "open") {
    res.json({ success: true, data: await checkoutStatusFor(_id, draft) });
    return;
  }
  if (!draft.stripeSessionId) throw bookingError(409, "This checkout has not been opened in Stripe yet.");

  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(draft.stripeSessionId);
  } catch {
    throw bookingError(502, "Could not reach Stripe to confirm this payment. Try again.");
  }
  if (
    session.id !== draft.stripeSessionId || session.mode !== "payment"
    || session.client_reference_id !== _id.toHexString()
    || session.metadata?.equiporaCheckoutId !== _id.toHexString()
  ) {
    throw bookingError(409, "This payment session does not match the checkout.");
  }

  if (session.status === "expired") await closeCheckout(session, "expired");
  else if (session.payment_status === "paid") {
    await fulfillCheckout(session, `checkout-confirm:${session.id}`);
  }
  // Otherwise Stripe has not reported the payment as paid yet; the page polls.

  const current = await checkouts.findOne({ _id }) ?? draft;
  res.json({ success: true, data: await checkoutStatusFor(_id, current) });
}

export async function listBookings(req: Request, res: Response) {
  const user = req.user!;
  const filter: Filter<Booking> = user.role === "customer" ? { customerId: user.id }
    : user.role === "owner" ? { ownerId: user.id } : {};
  const page = req.query.page === undefined ? 1 : Number(req.query.page);
  const limit = 10;
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger((page - 1) * limit)) {
    throw bookingError(400, "Invalid page number.");
  }
  const collection = bookingCollection();
  const [data, total] = await Promise.all([
    collection.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).toArray(),
    collection.countDocuments(filter),
  ]);
  res.json({ success: true, data: data.map(({ customerId: _customerId, ownerId: _ownerId, ...booking }) => booking), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
}
