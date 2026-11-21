import type { Request, Response } from "express";
import { ObjectId, type Filter } from "mongodb";
import { USER_ROLES, userCollection, type UserDocument, type UserRole } from "../models/user.js";
import { escapeRegex, isValidObjectId } from "../utils/validation.js";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

// Reads a query parameter as a trimmed string (ignores arrays/objects).
function queryText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

// Reads the ":id" route parameter (Express 5 types it as string | string[]).
function routeId(req: Request): string {
  return typeof req.params.id === "string" ? req.params.id : "";
}

// Returns a valid role or null. Also used to normalize legacy users that have
// no role yet (they behave as customers everywhere else in the app).
function readRole(value: unknown): UserRole | null {
  return typeof value === "string" && USER_ROLES.includes(value as UserRole)
    ? (value as UserRole)
    : null;
}

// The exact fields the admin UI needs; never expose internal auth data.
function serializeUser(user: UserDocument) {
  return {
    _id: user._id.toHexString(),
    name: user.name,
    email: user.email,
    role: readRole(user.role) ?? "customer",
    image: user.image ?? "",
    emailVerified: user.emailVerified ?? false,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

/* =========================
   GET /api/admin/users
   ======================== */
export async function listUsers(req: Request, res: Response) {
  const search = queryText(req.query.search);
  const roleParam = queryText(req.query.role);
  const pageParam = queryText(req.query.page);
  const limitParam = queryText(req.query.limit);

  const page = pageParam ? Number(pageParam) : 1;
  if (!Number.isInteger(page) || page < 1) {
    res.status(400).json({ success: false, message: "page must be a whole number of 1 or more." });
    return;
  }

  const limit = limitParam ? Number(limitParam) : DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    res.status(400).json({ success: false, message: `limit must be a whole number between 1 and ${MAX_LIMIT}.` });
    return;
  }

  const role = roleParam ? readRole(roleParam) : null;
  if (roleParam && !role) {
    res.status(400).json({ success: false, message: `role must be one of: ${USER_ROLES.join(", ")}.` });
    return;
  }

  const filter: Filter<UserDocument> = {};

  if (search) {
    // escapeRegex prevents user input from breaking or injecting regex
    const safeSearch = escapeRegex(search);
    filter.$or = [
      { name: { $regex: safeSearch, $options: "i" } },
      { email: { $regex: safeSearch, $options: "i" } },
    ];
  }
  if (role) {
    filter.role = role;
  }

  const skip = (page - 1) * limit;
  if (!Number.isSafeInteger(skip)) {
    res.status(400).json({ success: false, message: "page is too large." });
    return;
  }

  const users = userCollection();
  const [rows, total] = await Promise.all([
    users
      .find(filter, {
        projection: {
          name: 1,
          email: 1,
          role: 1,
          image: 1,
          emailVerified: 1,
          createdAt: 1,
          updatedAt: 1,
        },
      })
      .sort({ createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .toArray(),
    users.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: rows.map(serializeUser),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}

/* =========================
   PATCH /api/admin/users/:id/role
   ======================== */
export async function updateUserRole(req: Request, res: Response) {
  const id = routeId(req);
  if (!isValidObjectId(id)) {
    res.status(400).json({ success: false, message: "Invalid user ID." });
    return;
  }

  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    res.status(400).json({ success: false, message: "Request body must be a JSON object." });
    return;
  }

  const role = readRole((req.body as Record<string, unknown>).role);
  if (!role) {
    res.status(400).json({ success: false, message: `role must be one of: ${USER_ROLES.join(", ")}.` });
    return;
  }

  // verifyAdmin already guarantees a user, but keep the check for safety.
  if (!req.user) {
    res.status(401).json({ success: false, message: "You must be logged in." });
    return;
  }

  const targetId = new ObjectId(id);
  const users = userCollection();
  const target = await users.findOne({ _id: targetId });
  if (!target) {
    res.status(404).json({ success: false, message: "User not found." });
    return;
  }

  // An admin must not demote themselves, otherwise they lock themselves out.
  if (targetId.toHexString() === req.user.id || (!!req.user.email && target.email === req.user.email)) {
    res.status(409).json({ success: false, message: "You cannot change your own role." });
    return;
  }

  const currentRole = readRole(target.role) ?? "customer";
  if (currentRole === role) {
    res.json({ success: true, data: serializeUser(target) });
    return;
  }

  // Never leave the platform without an administrator.
  if (currentRole === "admin") {
    const admins = await users.countDocuments({ role: "admin" });
    if (admins <= 1) {
      res.status(409).json({ success: false, message: "At least one admin account is required." });
      return;
    }
  }

  const updated = await users.findOneAndUpdate(
    { _id: targetId },
    { $set: { role, updatedAt: new Date() } },
    { returnDocument: "after" }
  );
  if (!updated) {
    res.status(404).json({ success: false, message: "User not found." });
    return;
  }

  res.json({ success: true, data: serializeUser(updated) });
}
