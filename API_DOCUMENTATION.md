# Equipora API Documentation

Base URL (local): `http://localhost:5000`
All endpoints are prefixed with `/api`.

## Authentication

Protected endpoints expect a Better Auth JWT in the `Authorization` header:

```
Authorization: Bearer <token>
```

How to get a token (after signing in on the client at `http://localhost:3000`):

```js
const res = await fetch("/api/auth/token", { credentials: "include" }).then((r) => r.json())
const token = res.token ?? res.data?.token
```

Role values: `customer`, `owner`, `admin`.

## Response format

Success:

```json
{ "success": true, "message": "...", "data": {} }
```

Error:

```json
{ "success": false, "message": "..." }
```

Common error codes: `401` (missing/invalid token), `403` (wrong role), `404` (route not found), `500` (server error).

---

## HEALTH

### GET /api/health

Check that the API server is running.

- Access: Public
- Body: none

---

## AUTH

_No endpoints yet — authentication is handled by Better Auth on the client (`/api/auth/*`)._

---

## EQUIPMENT

Public endpoints only return `approved` equipment.

### GET /api/equipment

List approved equipment with backend-side search, filters, sorting and pagination.

- Access: Public
- Query parameters (all optional):

| Param | Type | Notes |
|---|---|---|
| `search` | string | Case-insensitive match on equipment **name** or **location** |
| `category` | string | One of the six allowed categories |
| `rentalType` | string | `daily` \| `weekly` \| `monthly` |
| `minPrice` | number | `>= 0` |
| `maxPrice` | number | `>= minPrice` |
| `available` | boolean | `true` = quantity > 0, `false` = quantity is 0 |
| `sort` | string | `price_asc` \| `price_desc` \| `newest` (default `newest`) |
| `page` | number | Default `1` |
| `limit` | number | Default `9`, max `50` |

Example:

```
GET /api/equipment?search=drill&category=Electronics&available=true&sort=price_asc&page=1&limit=9
```

Response `200`:

```json
{
  "success": true,
  "data": [
    {
      "_id": "6741f0c2b1a4e93f88d1c111",
      "name": "Cordless Drill",
      "description": "18V cordless drill with battery and charger.",
      "category": "Electronics",
      "location": "Dhaka",
      "price": 15,
      "rentalType": "daily",
      "availableQuantity": 4,
      "condition": "excellent",
      "brand": "Bosch",
      "model": "GSB 18V",
      "imageUrl": "https://i.ibb.co/example/drill.jpg",
      "terms": "Return on time. Damage costs extra.",
      "status": "approved",
      "ownerId": "6afdee6083ef2c03eb6b1692",
      "ownerName": "Equipora Owner",
      "ownerEmail": "owner@example.com",
      "createdAt": "2026-11-18T18:40:00.000Z",
      "updatedAt": "2026-11-18T18:40:00.000Z"
    }
  ],
  "pagination": { "page": 1, "limit": 9, "total": 1, "totalPages": 1 }
}
```

Errors: `400` for an invalid query parameter (for example `limit=100`, `sort=cheap`, `category=Power Tools`, `minPrice` greater than `maxPrice`).

---

### GET /api/equipment/featured

Get the six newest approved equipment items (homepage section).

- Access: Public
- Body: none

Response `200`: `{ "success": true, "data": [ ...6 items max... ] }`

---

### GET /api/equipment/categories

Get all six assignment categories with the number of approved items in each one.

- Access: Public
- Body: none

Response `200`:

```json
{
  "success": true,
  "data": [
    { "category": "Construction", "count": 3 },
    { "category": "Photography", "count": 0 },
    { "category": "Vehicles & Transportation", "count": 1 },
    { "category": "Agriculture", "count": 0 },
    { "category": "Electronics", "count": 4 },
    { "category": "Event", "count": 0 }
  ]
}
```

---

### GET /api/equipment/:id

Get a single equipment item. This route is private because the assignment requires the Equipment Details page to be a private route.

- Access: Authenticated (`Authorization: Bearer <token>`)
- Params: `id` — MongoDB ObjectId
- Body: none

Visibility rules:

- `approved` items: visible to any logged-in user
- `pending` / `rejected` items: visible only to their owner or an admin
- Everyone else gets `404` so the item's existence is not revealed

Errors:

| Status | When |
|---|---|
| `400` | `id` is not a valid ObjectId |
| `401` | Missing or invalid token |
| `404` | Item not found, or not visible to this user |

Response `200`: `{ "success": true, "data": { ...equipment... } }`

---

### POST /api/equipment

Create new equipment.

- Access: **Owner** (`Authorization: Bearer <token>`, role `owner`)
- Body:

```json
{
  "name": "Cordless Drill",
  "description": "18V cordless drill with battery and charger.",
  "category": "Electronics",
  "location": "Dhaka",
  "price": 15,
  "rentalType": "daily",
  "availableQuantity": 4,
  "condition": "excellent",
  "brand": "Bosch",
  "model": "GSB 18V",
  "imageUrl": "https://i.ibb.co/example/drill.jpg",
  "terms": "Return on time. Damage costs extra."
}
```

Required: `name`, `description`, `category`, `location`, `price`, `rentalType`, `availableQuantity`, `condition`, `imageUrl`, `terms`. Optional: `brand`, `model`.

Server-controlled fields (ignored if sent): `status` (always saved as `pending`), `ownerId`, `ownerName`, `ownerEmail`, `createdAt`, `updatedAt`.

