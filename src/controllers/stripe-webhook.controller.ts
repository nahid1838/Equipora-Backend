import type { Request, Response } from "express";
import type Stripe from "stripe";
import { env } from "../config/env.js";
import { bookingError } from "../utils/booking.js";
import { checkoutObjectId, closeCheckout, fulfillCheckout, recordRefund } from "../utils/checkout.js";
import { stripe } from "../utils/stripe.js";

export async function stripeWebhook(req: Request, res: Response) {
  if (!env.stripeWebhookSecret) throw bookingError(503, "Webhook is not configured.");
  const signature = req.get("stripe-signature");
  if (!signature || !Buffer.isBuffer(req.body)) throw bookingError(400, "Missing Stripe signature or raw body.");

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(req.body, signature, env.stripeWebhookSecret);
  } catch {
    throw bookingError(400, "Invalid Stripe webhook signature.");
  }

  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      await fulfillCheckout(event.data.object, event.id);
      break;
    case "checkout.session.async_payment_failed":
      await closeCheckout(event.data.object, "failed");
      break;
    case "checkout.session.expired":
      await closeCheckout(event.data.object, "expired");
      break;
    case "refund.updated":
    case "refund.failed": {
      const refund = event.data.object;
      const _id = checkoutObjectId(refund.metadata?.equiporaCheckoutId);
      if (_id) await recordRefund(_id, refund);
      break;
    }
  }
  res.json({ success: true, message: "Webhook received." });
}
