import type { ErrorRequestHandler, RequestHandler } from "express";

// Any error that carries an HTTP status code (e.g. thrown by a future
// validation/stripe helper) can set `status` or `statusCode`
type HttpError = Error & {
  status?: number;
  statusCode?: number;
};

// Runs when no route matched the request
export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
};

// Runs whenever any route throws an error.
// Express recognises error middleware by its four parameters.
export const errorHandler: ErrorRequestHandler = (error: HttpError, _req, res, next) => {
  // If a response already started, let Express close it properly
  if (res.headersSent) {
    next(error);
    return;
  }

  const status = error.status ?? error.statusCode ?? 500;

  // Log the full error on the server, never expose internals to the client
  console.error(`[${status}]`, error.message);

  res.status(status).json({
    success: false,
    // 4xx messages are safe to show; 5xx details stay in the server log
    message:
      status >= 500 ? "Something went wrong on the server." : error.message,
  });
};
