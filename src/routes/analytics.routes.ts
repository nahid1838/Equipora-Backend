import { Router } from "express";
import { adminAnalytics, ownerAnalytics } from "../controllers/analytics.controller.js";
import { verifyAdmin, verifyOwner, verifyToken } from "../middlewares/auth.js";

const router = Router();

router.use(verifyToken);

// GET /api/analytics/admin
// Description: Marketplace totals and the last six months of bookings/revenue
// Access: Admin
router.get("/admin", verifyAdmin, adminAnalytics);

// GET /api/analytics/owner
// Description: Equipment, completed rentals, earnings, and monthly earnings
// Access: Owner
router.get("/owner", verifyOwner, ownerAnalytics);

export default router;
