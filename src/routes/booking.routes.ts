import { Router } from "express";
import { checkoutStatus, confirmCheckout, listBookings, quoteBooking, startBookingCheckout } from "../controllers/booking.controller.js";
import { verifyAdmin, verifyOwner, verifyRenter, verifyToken } from "../middlewares/auth.js";

const router = Router();
router.use(verifyToken);
router.post("/quote", verifyRenter, quoteBooking);
router.post("/checkout", verifyRenter, startBookingCheckout);
router.get("/checkout/:id", verifyRenter, checkoutStatus);
router.post("/checkout/:id/confirm", verifyRenter, confirmCheckout);
router.get("/my", verifyRenter, listBookings);
router.get("/owner", verifyOwner, listBookings);
router.get("/", verifyAdmin, listBookings);
export default router;
