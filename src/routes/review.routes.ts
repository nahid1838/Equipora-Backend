import { Router } from "express";
import { listPublicReviews, submitReview } from "../controllers/review.controller.js";
import { verifyRenter, verifyToken } from "../middlewares/auth.js";

const router = Router();
router.get("/", listPublicReviews);
router.post("/", verifyToken, verifyRenter, submitReview);
export default router;
