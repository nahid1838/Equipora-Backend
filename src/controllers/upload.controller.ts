import type { Request, Response } from "express";
import { env } from "../config/env.js";

// 3 MB limit on the decoded image (not the base64 string)
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

const ALLOWED_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
];

// Matches data URLs like: data:image/png;base64,iVBORw0KG...
const DATA_URL_PATTERN =
  /^data:([a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/;

type ImageType = "png" | "jpeg" | "gif" | "webp";

// Reads the first bytes of the file to confirm it really is an image.
// This is what stops a renamed text/zip file from being uploaded.
function detectImageType(buffer: Buffer): ImageType | null {
  const startsWith = (bytes: number[], offset = 0) =>
    buffer.length >= offset + bytes.length &&
    bytes.every((byte, index) => buffer[offset + index] === byte);

  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "png";
  }
  if (startsWith([0xff, 0xd8, 0xff])) {
    return "jpeg";
  }
  if (buffer.toString("ascii", 0, 4) === "GIF8") {
    return "gif";
  }
  if (
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "webp";
  }

  return null;
}

type ImgbbResult = {
  success?: boolean;
  data?: {
    url?: string;
  };
};

// Sends the base64 image to ImgBB and returns its public URL.
// Returns null on any failure so the controller can respond with a
// generic message (the API key and ImgBB details never reach the client).
async function uploadToImgbb(base64: string): Promise<string | null> {
  // ImgBB's documented format: POST multipart/form-data with an "image" field
  const form = new FormData();
  form.append("image", base64);

  try {
    const response = await fetch(
      `https://api.imgbb.com/1/upload?key=${env.imgbbApiKey}`,
      {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(20_000),
      }
    );

    const payload = (await response.json()) as ImgbbResult;
    const url = payload.data?.url;

    if (!response.ok || payload.success !== true || !url) {
      console.error("[imgbb] upload failed with status", response.status);
      return null;
    }

    return url;
  } catch {
    console.error("[imgbb] upload request failed");
    return null;
  }
}

/* =========================
   POST /api/uploads/image
   ======================== */
export async function uploadImage(req: Request, res: Response) {
  const body = req.body as Record<string, unknown> | undefined;
  const image = typeof body?.image === "string" ? body.image.trim() : "";

  if (!image) {
    res.status(400).json({
      success: false,
      message: "image is required as a base64 data URL.",
    });
    return;
  }

  const match = image.match(DATA_URL_PATTERN);

  if (!match || !match[1] || !match[2]) {
    res.status(400).json({
      success: false,
      message:
        "image must be a base64 data URL, for example data:image/png;base64,....",
    });
    return;
  }

  const mimeType = match[1].toLowerCase();
  const base64 = match[2];

  if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
    res.status(400).json({
      success: false,
      message: "Only PNG, JPEG, GIF and WebP images are allowed.",
    });
    return;
  }

  const buffer = Buffer.from(base64, "base64");

  // Buffer.from silently ignores bad characters, so compare the cleaned
  // base64 back to the input to reject malformed strings.
  const normalize = (value: string) => value.replace(/=+$/, "");
  if (
    buffer.length === 0 ||
    normalize(buffer.toString("base64")) !== normalize(base64)
  ) {
    res.status(400).json({
      success: false,
      message: "image is not valid base64 data.",
    });
    return;
  }

  if (buffer.length > MAX_IMAGE_BYTES) {
    res.status(400).json({
      success: false,
      message: "Image is too large. Maximum size is 3 MB.",
    });
    return;
  }

  const detected = detectImageType(buffer);
  const declared =
    mimeType === "image/jpg" ? "jpeg" : mimeType.replace("image/", "");

  if (!detected || detected !== declared) {
    res.status(400).json({
      success: false,
      message:
        "The uploaded file is not a valid image or does not match its declared type.",
    });
    return;
  }

  const url = await uploadToImgbb(base64);

  if (!url) {
    res.status(502).json({
      success: false,
      message: "Image upload failed. Please try again later.",
    });
    return;
  }

  res.json({ success: true, data: { url } });
}
