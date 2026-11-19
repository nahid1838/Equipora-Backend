import { createRemoteJWKSet, jwtVerify } from "jose";
import { env } from "../config/env.js";

// Better Auth public keys (JWKS). jose caches them in memory,
// so there is no network call on every request.
const JWKS = createRemoteJWKSet(
  new URL(`${env.betterAuthUrl.replace(/\/$/, "")}/api/auth/jwks`)
);

// The user data we trust after a token signature check
export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: string;
};

// Verifies a Better Auth JWT and returns its trusted payload.
// Throws if the signature, issuer, audience or expiry is invalid.
export async function verifyJwt(token: string): Promise<AuthUser> {
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: env.betterAuthUrl,
    audience: env.betterAuthUrl,
  });

  const id = typeof payload.id === "string" ? payload.id : payload.sub;

  if (!id) {
    throw new Error("Token is missing a user id");
  }

  return {
    id,
    email: typeof payload.email === "string" ? payload.email : "",
    name: typeof payload.name === "string" ? payload.name : "",
    // Users created before the role field existed default to customer
    role: typeof payload.role === "string" ? payload.role : "customer",
  };
}
