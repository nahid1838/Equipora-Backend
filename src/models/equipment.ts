import type { ObjectId } from "mongodb";
import { getDB } from "../config/db.js";

/* =========================
   ALLOWED VALUES
   ======================== */

// Assignment categories — must match the assignment requirements
export const EQUIPMENT_CATEGORIES = [
  "Construction",
  "Photography",
  "Vehicles & Transportation",
  "Agriculture",
  "Electronics",
  "Event",
] as const;

export const RENTAL_TYPES = ["daily", "weekly", "monthly"] as const;

export const EQUIPMENT_CONDITIONS = ["excellent", "good", "fair"] as const;

export const EQUIPMENT_STATUSES = ["pending", "approved", "rejected"] as const;

/* =========================
   TYPES
   ======================== */

export type EquipmentCategory = (typeof EQUIPMENT_CATEGORIES)[number];
export type RentalType = (typeof RENTAL_TYPES)[number];
export type EquipmentCondition = (typeof EQUIPMENT_CONDITIONS)[number];
export type EquipmentStatus = (typeof EQUIPMENT_STATUSES)[number];

// Fields the owner sends when creating/updating equipment.
// Server-controlled fields (status, owner info, dates) are NOT here.
export type EquipmentInput = {
  name: string;
  description: string;
  category: EquipmentCategory;
  location: string;
  price: number;
  rentalType: RentalType;
  availableQuantity: number;
  condition: EquipmentCondition;
  brand?: string;
  model?: string;
  imageUrl: string;
  terms: string;
};

// Full document as stored in the "equipments" collection
export type Equipment = EquipmentInput & {
  _id: ObjectId;
  status: EquipmentStatus;
  ownerId: string;
  ownerName: string;
  ownerEmail: string;
  createdAt: Date;
  updatedAt: Date;
};

/* =========================
   COLLECTION HELPERS
   ======================== */

export function equipmentCollection() {
  return getDB().collection<Equipment>("equipments");
}

// Simple indexes for the queries used by the equipment routes
export async function createEquipmentIndexes(): Promise<void> {
  const collection = equipmentCollection();
  await collection.createIndex({ status: 1, createdAt: -1 });
  await collection.createIndex({ ownerId: 1 });
}
