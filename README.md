# FixMate Server: Express + MongoDB API

REST API for **FixMate**, the smart device & home appliance repair booking platform. Handles services, bookings, Stripe payments and admin tools with JWT role-based middleware.

- **Live API:** `[fixmate-live-api](https://fixmate-server-psi.vercel.app/)`
- **Client repo:** `[fixmate-client](https://fixmate-client-pink.vercel.app/)`

## Key features

- **Exactly 4 collections:** `user` (BetterAuth's collection, used as `users`), `services`, `bookings`, `payments`.
- **Challenge 2: middlewares** `verifyToken`, `verifyCustomer`, `verifyTechnician`, `verifyAdmin`. Missing/invalid token -> **401**; wrong role -> **403**. The role is always re-read from MongoDB, never trusted from the token. Users only reach their own data (ownership checked on every `:id` route).
- **Challenge 1: server-side search/filter/sort/pagination** on `GET /api/services` (`q`, `category`, `mode`, `sort`, `page`, `limit`) using MongoDB queries.
- **Challenge 3: job pipeline enforced on the server:** `requested -> accepted | rejected`, `accepted -> in-progress`, `in-progress -> completed` (needs `finalAmount > 0`). Customers can cancel only while `requested`. Payment is possible only for a **completed + unpaid** booking owned by the caller; the amount always comes from the database.
- **Challenge 4: Stripe webhook** (`checkout.session.completed`) plus success-page verification share one `savePaidSession()`; a unique index on `stripeSessionId` and an `unpaid -> paid` guard make double-saving impossible.
- **Business rules:** no duplicate active requests for the same service (409), technicians/admins cannot request repairs, a service edit sends it back to `pending`.
- **Optional features:** `statusHistory` on bookings (timeline tracker), `rating` + `review` after payment (average rating on services), server-side pagination.

## API

| Method | Route | Access |
| --- | --- | --- |
| GET | `/api/services`, `/api/services/:id` | Public |
| GET | `/api/services/my` | Technician |
| POST / PATCH / DELETE | `/api/services`, `/api/services/:id` | Technician (owner) |
| POST | `/api/bookings` | Customer |
| GET | `/api/bookings/my` | Customer |
| PATCH | `/api/bookings/:id/cancel` | Customer (owner) |
| POST | `/api/bookings/:id/review` | Customer (owner, paid) |
| GET | `/api/bookings/technician` | Technician |
| PATCH | `/api/bookings/:id/status` | Technician (owner) |
| POST | `/api/payments/create-checkout-session` | Customer |
| GET | `/api/payments/verify`, `/api/payments/my` | Customer |
| POST | `/api/payments/webhook` | Stripe (signature checked) |
| GET | `/api/admin/users`, `/services`, `/bookings`, `/payments` | Admin |
| PATCH | `/api/admin/users/:id/role`, `/api/admin/services/:id/approval` | Admin |
| PATCH | `/api/users/profile` | Any signed-in user |
| GET | `/api/stats/overview` (role aware), `/api/stats/public` | Signed-in / Public |

## Packages

`express`, `cors`, `dotenv`, `mongodb`, `jsonwebtoken`, `stripe`; dev: `typescript`, `tsx`, `@types/*`.

## Local setup

```bash
npm install
cp .env.example .env        # fill in the values
npm run dev                 # http://localhost:5000
```

`JWT_SECRET` must be identical to the client's `JWT_SECRET`. `MONGODB_URI` and `DB_NAME` must point to the same database the client uses.

### Seed

Run the **client** seed first (it creates the demo users through BetterAuth), then:

```bash
npm run seed
```

This creates 14 approved services across all 7 categories, 1 pending service and bookings in every status (some paid with reviews).

## Deploying to Vercel

`api/index.ts` exports the Express app and `vercel.json` rewrites every route to it.

1. Add all variables from `.env.example` in the Vercel project settings. Set `CLIENT_URL` to the production client URL.
2. In the **Stripe Dashboard (test mode)** add a webhook endpoint `https://<your-server>.vercel.app/api/payments/webhook` for the event `checkout.session.completed`, and put its signing secret in `STRIPE_WEBHOOK_SECRET`.
3. Open `https://<your-server>.vercel.app/` and confirm it returns `{ "status": "ok" }`.
