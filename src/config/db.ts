import { MongoClient, type Db } from "mongodb";
import { env, DB_NAME } from "./env.js";

// A single shared MongoClient for the whole app.
// Reusing one client (instead of creating one per request) is the recommended way.
const client = new MongoClient(env.mongoUri);

let db: Db | null = null;
let connection: Promise<Db> | undefined;

// Connects to MongoDB once and returns the database handle.
// Concurrent requests on a cold instance share the same connection attempt.
export function connectDB(): Promise<Db> {
  connection ??= client.connect().then(async () => {
    const database = client.db(DB_NAME);
    await database.command({ ping: 1 });
    db = database;
    return database;
  }).catch((error: unknown) => {
    connection = undefined;
    throw error;
  });
  return connection;
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
  connection = undefined;
}
