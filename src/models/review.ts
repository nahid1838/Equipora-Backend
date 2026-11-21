import type { ObjectId } from "mongodb";
import { getDB } from "../config/db.js";

export type ReviewStatus = "pending" | "approved" | "rejected";
export type Review = {
  _id: ObjectId;
  bookingId: ObjectId;
  name: string;
  equipmentName: string;
  rating: number;
  comment: string;
  status: ReviewStatus;
  createdAt: Date;
  reviewedAt?: Date;
  reviewedBy?: string;
};

export const reviewCollection = () => getDB().collection<Review>("reviews");

export async function createReviewIndexes() {
  await reviewCollection().createIndexes([
    { key: { bookingId: 1 }, unique: true },
    { key: { status: 1, rating: -1, reviewedAt: -1, _id: -1 } },
    { key: { status: 1, createdAt: 1, _id: 1 } },
  ]);
}
