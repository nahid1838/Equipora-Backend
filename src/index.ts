import express from "express";
import cors from "cors";
import { env } from "./config/env.js";
import { connectDB } from "./config/db.js";
import { errorHandler, notFoundHandler } from "./middlewares/errorHandler.js";
import { createEquipmentIndexes } from "./models/equipment.js";
import { createFavoriteIndexes } from "./models/favorite.js";
import equipmentRoutes from "./routes/equipment.routes.js";
import favoriteRoutes from "./routes/favorite.routes.js";
import uploadRoutes from "./routes/upload.routes.js";
import bookingRoutes from "./routes/booking.routes.js";
import adminRoutes from "./routes/admin.routes.js";
import analyticsRoutes from "./routes/analytics.routes.js";
import ownerApplicationRoutes from "./routes/owner-application.routes.js";
import { createOwnerApplicationIndexes } from "./models/owner-application.js";
import { createBookingIndexes } from "./models/booking.js";
import { stripeWebhook } from "./controllers/stripe-webhook.controller.js";

const app = express();

// Allow requests from the Next.js client only
app.use(
  cors({
    origin: env.clientUrl,
    credentials: true,
  })
);

let databaseReady: Promise<void> | undefined;

function initializeDatabase(): Promise<void> {
  databaseReady ??= (async () => {
    await connectDB();
    await Promise.all([
      createEquipmentIndexes(),
      createFavoriteIndexes(),
      createBookingIndexes(),
      createOwnerApplicationIndexes(),
    ]);
  })().catch((error: unknown) => {
    databaseReady = undefined;
    throw error;
  });
  return databaseReady;
}

app.use("/api", async (_req, _res, next) => {
  await initializeDatabase();
  next();
});

// Stripe verifies the original bytes, so this route must precede JSON parsing.
app.post("/api/payments/webhook", express.raw({ type: "application/json" }), stripeWebhook);

// Parse JSON request bodies. The 5 MB limit allows base64 image uploads
// (the decoded image itself is capped at 3 MB in the upload controller).
app.use(express.json({ limit: "5mb" }));

// Don't advertise the framework in response headers
app.disable("x-powered-by");

/* =========================
   HEALTH
   ======================== */

// GET /api/health
// Description: Check that the API server is running
// Access: Public
app.get("/api/health", (_req, res) => {
  res.json({
    success: true,
    message: "Equipora API is running",
  });
});

/* =========================
   EQUIPMENT
   ======================== */

// Every route in this router is documented in API_DOCUMENTATION.md
app.use("/api/equipment", equipmentRoutes);
app.use("/api/favorites", favoriteRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/owner-applications", ownerApplicationRoutes);

/* =========================
   ADMIN
   ======================== */

// User administration (documented in API_DOCUMENTATION.md)
app.use("/api/admin", adminRoutes);

/* =========================
   ANALYTICS
   ======================== */

// Dashboard totals and monthly series (documented in API_DOCUMENTATION.md)
app.use("/api/analytics", analyticsRoutes);

/* =========================
   UPLOADS
   ======================== */

// Image upload route (documented in API_DOCUMENTATION.md)
app.use("/api/uploads", uploadRoutes);

// 404 for unknown routes (must come after all routes)
app.use(notFoundHandler);

// Global error handler (must be the last middleware)
app.use(errorHandler);

// Connects to MongoDB first, then starts listening
async function startServer() {
  try {
    await initializeDatabase();

    app.listen(env.port, () => {
      console.log(`Equipora API running at http://localhost:${env.port}`);
    });
  } catch (error) {
    console.error("Failed to start the server:", error);
    process.exit(1);
  }
}

if (import.meta.main && process.env.VERCEL !== "1") void startServer();

export default app;
