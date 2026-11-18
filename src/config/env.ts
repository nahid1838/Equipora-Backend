import "dotenv/config";

// Reads a required environment variable and fails fast with a clear message
// if it is missing, instead of crashing somewhere unexpected later.
function required(key: string): string {
  const value = process.env[key]?.trim();

  if (!value) {
    throw new Error(
      `Missing environment variable "${key}". ` +
        `Add it to your .env file (see .env.example for the required variables).`
    );
  }

  return value;
}

// Central, typed configuration object.
// Every other file imports this instead of using process.env directly.
export const env = {
  port: Number(process.env.PORT) || 5000,
  mongoUri: required("MONGODB_URI"),
  betterAuthUrl: required("BETTER_AUTH_URL"),
  stripeSecretKey: required("STRIPE_SECRET_KEY"),
  // Webhooks are optional for now, so this key may be empty
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET?.trim() ?? "",
  clientUrl: required("CLIENT_URL"),
} as const;

// The database name must match the one used by the Next.js client
// (client: src/lib/auth.ts -> client.db("equiporadb"))
export const DB_NAME = "equiporadb";
