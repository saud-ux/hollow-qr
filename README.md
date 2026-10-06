# HOLLOW Rewards

Apple Wallet loyalty card for **HOLLOW — Al Zulfi**: _buy 5 cups, the 6th is free_
(اشترِ 5 أكواب واحصل على السادس مجانًا).

- **Customer site** (Arabic, RTL, mobile-first): sign up, log in, reset the password, view the card, add it to Apple Wallet.
- **Staff / admin dashboard** (Arabic, RTL, iPhone/iPad): scan the QR, add cups (1–5 in one action), redeem the free drink, remove a cup, undo, search; admins also get stats, customer history, membership cancellation, staff accounts and CSV exports.
- **Online ordering** (Arabic, same look as the Wallet card): menu, cart, pickup / curbside / delivery, pay on collection, live order status; a staff order board with sound alerts; admin menu, photos, hours and delivery fee. Drinks earn cups automatically when an order is completed. See [docs/ORDERING.md](docs/ORDERING.md).
- **Apple Wallet**: a real signed `.pkpass` store card, the pass web service (`/v1/...`) and APNs update pushes. A **mock mode** runs everything without Apple certificates.

| Layer | Tech |
|---|---|
| Frontend | React 19 + TypeScript + Vite 8, React Router |
| Backend | Cloudflare Worker (Hono), static assets on the same Worker |
| Data/Auth | Supabase (Postgres, Auth, RLS) |
| Wallet | PKI.js CMS signature + WebCrypto RSA + fflate zip (no `nodejs_compat`) |
| QR scanning | `qr-scanner` (iOS Safari compatible) |
| Tests | Vitest + PGlite (real Postgres in-process running the actual migrations) |

## Quick start (local)

```bash
pnpm install
cp .dev.vars.example .dev.vars        # fill SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY
npx supabase link --project-ref <ref> # once
npx supabase db push                  # apply supabase/migrations
pnpm bootstrap:admin --email you@example.com --name "Owner"
pnpm seed:dev --confirm-dev           # optional sample data (dev project only)
pnpm dev                              # http://localhost:5173  (staff: /staff/login)
```

Quality gates:

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:smoke
# or: pnpm check
```

> The camera scanner needs HTTPS on a real device. To test on an iPhone, deploy a
> preview or use a tunnel such as `cloudflared tunnel --url http://localhost:5173`.

## Routes

| Path | Purpose |
|---|---|
| `/`, `/register` | Sign-up (الاسم، البريد، كلمة المرور، التأكيد) |
| `/login`, `/forgot-password`, `/reset-password` | Supabase Auth flows |
| `/wallet` | Card preview + Add to Apple Wallet |
| `/menu`, `/cart`, `/orders`, `/orders/:id` | Online ordering and order status |
| `/c/:token` | Where the pass QR points; shows no data unless a staff session resolves it |
| `/staff/login`, `/staff`, `/staff/customers/:id`, `/staff/admin` | Dashboard |
| `/staff/orders`, `/staff/admin/menu` | Order board; menu, hours and ordering settings |
| `/api/*` | JSON API (Bearer Supabase JWT) |
| `/v1/*` | Apple Wallet pass web service |

## Project layout

```
src/shared/          constants, API types, Arabic messages (client + server)
src/server/          Worker: app.ts (Hono), routes/, http/, data/, wallet/, security/, pos/
src/client/          React app: pages/customer, pages/staff, components, lib
supabase/migrations/ schema, RLS, atomic loyalty RPC
scripts/             asset generation, admin bootstrap, dev seed, cert encoder, smoke test
tests/               unit + integration (PGlite) tests
reference-assets/    original brand files (source of all generated artwork)
docs/                deployment, Apple Wallet, architecture & security notes
```

## Documentation

- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): Supabase + Cloudflare setup, secrets, deploy
- [docs/APPLE_WALLET.md](docs/APPLE_WALLET.md): certificates, switching mock → production, APNs mTLS
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): loyalty rules, security model, design decisions
- [docs/ORDERING.md](docs/ORDERING.md): online ordering rules, order flow, deployment notes