Response `201`:

```json
{
  "success": true,
  "data": {
    "_id": "6741f0c2b1a4e93f88d1c111",
    "name": "Cordless Drill",
    "...": "all submitted fields",
    "status": "pending",
    "ownerId": "<id from JWT>",
    "ownerName": "<name from JWT>",
    "ownerEmail": "<email from JWT>",
    "createdAt": "2026-11-19T05:20:00.000Z",
    "updatedAt": "2026-11-19T05:20:00.000Z"
  }
}
```

Errors: `400` invalid body, `401` missing/invalid token, `403` not an owner.

---

### GET /api/equipment/owner/mine

Get all equipment owned by the logged-in owner, including pending and rejected items.

- Access: **Owner**
- Body: none

Response `200`: `{ "success": true, "data": [ ...newest first... ] }`

Errors: `401` missing/invalid token, `403` not an owner.

---

### PATCH /api/equipment/:id

Partially update equipment. Send only the fields you want to change.

- Access: **Owner or Admin**
- Params: `id` — MongoDB ObjectId
- Editable fields: `name`, `description`, `category`, `location`, `price`, `rentalType`, `availableQuantity`, `condition`, `brand`, `model`, `imageUrl`, `terms`

Example (change price and quantity only):

```json
{ "price": 20, "availableQuantity": 3 }
```

Rules:

- Owners can update **only their own** equipment; admins can update any.
- `status`, `ownerId`, `ownerName`, `ownerEmail`, `createdAt` are **never** changed by this route.
- A body with no editable fields returns `400`.
- `updatedAt` is set automatically.

Response `200`: `{ "success": true, "data": { ...updated equipment... } }`

Errors: `400` invalid id/body, `401` missing/invalid token, `403` not the owner, `404` not found.

---

### DELETE /api/equipment/:id

Delete equipment.

- Access: **Owner or Admin**
- Params: `id` — MongoDB ObjectId

Rules: owners can delete **only their own** equipment; admins can delete any.

Response `200`: `{ "success": true, "message": "Equipment deleted." }`

Errors: `400` invalid id, `401` missing/invalid token, `403` not the owner, `404` not found.

---

### GET /api/equipment/admin/all

List equipment of **every** status for the admin dashboard.

- Access: **Admin**
- Query: `status` (optional) — `pending` \| `approved` \| `rejected`

Examples:

```
GET /api/equipment/admin/all
GET /api/equipment/admin/all?status=pending
```

Response `200`: `{ "success": true, "data": [ ...newest first... ] }`

Errors: `400` invalid status, `401` missing/invalid token, `403` not an admin.

---

### PATCH /api/equipment/:id/status

Approve or reject an equipment item.

- Access: **Admin**
- Params: `id` — MongoDB ObjectId
- Body:

```json
{ "status": "approved" }
```

Allowed values: `approved` or `rejected` only (`pending` is set only when the item is created).

Example response `200`:

```json
{
  "success": true,
  "data": {
    "_id": "6741f0c2b1a4e93f88d1c111",
    "name": "Cordless Drill",
    "status": "approved",
    "updatedAt": "2026-11-19T05:40:00.000Z"
  }
}
```

Errors: `400` invalid id or status, `401` missing/invalid token, `403` not an admin, `404` not found.

---

## UPLOADS

### POST /api/uploads/image

Upload an image to ImgBB and return its public URL. Use this URL as
`imageUrl` when creating or updating equipment.

- Access: **Owner or Admin**
- Body: JSON with one field, `image`, containing a **base64 data URL**
- Max decoded size: **3 MB**
- Allowed formats: **PNG, JPEG, GIF, WebP** (the file's first bytes are checked, so renamed non-image files are rejected)
- The `IMGBB_API_KEY` stays on the server and is never returned to the client.

Postman example:

- Method: `POST`
- URL: `http://localhost:5000/api/uploads/image`
- Headers:
  - `Authorization: Bearer <owner-or-admin-token>`
  - `Content-Type: application/json`
- Body → raw → JSON:

```json
{
  "image": "data:image/png;base64,<base64-of-a-real-image>"
}
```

To build that value, encode a normal image file (not a 1×1 placeholder):

```powershell
$base64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\path\to\photo.png"))
# Put "data:image/png;base64,$base64" in the request body
```

> ImgBB rejects tracking-pixel-style images such as 1×1 pixel files with a
> generic upload error. Use a real photo or a normal-sized image.

Response `200`:

```json
{
  "success": true,
  "data": {
    "url": "https://i.ibb.co/xxxxxxx/image.png"
  }
}
```

Errors:

| Status | When |
|---|---|
| `400` | Missing image, not a data URL, invalid base64, non-image content, declared type mismatch, or larger than 3 MB |
| `401` | Missing or invalid token |
| `403` | Not an owner or admin |
| `413` | Request body larger than the 5 MB JSON limit |
| `502` | ImgBB request failed (generic message; no internal details), including images ImgBB flags such as 1×1 tracking pixels |

---

## BOOKINGS

_No endpoints yet._

---

## PAYMENTS

_No endpoints yet._

---

## REVIEWS

_No endpoints yet._

---

## ADMIN

_No endpoints yet. Equipment moderation endpoints are documented under EQUIPMENT
(`GET /api/equipment/admin/all` and `PATCH /api/equipment/:id/status`)._
