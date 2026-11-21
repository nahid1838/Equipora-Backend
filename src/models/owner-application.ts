import type { ObjectId } from "mongodb";
import { getDB } from "../config/db.js";

export type OwnerApplication = {
  _id: ObjectId;
  userId: ObjectId;
  businessName: string;
  reason: string;
  additionalInformation: string;
  status: "pending" | "approved" | "rejected";
  createdAt: Date;
  updatedAt: Date;
  reviewedAt?: Date;
  reviewedBy?: ObjectId;
  approvalStartedBy?: ObjectId;
};

export const ownerApplications = () => getDB().collection<OwnerApplication>("ownerApplications");

export async function createOwnerApplicationIndexes() {
  const applications = ownerApplications();
  await applications.createIndexes([
    { key: { userId: 1 }, unique: true, partialFilterExpression: { status: "pending" } },
    { key: { userId: 1, createdAt: -1, _id: -1 } },
    { key: { createdAt: -1, _id: -1 } },
  ]);
}
