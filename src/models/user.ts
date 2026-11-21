import type { ObjectId } from "mongodb";
import { getDB } from "../config/db.js";

// Role values used across Better Auth, the JWT, and this API.
export const USER_ROLES = ["customer", "owner", "admin"] as const;
export type UserRole = (typeof USER_ROLES)[number];

/*
  Better Auth owns the "user" collection. Password hashes and OAuth accounts
  live in the separate "account" collection, so this document never contains a
  secret. The Express API manages roles and records the application used for an approval.
*/
export type UserDocument = {
  _id: ObjectId;
  name: string;
  email: string;
  role?: string;
  ownerApprovalId?: ObjectId;
  image?: string | null;
  emailVerified?: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export function userCollection() {
  return getDB().collection<UserDocument>("user");
}
