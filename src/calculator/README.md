# Sales and rental calculator

The live calculator is proxied from the separately deployed server configured by `CALCULATOR_BASE_URL`, using the server-only `CALCULATOR_API_KEY` in `X-Calculator-Key`. The calculator runs in a same-origin frame. Updating and deploying the calculator server updates Jeago's calculator on the next reload without a Jeago redeployment. The old `index.html`, `style.css`, `script.js` and `catalog.json` are legacy reference files and are excluded from calculator deployment traces.

All content and catalog routes require the inventory session and use private/no-store responses. Browser preferences and rental history are scoped to the authenticated account ID. Price data is never placed under `public/`.

The upstream HTML, stylesheet, script, sale products and rental products are fetched with no cache. Product JSON is passed through without interpreting fields. HTML integration rewrites the style/script URLs and injects `window.CALCULATOR_API` before upstream scripts. The upstream JavaScript is delivered unchanged; account-scoped local storage is provided by the iframe bootstrap. `api-settings.html`, `api-settings.js` and `integration.css` preserve Jeago's company marketplace settings UI.

The following routes require a Jeago login: `/calculator/content` and `/calculator/content/index` proxy `/`; `style`/`style.css` and `script`/`script.js` proxy the corresponding assets; `sale-products` and `rent-products` proxy their `/api/` endpoints. POST `cost-discounts` requires the same-origin JSON request and forwards the body, upstream status and detail response to `/api/cost-discounts`. Unknown paths and redirects are rejected. Browser cookies are never forwarded upstream. Network failures produce a safe 502 message without exposing credentials. All responses are private/no-store.

The historical workbook importer remains available for reference:

```
python scripts/import-calculator.py <workbook-folder> src/calculator/catalog.json
```

This importer no longer controls live calculator prices. Make pricing, formula and layout changes in the separate calculator project and deploy that project. The current contract exposes only the paths listed above; new upstream asset/API paths require adding an explicit proxy mapping.

Tests: `npm test` uses a fake upstream and an isolated database. Browser calculator integration checks can be run with the private environment file: `node --env-file=.env.calculator.local node_modules/@playwright/test/cli.js test tests/browser/calculator.spec.ts tests/browser/calculator-api.spec.ts`. These use read-only requests to the configured calculator; provider credentials are synthetic and stored only in the disposable browser test DB. They do not write upstream cost discounts.

## Company marketplace connections

Only the assigned inventory administrator can register, replace or disconnect company API credentials. Every signed-in employee can use shared product fees and refresh the read-only fee catalog. Credentials are AES-256-GCM encrypted using the server-only `CALCULATOR_API_ENCRYPTION_KEY` (64 hex characters), with the platform as authenticated context. Keys/tokens are never returned by GET, logged, or stored in browser storage. Keep a secure backup of the encryption key with encrypted database backups. The environment key is deliberately not included in source control.

- Naver: Commerce API Client ID and bcrypt-formatted Client Secret. SELF authentication, followed by `/v1/pay-settle/settle/commission-details`, by settlement basis date. Sum actual commission amounts once per original product order; use the largest commission-type basis to avoid counting the same sale twice. Payment-method splits are combined. Prefer normal originals to duplicated quick originals. Refund/delivery/other rows are excluded. Product rates are sale-basis-weighted historical estimates; inflow paths and payment means can affect future fees.
- Coupang: WING Access Key, Secret Key and Vendor ID. HMAC-signed `/v2/providers/openapi/apis/api/v1/revenue-history`, by recognition date. Use the sum of actual serviceFee, serviceFeeVat, couranteeFee and couranteeFeeVat divided by total saleAmount for each product, multiplied by 100. Duplicate SALE order/item records and refunds are excluded; missing monetary fields are not replaced by the latest nominal rate. Refund rows are excluded. Monthly marketplace fees, advertising and Rocket Growth charges are outside this product-fee estimate.

Model matching requires an exact SKU or a bounded full model name. Ambiguous matches require choosing an API product. Unknown models retain the clearly identified manual rate. The UI permits manual overrides and shows the source and sample period. New keys invalidate the prior catalog. Daily refreshes use the previous 7 KST dates; all refresh requests use exactly the previous 7 completed KST dates, including when the caller submits other dates. Pagination is complete or fails without replacing the prior snapshot. API failures preserve the last successful snapshot and display a warning. Shared refresh leases and revision checks prevent stale responses overwriting changed credentials. Normal employee refresh is rate-limited. Provider IP allowlists and API permissions must permit this deployment's server.

Official references:

- https://apicenter.commerce.naver.com/docs/auth
- https://apicenter.commerce.naver.com/docs/commerce-api/current/find-commission-details-pay-settle
- https://developers.coupang.com/ko/getting-started/creating-hmac-signature
- https://developers.coupang.com/ko/api/settlement/sales-detail-query

## Two seller accounts and unified price tables

Both providers expose independent seller slots 1 and 2. Credentials, revisions, fees and refresh leases are scoped by (platform,account). Legacy encrypted keys migrate to slot 1, and outdated nominal-rate snapshots are invalidated. Slot 2 uses a separate encryption context. Select the selling account in the calculator; rates are never silently combined between accounts. Both providers use sales-basis weighted averages (fee total / basis total * 100), with Naver settlement basis dates and Coupang recognition dates.

The Vercel app queues fee requests to the company PC connector. Run scripts/start-calculator-pc.ps1 to keep processing requests in the background or node node_modules/tsx/dist/cli.mjs scripts/calculator-pc.ts --once for one refresh. Restart the connector after PC reboot. All four connections are processed independently without logging credentials.

Price table presentation uses price-table.js and integration.css for stable tab/search positions, the same row spacing, and selectable column filters in printer, consumable and filter tables. Pricing and calculation JS continue to update from the external calculator server.
