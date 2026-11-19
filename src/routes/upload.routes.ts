import { Router } from "express";
import { verifyOwnerOrAdmin, verifyToken } from "../middlewares/auth.js";
import { uploadImage } from "../controllers/upload.controller.js";

const router = Router();

/* =========================
   UPLOADS
   ======================== */

// POST /api/uploads/image
// Description: Upload a base64-encoded image to ImgBB and return its URL
// Access: Owner or Admin
// Body: { "image": "data:image/png;base64,..." } (max 3 MB, PNG/JPEG/GIF/WebP)
router.post("/image", verifyToken, verifyOwnerOrAdmin, uploadImage);

export default router;
