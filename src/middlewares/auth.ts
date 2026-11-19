import type { NextFunction, Request, RequestHandler, Response } from "express";
import { verifyJwt, type AuthUser } from "../utils/jwt.js";

// Adds req.user to Express requests (set by verifyToken)
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

// Reads "Bearer <token>" from the Authorization header
function getBearerToken(req: Request): string | null {
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    return null;
  }

  return header.slice("Bearer ".length).trim() || null;
}

// Verifies the JWT and attaches the user to the request.
// Use on any route that requires a logged-in user.
export const verifyToken = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const token = getBearerToken(req);

  if (!token) {
    res.status(401).json({
      success: false,
      message: "Access token is required.",
    });
    return;
  }

  try {
    req.user = await verifyJwt(token);
    next();
  } catch {
    res.status(401).json({
      success: false,
      message: "Invalid or expired access token.",
    });
  }
};

// Small helper: checks req.user.role against the allowed role(s)
function requireRole(...roles: string[]): RequestHandler {
  return (req, res, next) => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: "You must be logged in.",
      });
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({
        success: false,
        message: "You do not have permission to access this resource.",
      });
      return;
    }

    next();
  };
}

// Customer-only routes
export const verifyRenter = requireRole("customer");

// Owner-only routes
export const verifyOwner = requireRole("owner");

// Admin-only routes
export const verifyAdmin = requireRole("admin");
