import { Router } from "express";
import { verifyToken } from "../middlewares/auth.js";
import {
  equipmentCategories,
  equipmentDetails,
  featuredEquipment,
  listEquipment,
} from "../controllers/equipment.controller.js";

const router = Router();

/* =========================
   EQUIPMENT — PUBLIC + AUTHENTICATED
   (specific routes must come before "/:id")
   ======================== */

// GET /api/equipment
// Description: List approved equipment with search, filters, sorting and pagination
// Access: Public
// Query: search, category, rentalType, minPrice, maxPrice, available, sort, page, limit
router.get("/", listEquipment);

// GET /api/equipment/featured
// Description: Get the 6 newest approved equipment items
// Access: Public
router.get("/featured", featuredEquipment);

// GET /api/equipment/categories
// Description: Get all assignment categories with counts of approved equipment
// Access: Public
router.get("/categories", equipmentCategories);

// GET /api/equipment/:id
// Description: Get a single equipment item (approved items for everyone;
//              pending/rejected only for its owner or an admin)
// Access: Authenticated (JWT required)
// Params: id (MongoDB ObjectId)
router.get("/:id", verifyToken, equipmentDetails);

export default router;
