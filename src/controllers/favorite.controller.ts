import type { Request, Response } from "express";
import { MongoServerError, ObjectId } from "mongodb";
import { equipmentCollection, type Equipment } from "../models/equipment.js";
import { favoriteCollection } from "../models/favorite.js";
import { isValidObjectId } from "../utils/validation.js";

type FavoriteEquipment = Pick<Equipment,
  "_id" | "name" | "category" | "location" | "price" | "rentalType" | "availableQuantity" | "imageUrl"
>;

export async function listFavorites(req: Request, res: Response) {
  if (!req.user) {
    res.status(401).json({ success: false, message: "You must be logged in." });
    return;
  }

  const data = await favoriteCollection().aggregate<FavoriteEquipment>([
    { $match: { userId: req.user.id } },
    { $sort: { createdAt: -1, _id: -1 } },
    {
      $lookup: {
        from: equipmentCollection().collectionName,
        localField: "equipmentId",
        foreignField: "_id",
        pipeline: [
          { $match: { status: "approved" } },
          { $project: { _id: 1, name: 1, category: 1, location: 1, price: 1, rentalType: 1, availableQuantity: 1, imageUrl: 1 } },
        ],
        as: "equipment",
      },
    },
    { $unwind: "$equipment" },
    { $replaceWith: "$equipment" },
  ]).toArray();

  res.json({ success: true, data });
}

export async function addFavorite(req: Request, res: Response) {
  if (!req.user) {
    res.status(401).json({ success: false, message: "You must be logged in." });
    return;
  }
  const body = req.body as { equipmentId?: unknown } | undefined;
  const id = body?.equipmentId;
  if (typeof id !== "string" || !isValidObjectId(id)) {
    res.status(400).json({ success: false, message: "Invalid equipment ID." });
    return;
  }

  const equipmentId = new ObjectId(id);
  const equipment = await equipmentCollection().findOne(
    { _id: equipmentId, status: "approved" },
    { projection: { _id: 1 } }
  );
  if (!equipment) {
    res.status(404).json({ success: false, message: "Equipment not found." });
    return;
  }

  const favorite = { userId: req.user.id, equipmentId };
  try {
    await favoriteCollection().updateOne(favorite, { $setOnInsert: { createdAt: new Date() } }, { upsert: true });
  } catch (error) {
    // A concurrent add may win the upsert. The unique index still leaves one favorite.
    if (!(error instanceof MongoServerError && error.code === 11000)) throw error;
  }

  res.json({ success: true, message: "Equipment saved to favorites." });
}

export async function removeFavorite(req: Request, res: Response) {
  if (!req.user) {
    res.status(401).json({ success: false, message: "You must be logged in." });
    return;
  }
  const id = req.params.equipmentId;
  if (typeof id !== "string" || !isValidObjectId(id)) {
    res.status(400).json({ success: false, message: "Invalid equipment ID." });
    return;
  }

  const result = await favoriteCollection().deleteOne({ userId: req.user.id, equipmentId: new ObjectId(id) });
  if (!result.deletedCount) {
    res.status(404).json({ success: false, message: "Favorite not found." });
    return;
  }

  res.json({ success: true, message: "Equipment removed from favorites." });
}
