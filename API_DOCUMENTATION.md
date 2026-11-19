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

_No endpoints yet._
