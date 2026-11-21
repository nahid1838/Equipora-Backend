# Equipora API

Express, TypeScript and MongoDB API for Equipora, an equipment rental marketplace. It serves equipment, favorites, bookings and Stripe payments, owner applications, user administration, and dashboard analytics. See [API documentation](API_DOCUMENTATION.md) for routes and response formats.

## Local setup

Use Node.js 24. Run `npm ci`, copy `.env.example` to `.env`, fill in the values, and run `npm run dev`. The API defaults to port 5000. Run `npm test` for the booking tests and `npm run typecheck` for TypeScript. Run `npm run build` followed by `npm start` to start the compiled standalone server.

| Variable | Required | Sensitive | Local and production use |
| --- | --- | --- | --- |
| `MONGODB_URI` | Yes | Yes | MongoDB connection URI. The API and frontend use the same cluster and `equiporadb` database. Use isolated data for local and Stripe QA. |
| `BETTER_AUTH_URL` | Yes | No | Frontend origin, used as JWT issuer and audience and for `/api/auth/jwks`. Local default example is `http://localhost:3000`. Use the canonical frontend HTTPS origin on Vercel. |
| `CLIENT_URL` | Yes | No | Exact frontend origin for CORS and Stripe Checkout return links. Use the same origin as `BETTER_AUTH_URL`. |
| `STRIPE_SECRET_KEY` | Yes | Yes | Stripe server key. Start with a sandbox/test-mode key in both local and hosted QA. |
| `STRIPE_WEBHOOK_SECRET` | For webhook processing | Yes | Use the local Stripe CLI listener's secret locally. In Vercel, use the secret of the hosted endpoint in the same Stripe mode as the API key. |
| `IMGBB_API_KEY` | Yes | Yes | Server-side ImgBB key for equipment uploads. |
| `PORT` | Local only, optional | No | Standalone listening port, default 5000. Leave unset in Vercel. |

## Deploy manually on Vercel

1. Choose the canonical frontend origin you will use. Import the **backend repository** first and select its repository root (`.`). Use the Express preset and Node.js 24.x. Leave install/build/output overrides unset. Vercel discovers the default Express export in `src/index.ts` and routes through that function. There is no custom rewrite or separate webhook function. [Express on Vercel](https://vercel.com/docs/frameworks/backend/express)
2. Add the backend variables above. Use the planned frontend origin for both `CLIENT_URL` and `BETTER_AUTH_URL`. Add the final webhook signing secret after registering the hosted endpoint in Stripe. Deploy from the Vercel dashboard.
3. Open `https://<backend-host>/api/health`. A 200 response confirms that API initialization finished. If it fails, check MongoDB access and index permissions in Vercel logs. Copy this backend origin for the frontend project.
4. Import the **frontend repository** separately. Select its repository root, use Next.js and Node.js 24.x, and follow the frontend README to configure Better Auth and Google OAuth. After it deploys, use its actual canonical origin for both backend URL variables. Redeploy any project after changing its environment.
5. Verify the public catalog from the browser, then sign in and test a protected dashboard call. The backend fetches public signing keys from `https://<frontend-host>/api/auth/jwks`. Production deployment protection must permit browser access to the API, Stripe webhook delivery, and the backend's access to that JWKS endpoint. The API uses bearer JWTs; no shared JWT secret is needed.

### Build dependency installation

The backend's root `.npmrc` tells npm to include development and optional dependencies during installation. The build needs TypeScript, its platform binary, and the Node, Express, and CORS type definitions. Keep the Vercel root directory at the backend repository root so npm reads this file. If the project uses a custom npm install command, use `npm ci --include=dev --include=optional`.

### First-deployment MongoDB indexes

The first API request per function instance waits for database connection and index creation. Concurrent requests within that instance share the same initialization promise. Other instances request identical MongoDB index definitions so MongoDB can reuse existing indexes. Verify the backend account can connect, read and write app data, and create indexes. The frontend can use a separate database user pointing to the same database.

Owner applications require a unique partial index on `ownerApplications.userId` for documents with `status: "pending"`. The application creates it along with the supporting read indexes. A fresh collection needs no manual migration. If initialization fails because there are existing duplicate pending records or a conflicting index definition, review them with the database administrator before proceeding. Do not drop indexes or delete data to make a deployment pass. The health route also waits for initialization and will return a failure if index setup fails.

### Stripe webhook and test-mode verification

Register `https://<backend-host>/api/payments/webhook` in Stripe test mode and configure its signing secret as `STRIPE_WEBHOOK_SECRET` in Vercel. Enable all six events:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`
- `checkout.session.expired`
- `refund.updated`
- `refund.failed`

Redeploy the backend after setting the signing secret. The Express route receives raw JSON bytes before the normal JSON parser so Stripe can verify the signature. [Stripe webhook signatures](https://docs.stripe.com/webhooks/signature)

Checkout returns to the frontend at `/booking/payment/<checkout-id>?session_id={CHECKOUT_SESSION_ID}` on success, and `/booking/payment/<checkout-id>?cancelled=1` on cancel. The server verifies payment using the signed webhook or the authenticated confirm endpoint, which can recover fulfillment when webhook delivery is delayed. Returning to the frontend alone does not confirm payment.

Use a sandbox card, isolated database, and test accounts. Verify a webhook-first checkout, a missed-webhook recovery, cancellation without creating a booking, duplicate delivery without duplicate bookings, and refund status. Verify Owner Applications with concurrent duplicate submissions and a rejected and approved application. After approval, reload the applicant's dashboard and check a protected Owner API call.
