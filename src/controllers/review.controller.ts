import type { Request, Response } from "express";
import { MongoServerError, ObjectId } from "mongodb";
import { bookingCollection, paymentCollection } from "../models/booking.js";
import { reviewCollection, type Review } from "../models/review.js";
import { userCollection } from "../models/user.js";
import { isCompletedPaidBooking } from "../utils/review-eligibility.js";
import { isValidObjectId } from "../utils/validation.js";

function fail(res: Response, status: number, message: string) {
  res.status(status).json({ success: false, message });
}

async function currentAccount(req: Request, role: "customer" | "admin") {
  if (!req.user || !isValidObjectId(req.user.id)) return null;
  const user = await userCollection().findOne({ _id: new ObjectId(req.user.id) }, { projection: { name: 1, role: 1 } });
  return user && (user.role ?? "customer") === role ? user : null;
}

export async function submitReview(req: Request, res: Response) {
  const account = await currentAccount(req, "customer");
  if (!account) return fail(res, 403, "Customer access is required.");
  const body = req.body;
  if (!body || typeof body !== "object" || Array.isArray(body)
    || Object.keys(body).some((key) => !["bookingId", "rating", "comment"].includes(key))) {
    return fail(res, 400, "Submit only the booking ID, rating, and comment.");
  }
  const { bookingId, rating } = body;
  const comment = typeof body.comment === "string" ? body.comment.trim() : "";
  if (typeof bookingId !== "string" || !isValidObjectId(bookingId) || !Number.isInteger(rating)
    || rating < 1 || rating > 5 || !comment || comment.length > 1000) {
    return fail(res, 400, "Choose a rating from 1 to 5 and enter a comment up to 1,000 characters for a valid booking.");
  }

  const _id = new ObjectId(bookingId);
  const booking = await bookingCollection().findOne({ _id, customerId: req.user!.id });
  if (!booking) return fail(res, 404, "Booking not found.");
  if (!isCompletedPaidBooking(booking, new Date())) return fail(res, 409, "Reviews are available after a paid rental ends.");
  const payment = await paymentCollection().findOne({
    _id, outcome: "booked", amountMinor: booking.totalAmountMinor, currency: booking.currency,
  });
  if (!payment) return fail(res, 409, "This booking does not have a verified payment.");

  const review: Review = {
    _id: new ObjectId(), bookingId: _id, name: account.name, equipmentName: booking.equipmentName,
    rating, comment, status: "pending", createdAt: new Date(),
  };
  try {
    await reviewCollection().insertOne(review);
  } catch (error) {
    if (error instanceof MongoServerError && error.code === 11000) {
      return fail(res, 409, "A review has already been submitted for this booking.");
    }
    throw error;
  }
  res.status(201).json({ success: true, data: { status: review.status } });
}

function readPage(value: unknown, limit: number) {
  const page = value === undefined ? 1 : typeof value === "string" ? Number(value) : NaN;
  return Number.isSafeInteger(page) && page > 0 && Number.isSafeInteger((page - 1) * limit) ? page : null;
}

export async function listPublicReviews(req: Request, res: Response) {
  const limit = req.query.limit === undefined ? 12 : typeof req.query.limit === "string" ? Number(req.query.limit) : NaN;
  const page = readPage(req.query.page, limit);
  if (page === null || !Number.isInteger(limit) || limit < 1 || limit > 50) return fail(res, 400, "Invalid page or limit.");
  const reviews = reviewCollection();
  const filter = { status: "approved" } as const;
  const [rows, total] = await Promise.all([
    reviews.find(filter).sort({ rating: -1, reviewedAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).toArray(),
    reviews.countDocuments(filter),
  ]);
  const data = rows.map(({ _id, name, rating, comment, reviewedAt }) => ({ id: _id.toHexString(), name, rating, comment, publishedAt: reviewedAt }));
  res.json({ success: true, data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
}

export async function listPendingReviews(req: Request, res: Response) {
  if (!await currentAccount(req, "admin")) return fail(res, 403, "Administrator access is required.");
  const limit = 10;
  const page = readPage(req.query.page, limit);
  if (page === null) return fail(res, 400, "Invalid page number.");
  const reviews = reviewCollection();
  const filter = { status: "pending" } as const;
  const [rows, total] = await Promise.all([
    reviews.find(filter).sort({ createdAt: 1, _id: 1 }).skip((page - 1) * limit).limit(limit).toArray(),
    reviews.countDocuments(filter),
  ]);
  const data = rows.map(({ _id, name, equipmentName, rating, comment, createdAt }) => ({ id: _id.toHexString(), name, equipmentName, rating, comment, createdAt }));
  res.json({ success: true, data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
}

export async function moderateReview(req: Request, res: Response) {
  const admin = await currentAccount(req, "admin");
  if (!admin) return fail(res, 403, "Administrator access is required.");
  const id = typeof req.params.id === "string" ? req.params.id : "";
  const status = req.body?.status;
  if (!isValidObjectId(id) || (status !== "approved" && status !== "rejected") || Object.keys(req.body).length !== 1) {
    return fail(res, 400, "Choose approved or rejected for a valid review.");
  }
  const reviews = reviewCollection();
  const _id = new ObjectId(id);
  const updated = await reviews.updateOne({ _id, status: "pending" }, {
    $set: { status, reviewedAt: new Date(), reviewedBy: admin._id.toHexString() },
  });
  if (!updated.matchedCount) {
    if (!await reviews.findOne({ _id })) return fail(res, 404, "Review not found.");
    return fail(res, 409, "This review has already been moderated.");
  }
  res.json({ success: true, data: { status } });
}
