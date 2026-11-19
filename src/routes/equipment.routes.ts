import { Router } from "express";
import {
  verifyAdmin,
  verifyOwner,
  verifyOwnerOrAdmin,
  verifyToken,
} from "../middlewares/auth.js";
import {
  allEquipmentAdmin,
  createEquipment,
  deleteEquipment,
  equipmentCategories,
  equipmentDetails,
  featuredEquipment,
  listEquipment,
  myEquipment,
  updateEquipment,
  updateEquipmentStatus,
} from "../controllers/equipment.controller.js";

const router = Router();

/* =========================
   EQUIPMENT — PUBLIC
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

/* =========================
   EQUIPMENT — OWNER
   (specific routes must come before "/:id")
   ======================== */

// POST /api/equipment
// Description: Create new equipment. Status is always "pending" and owner
//              details are taken from the verified JWT
// Access: Owner
// Body: name, description, category, location, price, rentalType,
//       availableQuantity, condition, imageUrl, terms, brand?, model?
router.post("/", verifyToken, verifyOwner, createEquipment);

// GET /api/equipment/owner/mine
// Description: Get all equipment owned by the logged-in owner (any status)
// Access: Owner
router.get("/owner/mine", verifyToken, verifyOwner, myEquipment);

// PATCH /api/equipment/:id
// Description: Partially update equipment. Owners can update only their own
//              items; admins can update any item. Status and owner fields
//              cannot be changed here
// Access: Owner or Admin
// Params: id (MongoDB ObjectId)
// Body: any editable field (same fields as create)
router.patch("/:id", verifyToken, verifyOwnerOrAdmin, updateEquipment);

// DELETE /api/equipment/:id
// Description: Delete equipment. Owners can delete only their own items;
//              admins can delete any item
// Access: Owner or Admin
// Params: id (MongoDB ObjectId)
router.delete("/:id", verifyToken, verifyOwnerOrAdmin, deleteEquipment);

/* =========================
   EQUIPMENT — ADMIN
   (specific routes must come before "/:id")
   ======================== */

// GET /api/equipment/admin/all
// Description: List all equipment of every status (for the admin dashboard)
// Access: Admin
// Query: status? (pending | approved | rejected)
router.get("/admin/all", verifyToken, verifyAdmin, allEquipmentAdmin);

// PATCH /api/equipment/:id/status
// Description: Approve or reject an equipment item
// Access: Admin
// Params: id (MongoDB ObjectId)
// Body: { "status": "approved" | "rejected" }
router.patch(
  "/:id/status",
  verifyToken,
  verifyAdmin,
  updateEquipmentStatus
);

/* =========================
   EQUIPMENT — AUTHENTICATED
   ======================== */

// GET /api/equipment/:id
// Description: Get a single equipment item (approved items for everyone;
//              pending/rejected only for its owner or an admin)
// Access: Authenticated (JWT required)
// Params: id (MongoDB ObjectId)
router.get("/:id", verifyToken, equipmentDetails);

export default router;
