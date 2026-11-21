import { Router } from "express";
import { listUsers, updateUserRole } from "../controllers/user.controller.js";
import { listApplications, reviewApplication } from "../controllers/owner-application.controller.js";
import { listPendingReviews, moderateReview } from "../controllers/review.controller.js";
import { verifyAdmin, verifyToken } from "../middlewares/auth.js";

const router = Router();

// Every admin route requires a valid token and the admin role.
router.use(verifyToken, verifyAdmin);

// GET /api/admin/users
// Description: List all users with optional search, role filter, and pagination
// Access: Admin
router.get("/users", listUsers);

// PATCH /api/admin/users/:id/role
// Description: Change a user's role (customer, owner, admin)
// Access: Admin
router.patch("/users/:id/role", updateUserRole);
router.get("/owner-applications", listApplications);
router.patch("/owner-applications/:id", reviewApplication);
router.get("/reviews", listPendingReviews);
router.patch("/reviews/:id", moderateReview);

export default router;
