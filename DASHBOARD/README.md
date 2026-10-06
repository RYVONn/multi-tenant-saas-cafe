# DASHBOARD

Business owner/staff dashboard (TanStack Start + React + Tailwind + shadcn/ui), imported from the
Lovable project `moazwaelamer/pixel-perfect-show-7164`.

All nav items in the sidebar now resolve to a real route (`src/routes/_dash.*.tsx`). Orders,
Inventory, Shift History, Overview, Order History, Products, Categories, Offers, Loyalty,
Storefront Settings, Suppliers, Sales, Reports, Waste Log and Events call the real BACKEND through
`src/lib/api-client.ts` (TanStack Query) and fall back to sample data if the backend is unreachable
or the request isn't authorized yet. Customers, Messages, Staff, Shifts, Business Settings, Users &
Roles, Admin Panel and the platform_admin-only Platform Console currently run on sample data because
no matching backend endpoint exists yet (see comments at the top of each of those route files).

## Environment variables

Copy `.env.example` to `.env` for local dev:

- `VITE_API_URL` — base URL of the BACKEND API, **including** the `/api` prefix (e.g.
  `http://localhost:3000/api` locally, or `https://api.yourdomain.com/api` once deployed). Read by
  `src/lib/api-client.ts`.

## Running locally

```sh
npm install
npm run dev      # local dev server, proxies to VITE_API_URL
npm run build    # production build
npm test
```

## Deploying to Vercel

This project builds with TanStack Start on Nitro. Nitro's default preset is `cloudflare-module`
(see the comment at the top of `vite.config.ts`), which isn't what Vercel expects, so
`vite.config.ts` pins `nitro: { preset: "vercel" }` explicitly.

To deploy:

1. Import this GitHub repo into Vercel.
2. Set the project's **Root Directory** to `DASHBOARD`.
3. Set the environment variable `VITE_API_URL` to the deployed BACKEND's public URL + `/api`.
4. Deploy — Vercel's framework detection + the pinned Nitro preset handle the rest; no extra
   `vercel.json` is required.

Also add the dashboard's Vercel URL to the BACKEND's `CORS_ALLOWED_ORIGINS` env var so the backend
accepts authenticated requests from it (see `BACKEND/.env.example`).
