import { MongoClient, type Db } from "mongodb";
import { env, DB_NAME } from "./env.js";

// A single shared MongoClient for the whole app.
// Reusing one client (instead of creating one per request) is the recommended way.
const client = new MongoClient(env.mongoUri);

let db: Db | null = null;

// Connects to MongoDB once and returns the database handle.
// Called from the server entry file at startup.
export async function connectDB(): Promise<Db> {
  // If we are already connected, reuse the same connection
  if (db) {
    return db;
  }

  try {
    await client.connect();
    db = client.db(DB_NAME);

    // "ping" proves the connection really works
    await db.command({ ping: 1 });
    console.log(`MongoDB connected (database: ${DB_NAME})`);

    return db;
  } catch (error) {
    console.error("MongoDB connection failed. Check MONGODB_URI in .env");
    throw error;
  }
}

// Returns the database handle for models/controllers.
// Throws a clear error if it is used before connecting.
export function getDB(): Db {
  if (!db) {
    throw new Error("Database is not connected. Call connectDB() first.");
  }
  return db;
}

// Closes the connection (used by tests/scripts or on shutdown)
export async function closeDB(): Promise<void> {
  await client.close();
  db = null;
}
