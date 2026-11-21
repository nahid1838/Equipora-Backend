import { Router } from "express";
import { getMyApplication, submitApplication } from "../controllers/owner-application.controller.js";
import { verifyRenter, verifyToken } from "../middlewares/auth.js";

const router = Router();
router.use(verifyToken);
router.get("/me", getMyApplication);
router.post("/", verifyRenter, submitApplication);

export default router;
