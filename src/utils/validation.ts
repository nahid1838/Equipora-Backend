import { ObjectId } from "mongodb";
import {
  EQUIPMENT_CATEGORIES,
  EQUIPMENT_CONDITIONS,
  RENTAL_TYPES,
  type EquipmentCategory,
  type EquipmentCondition,
  type EquipmentInput,
  type RentalType,
} from "../models/equipment.js";

// Escapes special regex characters in user input before using it in
// a MongoDB $regex filter. This prevents regex injection and broken queries.
export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Safely checks a string id from the URL before querying MongoDB
export function isValidObjectId(id: string): boolean {
  return ObjectId.isValid(id);
}

// Trims a text field; returns "" for non-string values
function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

// Converts a number-like field (number or numeric string) to a number
function toNumber(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }
  return Number(value);
}

type ValidationResult =
  | { valid: true; data: EquipmentInput }
  | { valid: false; message: string };

// Validates and cleans the equipment body sent by the client.
// Returns cleaned data or a readable error message.
export function validateEquipmentInput(body: unknown): ValidationResult {
  if (typeof body !== "object" || body === null) {
    return { valid: false, message: "Request body must be a JSON object." };
  }

  const input = body as Record<string, unknown>;

  const name = cleanText(input.name);
  if (!name) {
    return { valid: false, message: "Equipment name is required." };
  }

  const description = cleanText(input.description);
  if (!description) {
    return { valid: false, message: "Description is required." };
  }

  const category = cleanText(input.category);
  if (!EQUIPMENT_CATEGORIES.includes(category as EquipmentCategory)) {
    return {
      valid: false,
      message: `Category must be one of: ${EQUIPMENT_CATEGORIES.join(", ")}.`,
    };
  }

  const location = cleanText(input.location);
  if (!location) {
    return { valid: false, message: "Location is required." };
  }

  const price = toNumber(input.price);
  if (!Number.isFinite(price) || price <= 0) {
    return { valid: false, message: "Price must be a number greater than 0." };
  }

  const rentalType = cleanText(input.rentalType);
  if (!RENTAL_TYPES.includes(rentalType as RentalType)) {
    return {
      valid: false,
      message: `Rental type must be one of: ${RENTAL_TYPES.join(", ")}.`,
    };
  }

  const availableQuantity = toNumber(input.availableQuantity);
  if (!Number.isInteger(availableQuantity) || availableQuantity < 0) {
    return {
      valid: false,
      message: "Available quantity must be a whole number of 0 or more.",
    };
  }

  const condition = cleanText(input.condition);
  if (!EQUIPMENT_CONDITIONS.includes(condition as EquipmentCondition)) {
    return {
      valid: false,
      message: `Condition must be one of: ${EQUIPMENT_CONDITIONS.join(", ")}.`,
    };
  }

  const imageUrl = cleanText(input.imageUrl);
  if (!imageUrl.startsWith("http")) {
    return { valid: false, message: "A valid image URL is required." };
  }

  const terms = cleanText(input.terms);
  if (!terms) {
    return { valid: false, message: "Rental terms are required." };
  }

  const data: EquipmentInput = {
    name,
    description,
    category: category as EquipmentCategory,
    location,
    price,
    rentalType: rentalType as RentalType,
    availableQuantity,
    condition: condition as EquipmentCondition,
    imageUrl,
    terms,
  };

  // Optional fields are only added when provided
  const brand = cleanText(input.brand);
  if (brand) {
    data.brand = brand;
  }

  const model = cleanText(input.model);
  if (model) {
    data.model = model;
  }

  return { valid: true, data };
}
