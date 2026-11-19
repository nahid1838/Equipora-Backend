import express from "express";
import cors from "cors";
import { env } from "./config/env.js";
import { connectDB } from "./config/db.js";
import { errorHandler, notFoundHandler } from "./middlewares/errorHandler.js";
import { createEquipmentIndexes } from "./models/equipment.js";
import equipmentRoutes from "./routes/equipment.routes.js";
import uploadRoutes from "./routes/upload.routes.js";

const app = express();

// Allow requests from the Next.js client only
app.use(
  cors({
    origin: env.clientUrl,
    credentials: true,
  })
);

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
    await connectDB();

    // Creates the equipment indexes once; safe to call on every start
    await createEquipmentIndexes();

    app.listen(env.port, () => {
      console.log(`Equipora API running at http://localhost:${env.port}`);
    });
  } catch (error) {
    console.error("Failed to start the server:", error);
    process.exit(1);
  }
}

startServer();
