import type { Request, Response } from "express";
import { ObjectId, type Filter } from "mongodb";
import {
  EQUIPMENT_CATEGORIES,
  RENTAL_TYPES,
  equipmentCollection,
  type Equipment,
} from "../models/equipment.js";
import { escapeRegex, isValidObjectId } from "../utils/validation.js";

// Reads a query parameter as a trimmed string (ignores arrays/objects)
function queryText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
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
  // Express 5 can type route params as string | string[]
  const id = typeof req.params.id === "string" ? req.params.id : "";

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
