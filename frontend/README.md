# frontend (placeholder)

Shared, data-driven storefront template — to be built in Lovable.

One codebase serves every business: content/theme/catalog are fetched per request from
`GET /api/storefront/config?business=<slug>`, resolved from the subdomain
(`business-slug.platform.com`). No per-business forking.

Build against mock config data until the real `/api/storefront/config` endpoint exists.
