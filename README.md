# Multi-Tenant SaaS Café & Restaurant Platform

Evolving the single-tenant Bleu café operations backend into a multi-tenant SaaS platform.
Each business gets its own dashboard, storefront (subdomain), and fully isolated data.

## Structure

- `BACKEND/` — Node.js/Express + Prisma/PostgreSQL API, carried over from the original
  single-tenant Bleu backend. Being evolved (not rewritten) to add `Business`/`business_id`
  tenancy, a Platform Admin layer, and tenant-safe enforcement.
- `DASHBOARD/` — (to be added) business owner/staff dashboard frontend.
- `frontend/` — (to be added) shared, data-driven storefront template, rendered per business
  via subdomain (`business-slug.platform.com`).

## Status

Starting point copied from Bleu's `BACKEND` on 2026-10-05. Business-specific image data
(`drinks/`, `uploads/`) intentionally excluded — this repo is a generic multi-tenant
skeleton, not a specific business's data.

See the project's Linear backlog ("Multi-Tenant Café & Restaurant SaaS Platform") for the
full epic/milestone breakdown and implementation order.
