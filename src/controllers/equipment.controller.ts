import type { Request, Response } from "express";
import { ObjectId, type Filter } from "mongodb";
import {
  EQUIPMENT_CATEGORIES,
  EQUIPMENT_STATUSES,
  RENTAL_TYPES,
  equipmentCollection,
  type Equipment,
  type EquipmentStatus,
} from "../models/equipment.js";
import {
  escapeRegex,
  isValidObjectId,
  validateEquipmentInput,
  validateEquipmentUpdate,
} from "../utils/validation.js";

// Reads a query parameter as a trimmed string (ignores arrays/objects)
function queryText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

// Reads the ":id" route parameter (Express 5 types it as string | string[])
function routeId(req: Request): string {
  return typeof req.params.id === "string" ? req.params.id : "";
}

/* =========================
   GET /api/equipment
   ======================== */
export async function listEquipment(req: Request, res: Response) {
  const search = queryText(req.query.search);
  const category = queryText(req.query.category);
  const rentalType = queryText(req.query.rentalType);
  const available = queryText(req.query.available);
  const sortParam = queryText(req.query.sort) || "newest";
  const pageParam = queryText(req.query.page);
  const limitParam = queryText(req.query.limit);
  const minPriceParam = queryText(req.query.minPrice);
  const maxPriceParam = queryText(req.query.maxPrice);

  // Validate page and limit
  const page = pageParam ? Number(pageParam) : 1;
  if (!Number.isInteger(page) || page < 1) {
    res.status(400).json({ success: false, message: "page must be a whole number of 1 or more." });
    return;
  }

  const limit = limitParam ? Number(limitParam) : 9;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    res.status(400).json({ success: false, message: "limit must be a whole number between 1 and 50." });
    return;
  }

  // Validate price range
  const minPrice = minPriceParam ? Number(minPriceParam) : null;
  const maxPrice = maxPriceParam ? Number(maxPriceParam) : null;

  if (minPrice !== null && (!Number.isFinite(minPrice) || minPrice < 0)) {
    res.status(400).json({ success: false, message: "minPrice must be a number of 0 or more." });
    return;
  }
  if (maxPrice !== null && (!Number.isFinite(maxPrice) || maxPrice < 0)) {
    res.status(400).json({ success: false, message: "maxPrice must be a number of 0 or more." });
    return;
  }
  if (minPrice !== null && maxPrice !== null && minPrice > maxPrice) {
    res.status(400).json({ success: false, message: "minPrice cannot be greater than maxPrice." });
    return;
  }

  // Validate filters against the allowed values
  if (category && !EQUIPMENT_CATEGORIES.includes(category as Equipment["category"])) {
    res.status(400).json({
      success: false,
      message: `category must be one of: ${EQUIPMENT_CATEGORIES.join(", ")}.`,
    });
    return;
  }
  if (rentalType && !RENTAL_TYPES.includes(rentalType as Equipment["rentalType"])) {
    res.status(400).json({
      success: false,
      message: `rentalType must be one of: ${RENTAL_TYPES.join(", ")}.`,
    });
    return;
  }
  if (available && available !== "true" && available !== "false") {
    res.status(400).json({ success: false, message: "available must be true or false." });
    return;
  }

  // Build the MongoDB filter (public list only shows approved equipment)
  const filter: Filter<Equipment> = { status: "approved" };

  if (search) {
    // escapeRegex prevents user input from breaking or injecting regex
    const safeSearch = escapeRegex(search);
    filter.$or = [
      { name: { $regex: safeSearch, $options: "i" } },
      { location: { $regex: safeSearch, $options: "i" } },
    ];
  }

  if (category) {
    filter.category = category as Equipment["category"];
  }
  if (rentalType) {
    filter.rentalType = rentalType as Equipment["rentalType"];
  }
  if (available === "true") {
    filter.availableQuantity = { $gt: 0 };
  }
  if (available === "false") {
    filter.availableQuantity = 0;
  }
  if (minPrice !== null || maxPrice !== null) {
    const priceFilter: { $gte?: number; $lte?: number } = {};
    if (minPrice !== null) priceFilter.$gte = minPrice;
    if (maxPrice !== null) priceFilter.$lte = maxPrice;
    filter.price = priceFilter;
  }

  // Sorting options
  const sortOptions = {
    price_asc: { price: 1 },
    price_desc: { price: -1 },
    newest: { createdAt: -1 },
  } as const;

  const sort = sortOptions[sortParam as keyof typeof sortOptions];
  if (!sort) {
    res.status(400).json({
      success: false,
      message: "sort must be one of: price_asc, price_desc, newest.",
    });
    return;
  }

  const collection = equipmentCollection();
  const [items, total] = await Promise.all([
    collection
      .find(filter)
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(limit)
      .toArray(),
    collection.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: items,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}

/* =========================
   GET /api/equipment/featured
   ======================== */
export async function featuredEquipment(_req: Request, res: Response) {
  const data = await equipmentCollection()
    .find({ status: "approved" })
    .sort({ createdAt: -1 })
    .limit(6)
    .toArray();

  res.json({ success: true, data });
}

/* =========================
   GET /api/equipment/categories
   ======================== */
export async function equipmentCategories(_req: Request, res: Response) {
  const counts = await equipmentCollection()
    .aggregate<{ _id: string; count: number }>([
      { $match: { status: "approved" } },
      { $group: { _id: "$category", count: { $sum: 1 } } },
    ])
    .toArray();

  // Always return all six assignment categories (count 0 when empty)
  const data = EQUIPMENT_CATEGORIES.map((category) => ({
    category,
    count: counts.find((item) => item._id === category)?.count ?? 0,
  }));

  res.json({ success: true, data });
}

/* =========================
   GET /api/equipment/:id
   ======================== */
export async function equipmentDetails(req: Request, res: Response) {
  const id = routeId(req);

  if (!id || !isValidObjectId(id)) {
    res.status(400).json({ success: false, message: "Invalid equipment id." });
    return;
  }

  const equipment = await equipmentCollection().findOne({ _id: new ObjectId(id) });

  if (!equipment) {
    res.status(404).json({ success: false, message: "Equipment not found." });
    return;
  }

  // Pending/rejected equipment is only visible to its owner or an admin.
  // Return 404 (not 403) so its existence is not revealed to others.
  const user = req.user;
  const canSeeUnapproved =
    user !== undefined && (user.role === "admin" || user.id === equipment.ownerId);

  if (equipment.status !== "approved" && !canSeeUnapproved) {
    res.status(404).json({ success: false, message: "Equipment not found." });
    return;
  }

  res.json({ success: true, data: equipment });
}

/* =========================
   POST /api/equipment
   ======================== */
export async function createEquipment(req: Request, res: Response) {
  const user = req.user;

  if (!user) {
    res.status(401).json({ success: false, message: "You must be logged in." });
    return;
  }

  const result = validateEquipmentInput(req.body);

  if (!result.valid) {
    res.status(400).json({ success: false, message: result.message });
    return;
  }

  const now = new Date();

  // Owner info and status always come from the server, never the body
  const equipment: Equipment = {
    _id: new ObjectId(),
    ...result.data,
    status: "pending",
    ownerId: user.id,
    ownerName: user.name,
    ownerEmail: user.email,
    createdAt: now,
    updatedAt: now,
  };

  await equipmentCollection().insertOne(equipment);

  res.status(201).json({ success: true, data: equipment });
}

/* =========================
   GET /api/equipment/owner/mine
   ======================== */
export async function myEquipment(req: Request, res: Response) {
  const user = req.user;

  if (!user) {
    res.status(401).json({ success: false, message: "You must be logged in." });
    return;
  }

  const data = await equipmentCollection()
    .find({ ownerId: user.id })
    .sort({ createdAt: -1 })
    .toArray();

  res.json({ success: true, data });
}

/* =========================
   PATCH /api/equipment/:id
   ======================== */
export async function updateEquipment(req: Request, res: Response) {
  const user = req.user;

  if (!user) {
    res.status(401).json({ success: false, message: "You must be logged in." });
    return;
  }

  const id = routeId(req);

  if (!id || !isValidObjectId(id)) {
    res.status(400).json({ success: false, message: "Invalid equipment id." });
    return;
  }

  const collection = equipmentCollection();
  const existing = await collection.findOne({ _id: new ObjectId(id) });

  if (!existing) {
    res.status(404).json({ success: false, message: "Equipment not found." });
    return;
  }

  // Owners may only edit their own equipment; admins may edit any
  if (user.role !== "admin" && existing.ownerId !== user.id) {
    res.status(403).json({
      success: false,
      message: "You can only update your own equipment.",
    });
    return;
  }

  const result = validateEquipmentUpdate(req.body, existing);

  if (!result.valid) {
    res.status(400).json({ success: false, message: result.message });
    return;
  }

  // Only editable fields are written; status, owner and createdAt stay as-is
  const updatedAt = new Date();
  await collection.updateOne(
    { _id: existing._id },
    { $set: { ...result.data, updatedAt } }
  );

  const updated = await collection.findOne({ _id: existing._id });

  res.json({ success: true, data: updated });
}

/* =========================
   DELETE /api/equipment/:id
   ======================== */
export async function deleteEquipment(req: Request, res: Response) {
  const user = req.user;

  if (!user) {
    res.status(401).json({ success: false, message: "You must be logged in." });
    return;
  }

  const id = routeId(req);

  if (!id || !isValidObjectId(id)) {
    res.status(400).json({ success: false, message: "Invalid equipment id." });
    return;
  }

  const collection = equipmentCollection();
  const existing = await collection.findOne({ _id: new ObjectId(id) });

  if (!existing) {
    res.status(404).json({ success: false, message: "Equipment not found." });
    return;
  }

  // Owners may only delete their own equipment; admins may delete any
  if (user.role !== "admin" && existing.ownerId !== user.id) {
    res.status(403).json({
      success: false,
      message: "You can only delete your own equipment.",
    });
    return;
  }

  await collection.deleteOne({ _id: existing._id });

  res.json({ success: true, message: "Equipment deleted." });
}

/* =========================
   GET /api/equipment/admin/all
   ======================== */
export async function allEquipmentAdmin(req: Request, res: Response) {
  const status = queryText(req.query.status);

  if (status && !EQUIPMENT_STATUSES.includes(status as EquipmentStatus)) {
    res.status(400).json({
      success: false,
      message: `status must be one of: ${EQUIPMENT_STATUSES.join(", ")}.`,
    });
    return;
  }

  // No status filter returns every item, whatever its status
  const filter: Filter<Equipment> = status
    ? { status: status as EquipmentStatus }
    : {};

  const data = await equipmentCollection()
    .find(filter)
    .sort({ createdAt: -1 })
    .toArray();

  res.json({ success: true, data });
}

/* =========================
   PATCH /api/equipment/:id/status
   ======================== */
export async function updateEquipmentStatus(req: Request, res: Response) {
  const id = routeId(req);

  if (!id || !isValidObjectId(id)) {
    res.status(400).json({ success: false, message: "Invalid equipment id." });
    return;
  }

  const body = req.body as Record<string, unknown> | undefined;
  const status = typeof body?.status === "string" ? body.status.trim() : "";

  // An admin can only approve or reject; "pending" is only set on create
  if (status !== "approved" && status !== "rejected") {
    res.status(400).json({
      success: false,
      message: "status must be either approved or rejected.",
    });
    return;
  }

  const collection = equipmentCollection();
  const existing = await collection.findOne({ _id: new ObjectId(id) });

  if (!existing) {
    res.status(404).json({ success: false, message: "Equipment not found." });
    return;
  }

  await collection.updateOne(
    { _id: existing._id },
    { $set: { status, updatedAt: new Date() } }
  );

  const updated = await collection.findOne({ _id: existing._id });

  res.json({ success: true, data: updated });
}
