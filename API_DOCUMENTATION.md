# Equipora API Documentation

- Express API base URL (local): `http://localhost:5000`
- Better Auth base URL (local, runs in the Next.js app): `http://localhost:3000`

All Express endpoints are prefixed with `/api`. Authentication endpoints are
served by Better Auth inside the Next.js app and are documented in the
[AUTH](#auth) section.

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

Success responses always include `success: true` and either `data`, `message`,
or both (for example the health check has no `data`, and the list endpoint adds
`pagination`):

```json
{ "success": true, "data": {} }
```

```json
{ "success": true, "message": "..." }
```

Errors always look like this:

```json
{ "success": false, "message": "..." }
```

Common status codes:

| Status | Meaning |
|---|---|
| `400` | Invalid body, query parameter, or id |
| `401` | Missing or invalid token |
| `403` | Logged in, but the wrong role / not the owner |
| `404` | Item not found, not visible to you, or unknown route |
| `413` | JSON body larger than the 5 MB limit |
| `500` | Unexpected server error (details are only logged on the server) |
| `502` | Third-party service (ImgBB or Stripe) failed |
| `503` | A required service is not configured (for example the Stripe webhook secret) |

---

## HEALTH

### GET /api/health

Check that the API server is running.

- Access: Public
- Body: none

Response `200`:

```json
{ "success": true, "message": "Equipora API is running" }
```

---

## AUTH

Authentication is **not** implemented in this Express server. It is handled by
**Better Auth** inside the Next.js app at `http://localhost:3000`, and this
Express API only verifies the JWT those endpoints produce.

Better Auth stores users in the same MongoDB database (`equiporadb`) and uses
the same JWT issuer/audience as `BETTER_AUTH_URL`.

### Better Auth endpoints used by the client

| Method | URL | Purpose |
|---|---|---|
| `POST` | `http://localhost:3000/api/auth/sign-up/email` | Create an account (default role `customer`) |
| `POST` | `http://localhost:3000/api/auth/sign-in/email` | Sign in and start a session |
| `GET` | `http://localhost:3000/api/auth/get-session` | Read the current session |
| `GET` | `http://localhost:3000/api/auth/token` | Get the JWT used by this Express API |
| `POST` | `http://localhost:3000/api/auth/sign-out` | End the session |

> `POST /api/auth/sign-out` expects `Content-Type: application/json` and an
> empty JSON body (`{}`); without the header Better Auth returns `415`.

### Postman: sign up

- Method: `POST`
- URL: `http://localhost:3000/api/auth/sign-up/email`
- Headers:
  - `Content-Type: application/json`
  - `Origin: http://localhost:3000` (required when calling from Postman/curl)
- Body → raw → JSON:

```json
{
  "name": "Test Customer",
  "email": "customer@example.com",
  "password": "Test1234"
}
```

The response contains the new `user` object and sets a session cookie.

### Postman: sign in

- Method: `POST`
- URL: `http://localhost:3000/api/auth/sign-in/email`
- Headers: same as sign up
- Body → raw → JSON:

```json
{
  "email": "customer@example.com",
  "password": "Test1234"
}
```

Postman keeps the returned session cookie automatically. With `curl`, copy the
`Set-Cookie` value and send it as `Cookie: <value>` on the next request.

### Postman: get the JWT

- Method: `GET`
- URL: `http://localhost:3000/api/auth/token`
- Headers: the session cookie from sign in (Postman sends it automatically)

Response `200`:

```json
{ "token": "<jwt>" }
```

Send that token to every protected Express endpoint:

```
Authorization: Bearer <jwt>
```

### Roles

- New accounts always start as `customer`.
- `owner` and `admin` roles are assigned by an administrator directly in the
  `user` collection (`role` field). There is no public endpoint to change roles.
- A user cannot set their own role during sign up.

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

Allowed values:

| Field | Values |
|---|---|
| `category` | `Construction`, `Photography`, `Vehicles & Transportation`, `Agriculture`, `Electronics`, `Event` |
| `rentalType` | `daily`, `weekly`, `monthly` |
| `condition` | `excellent`, `good`, `fair` |

Rules:

- `price` must be a number greater than `0`.
- `availableQuantity` must be a whole number of `0` or more.
- `imageUrl` must start with `http` (upload the file first with
  `POST /api/uploads/image`).
- Numeric strings such as `"15"` are accepted for `price` and
  `availableQuantity` and saved as numbers.

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

- The body must be a JSON object containing at least one editable field.
- Owners can update **only their own** equipment; admins can update any.
- `status`, `ownerId`, `ownerName`, `ownerEmail`, `createdAt` are **never** changed by this route.
- A body with no editable fields returns `400`.
- `updatedAt` is set automatically.
- Changed fields are validated with the same rules as create (for example, an
  empty `name` or a `price` of `0` returns `400`).

Response `200`: `{ "success": true, "data": { ...updated equipment... } }`

Errors: `400` invalid id/body, `401` missing/invalid token, `403` not an owner/admin or not the item's owner, `404` not found.

---

### DELETE /api/equipment/:id

Delete equipment.

- Access: **Owner or Admin**
- Params: `id` — MongoDB ObjectId

Rules: owners can delete **only their own** equipment; admins can delete any.

Response `200`: `{ "success": true, "message": "Equipment deleted." }`

Errors: `400` invalid id, `401` missing/invalid token, `403` not an owner/admin or not the item's owner, `404` not found.

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

Example response `200` (abbreviated — the real response is the full updated
equipment item, the same shape as `PATCH /api/equipment/:id`):

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
- Max decoded size: **3 MB** (the JSON body limit is 5 MB because base64 is larger than the original file)
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

Booking prices are calculated on the server from the equipment's stored price and
the requested date range. Nothing is booked until Stripe reports the payment as
paid, so `POST /api/bookings/checkout` only creates a checkout draft.

Checkout lifecycle (`GET /api/bookings/checkout/:id` returns one of these):

| Status | Meaning |
|---|---|
| `open` | No payment confirmed yet |
| `processing` | Payment saved, booking document still being written |
| `confirmed` | Payment saved and booking created |
| `expired` | Stripe Checkout expired without payment |
| `failed` | Stripe reported a failed asynchronous payment |
| `refund_required` | Paid, but the rental was no longer available; refund needed |
| `refund_pending` | Stripe is processing the refund |
| `refunded` | Stripe refunded the payment |

### POST /api/bookings/quote

Price a rental without creating anything.

- Access: Customer
- Body:

```json
{
  "equipmentId": "65f0c0a1b2c3d4e5f6071829",
  "startDate": "2026-12-01",
  "endDate": "2026-12-04",
  "quantity": 1
}
```

Response `200`:

```json
{
  "success": true,
  "data": {
    "unitPriceMinor": 5000,
    "billableUnits": 3,
    "totalAmountMinor": 15000,
    "currency": "usd",
    "durationDays": 3
  }
}
```

Errors: `400` invalid dates, quantity, or equipment id; `404` equipment not
found or not approved; `401`/`403` wrong role.

---

### POST /api/bookings/checkout

Create a Stripe Checkout Session for a rental. Reusing the same `requestKey` with
the same rental details returns the same draft, which makes double-submits safe.

- Access: Customer
- Body:

```json
{
  "equipmentId": "65f0c0a1b2c3d4e5f6071829",
  "startDate": "2026-12-01",
  "endDate": "2026-12-04",
  "quantity": 1,
  "contactNumber": "+8801700000000",
  "deliveryAddress": "House 12, Road 5, Dhaka",
  "notes": "Deliver before 9 AM",
  "requestKey": "3f6c1f1a-6f3f-4d64-9f38-8c9f2f6b8a11"
}
```

Response `200`:

```json
{ "success": true, "data": { "url": "https://checkout.stripe.com/c/pay/..." } }
```

Send the browser to `data.url`. Stripe returns the customer to
`/booking/payment/:checkoutId?session_id={CHECKOUT_SESSION_ID}` after payment.

Errors:

| Status | When |
|---|---|
| `400` | Invalid dates, quantity, contact number, address, notes, or `requestKey` |
| `401` / `403` | Missing token or not a customer |
| `404` | Equipment not found or not approved |
| `409` | Dates no longer available, checkout key reused with different details, or checkout ended |
| `502` | Stripe could not be reached |

---

### GET /api/bookings/checkout/:id

Read the current status of a checkout owned by the signed-in customer.

- Access: Customer (must own the checkout)
- Params: `id` — checkout ObjectId
- Body: none

Response `200`:

```json
{
  "success": true,
  "data": { "status": "open", "equipmentId": "65f0c0a1b2c3d4e5f6071829" }
}
```

Errors: `400` invalid id; `401`/`403` wrong role; `404` checkout not found or not
owned by this customer.

---

### POST /api/bookings/checkout/:id/confirm

The payment page calls this after the Stripe redirect. The server retrieves the
Checkout Session from Stripe and, when it is paid, saves the payment and booking
using the same logic as the webhook. It is idempotent, so the client may call it
repeatedly while it polls.

- Access: Customer (must own the checkout)
- Params: `id` — checkout ObjectId
- Body: none

Response `200` — nothing is saved if Stripe still reports the session as unpaid:

```json
{
  "success": true,
  "data": { "status": "confirmed", "equipmentId": "65f0c0a1b2c3d4e5f6071829" }
}
```

The response `data.status` uses the same values as the table above. This endpoint
works without local webhook forwarding, but the webhook should stay configured in
production so refunds and expired sessions are recorded too.

Errors:

| Status | When |
|---|---|
| `400` | `id` is not a valid ObjectId |
| `401` / `403` | Missing token or not a customer |
| `404` | Checkout not found or not owned by this customer |
| `409` | No Stripe session yet, or the session does not match this checkout |
| `502` | Stripe could not be reached |
| `503` | Stripe returned incomplete payment data |

---

### GET /api/bookings/my

List the signed-in customer's bookings, newest first.

- Access: Customer
- Query: `page` (optional, default `1`; 10 per page)
- Body: none

Response `200`:

```json
{
  "success": true,
  "data": [
    {
      "_id": "65f0c0a1b2c3d4e5f6071829",
      "equipmentId": "65f0c0a1b2c3d4e5f6071800",
      "equipmentName": "Cordless Drill",
      "customerName": "Test Customer",
      "ownerName": "Test Owner",
      "startDate": "2026-12-01T00:00:00.000Z",
      "endDate": "2026-12-04T00:00:00.000Z",
      "durationDays": 3,
      "quantity": 1,
      "rentalType": "daily",
      "unitPriceMinor": 5000,
      "billableUnits": 3,
      "totalAmountMinor": 15000,
      "currency": "usd",
      "paymentStatus": "paid",
      "bookingStatus": "confirmed",
      "createdAt": "2026-12-01T08:30:00.000Z"
    }
  ],
  "pagination": { "page": 1, "limit": 10, "total": 1, "totalPages": 1 }
}
```

Errors: `400` invalid page; `401`/`403` wrong role.

---

### GET /api/bookings/owner

List bookings for the signed-in owner's equipment. Same shape and pagination as
`GET /api/bookings/my`.

- Access: Owner
- Query: `page`

---

### GET /api/bookings

List every booking in the marketplace. Same shape and pagination as
`GET /api/bookings/my`.

- Access: Admin
- Query: `page`

---

## PAYMENTS

Payments are handled with **Stripe Checkout** in `payment` mode. The server saves
a `payments` document when a paid Checkout Session is fulfilled, and a `bookings`
document if the rental was still available. If the rental is no longer available,
the payment is recorded as `refund_required` and a refund is submitted through
Stripe.

### POST /api/payments/webhook

Stripe calls this endpoint. Do not call it manually: the request body must be the
raw JSON Stripe sent, and `Stripe-Signature` must match
`STRIPE_WEBHOOK_SECRET`.

- Access: Public (verified by Stripe signature)
- Headers: `Stripe-Signature: t=...,v1=...`, `Content-Type: application/json`
- Body: raw Stripe event

Handled events:

| Event | Result |
|---|---|
| `checkout.session.completed` | Saves the payment and booking |
| `checkout.session.async_payment_succeeded` | Saves the payment and booking |
| `checkout.session.async_payment_failed` | Marks the checkout `failed` |
| `checkout.session.expired` | Marks the checkout `expired` |
| `refund.updated` | Updates the payment to `refunded` / `refund_pending` |
| `refund.failed` | Keeps the payment in `refund_required` |

Response `200`: `{ "success": true, "message": "Webhook received." }`

Errors: `400` missing/invalid signature or raw body; `503` webhook secret not set.

### Local webhook setup

Stripe cannot reach `localhost` directly, so forward events with the Stripe CLI:

```bash
stripe login
stripe listen --forward-to localhost:5000/api/payments/webhook
```

Copy the `whsec_...` value printed by `stripe listen` into
`equipora-server/.env` as `STRIPE_WEBHOOK_SECRET`, then restart the API. The CLI
secret changes every time `stripe listen` starts, so repeat this whenever the CLI
prints a new one.

The payment page also calls
`POST /api/bookings/checkout/:id/confirm`, which verifies the session directly
with Stripe. That means bookings still complete locally if the webhook was missed,
but running the CLI is recommended so refunds and expirations are recorded.

For production, add an endpoint in the Stripe Dashboard pointing to
`https://your-api-domain/api/payments/webhook` with the same six events and put
that endpoint's signing secret in the deployed environment.

---

## ANALYTICS

Dashboard totals calculated from the database. Amounts are integer USD cents
(`currency: "usd"`). Revenue is the sum of `totalAmountMinor` over paid bookings,
so a payment is never counted twice. A rental is **completed** when its `endDate`
is before the current time.

The monthly series always contains six points — oldest first, current month last
— using UTC month boundaries. Months with no bookings are included with zeroes.

### GET /api/analytics/admin

Marketplace-wide totals for the admin dashboard.

- Access: Admin
- Body: none

| Field | Meaning |
|---|---|
| `totalUsers` | All Better Auth accounts |
| `totalEquipment` | All equipment, regardless of status |
| `totalBookings` | All paid bookings |
| `pendingApprovals` | Equipment waiting for moderation (`status: "pending"`) |
| `completedRentals` | Bookings whose `endDate` is before now |
| `totalRevenueMinor` | Sum of all booking totals |
| `monthly` | Six months of `{ month, label, bookings, revenueMinor }` |

Response `200`:

```json
{
  "success": true,
  "data": {
    "totalUsers": 3,
    "totalEquipment": 12,
    "totalBookings": 7,
    "pendingApprovals": 2,
    "completedRentals": 4,
    "totalRevenueMinor": 315000,
    "currency": "usd",
    "monthly": [
      { "month": "2026-06", "label": "Jun 2026", "bookings": 0, "revenueMinor": 0 },
      { "month": "2026-07", "label": "Jul 2026", "bookings": 1, "revenueMinor": 15000 },
      { "month": "2026-08", "label": "Aug 2026", "bookings": 0, "revenueMinor": 0 },
      { "month": "2026-09", "label": "Sep 2026", "bookings": 2, "revenueMinor": 60000 },
      { "month": "2026-10", "label": "Oct 2026", "bookings": 1, "revenueMinor": 40000 },
      { "month": "2026-11", "label": "Nov 2026", "bookings": 3, "revenueMinor": 200000 }
    ]
  }
}
```

Errors: `401` missing/invalid token; `403` not an admin.

---

### GET /api/analytics/owner

Totals for the signed-in owner's own equipment and bookings.

- Access: Owner
- Body: none

| Field | Meaning |
|---|---|
| `totalEquipment` | Equipment owned by the requester, any status |
| `completedRentals` | The owner's bookings whose `endDate` is before now |
| `totalEarningsMinor` | Sum of the owner's booking totals |
| `monthly` | Six months of `{ month, label, bookings, earningsMinor }` |

Response `200`:

```json
{
  "success": true,
  "data": {
    "totalEquipment": 4,
    "completedRentals": 2,
    "totalEarningsMinor": 55000,
    "currency": "usd",
    "monthly": [
      { "month": "2026-06", "label": "Jun 2026", "bookings": 0, "earningsMinor": 0 },
      { "month": "2026-07", "label": "Jul 2026", "bookings": 0, "earningsMinor": 0 },
      { "month": "2026-08", "label": "Aug 2026", "bookings": 1, "earningsMinor": 15000 },
      { "month": "2026-09", "label": "Sep 2026", "bookings": 1, "earningsMinor": 10000 },
      { "month": "2026-10", "label": "Oct 2026", "bookings": 0, "earningsMinor": 0 },
      { "month": "2026-11", "label": "Nov 2026", "bookings": 2, "earningsMinor": 30000 }
    ]
  }
}
```

Errors: `401` missing/invalid token; `403` not an owner.

---

## REVIEWS

_No endpoints yet._

---

## ADMIN

Admin routes require a token whose role is `admin`. The endpoints below manage
accounts stored by Better Auth in the `user` collection. Password hashes and
OAuth accounts live in the separate `account` collection, so they are never
returned here.

Equipment moderation is documented under EQUIPMENT
(`GET /api/equipment/admin/all` and `PATCH /api/equipment/:id/status`).

### GET /api/admin/users

List every account with optional search, role filter, and pagination.

- Access: Admin
- Query:
  - `page` — optional, default `1`
  - `limit` — optional, default `10`, maximum `50`
  - `search` — optional, case-insensitive match on name or email
  - `role` — optional, one of `customer`, `owner`, `admin`
- Body: none

Example:

```
GET /api/admin/users?search=rahim&role=customer&page=1&limit=10
```

Response `200`:

```json
{
  "success": true,
  "data": [
    {
      "_id": "691f0c1a2b3c4d5e6f708192",
      "name": "Test Customer",
      "email": "customer@example.com",
      "role": "customer",
      "image": "",
      "emailVerified": false,
      "createdAt": "2026-11-10T08:15:00.000Z",
      "updatedAt": "2026-11-10T08:15:00.000Z"
    }
  ],
  "pagination": { "page": 1, "limit": 10, "total": 1, "totalPages": 1 }
}
```

Errors:

| Status | When |
|---|---|
| `400` | Invalid `page`, `limit`, or `role` |
| `401` | Missing or invalid token |
| `403` | Signed in, but not an admin |

---

### PATCH /api/admin/users/:id/role

Change one account's role.

- Access: Admin
- Params: `id` — the user's MongoDB ObjectId (the same value returned as `_id`)
- Body:

```json
{ "role": "owner" }
```

`role` must be exactly one of `customer`, `owner`, or `admin`.

Response `200`:

```json
{
  "success": true,
  "data": {
    "_id": "691f0c1a2b3c4d5e6f708192",
    "name": "Test Customer",
    "email": "customer@example.com",
    "role": "owner",
    "image": "",
    "emailVerified": false,
    "createdAt": "2026-11-10T08:15:00.000Z",
    "updatedAt": "2026-11-21T09:40:00.000Z"
  }
}
```

Sending the role an account already has is a successful no-op and returns the
same document.

Safety rules:

- An admin cannot change their own role (prevents locking themselves out).
- The last remaining admin cannot be demoted.
- Only `role` is writable through this route; name, email, and auth data cannot
  be changed here.

Errors:

| Status | When |
|---|---|
| `400` | Invalid user id, body, or role value |
| `401` | Missing or invalid token |
| `403` | Signed in, but not an admin |
| `404` | User not found |
| `409` | Changing your own role, or demoting the last admin |

## Owner Applications

All routes use an Equipora bearer JWT. Customer submission and admin review
also check the user's current role in MongoDB.

| Method and route | Access | Result |
| --- | --- | --- |
| `POST /api/owner-applications` | Customer | Creates a pending application and responds with HTTP 201. |
| `GET /api/owner-applications/me` | Signed-in user | Returns `{ application, hasOwnerAccess }` in `data`. The application is `null` when there is no history. |
| `GET /api/admin/owner-applications?page=1` | Admin | Returns ten newest-first applications per page, with applicant name and email where the account exists. Includes standard pagination. |
| `PATCH /api/admin/owner-applications/:id` | Admin | Accepts `{ "status": "approved" }` or `{ "status": "rejected" }` and returns the reviewed application. |

Submit a reason of 20–1000 characters. `businessName` and
`additionalInformation` are optional, with limits of 100 and 500 characters.
The server derives identity from the verified token. It rejects extra fields,
including submitted user IDs, roles, and statuses.

An existing pending application returns HTTP 409 on submission. A rejected
customer can reapply. Approval promotes an eligible customer to Owner and
records the decision. Repeating a completed decision returns the same outcome.
If approval is interrupted, an admin can retry approval. An opposing decision
or an ineligible applicant produces HTTP 409. See the [deployment guide](README.md)
for the required pending-application index.
