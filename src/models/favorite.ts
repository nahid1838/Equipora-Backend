import type { ObjectId } from "mongodb";
import { getDB } from "../config/db.js";

type Favorite = {
  userId: string;
  equipmentId: ObjectId;
  createdAt: Date;
};

export function favoriteCollection() {
  return getDB().collection<Favorite>("favorites");
}

export async function createFavoriteIndexes(): Promise<void> {
  await favoriteCollection().createIndex({ userId: 1, equipmentId: 1 }, { unique: true });
}
