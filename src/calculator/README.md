# Sales and rental calculator

Adapted from the user-provided `best.zip` (2026-10-02). The HTML/CSS/JS preserve its sale-margin formula, rental pricing, model matching, price tables and rental history. The calculator runs in a same-origin frame to isolate its stylesheet from the inventory app. API connection settings replace dark mode.

All content and catalog routes require the inventory session and use private/no-store responses. Browser preferences and rental history are scoped to the authenticated account ID. Price data is never placed under `public/`.

`catalog.json` is a generated snapshot of the supplied August base workbook and September update workbook. Source SHA-256 hashes are included. Excel imports preserve cached values, highlighted toner/consumable rules, VAT distinctions and the supplied rounding behavior. They do not change source workbooks or inventory data.

To replace price data, place the authorized workbooks in a local folder and run:

```
python scripts/import-calculator.py <workbook-folder> src/calculator/catalog.json
```

Requires Python and openpyxl 3.1.5 only for importing, not on Vercel. Review and redeploy the generated catalog when prices change. Original archives, virtual environments, repositories and workbooks are not deployed.

## Company marketplace connections

Only the assigned inventory administrator can register, replace or disconnect company API credentials. Every signed-in employee can use shared product fees and refresh the read-only fee catalog. Credentials are AES-256-GCM encrypted using the server-only `CALCULATOR_API_ENCRYPTION_KEY` (64 hex characters), with the platform as authenticated context. Keys/tokens are never returned by GET, logged, or stored in browser storage. Keep a secure backup of the encryption key with encrypted database backups. The environment key is deliberately not included in source control.

- Naver: Commerce API Client ID and bcrypt-formatted Client Secret. SELF authentication, followed by `/v1/pay-settle/settle/commission-details`, by settlement basis date. Sum actual commission amounts once per original product order; use the largest commission-type basis to avoid counting the same sale twice. Payment-method splits are combined. Prefer normal originals to duplicated quick originals. Refund/delivery/other rows are excluded. Product rates are sale-basis-weighted historical estimates; inflow paths and payment means can affect future fees.
- Coupang: WING Access Key, Secret Key and Vendor ID. HMAC-signed `/v2/providers/openapi/apis/api/v1/revenue-history`, by recognition date. Use the latest SALE item rate (`serviceFeeRatio`, plus Courantee if present) and add 10% fee VAT. Refund rows are excluded. Monthly marketplace fees, advertising and Rocket Growth charges are outside this product-fee estimate.

Model matching requires an exact SKU or a bounded full model name. Ambiguous matches require choosing an API product. Unknown models retain the clearly identified manual rate. The UI permits manual overrides and shows the source and sample period. New keys invalidate the prior catalog. Daily refreshes use the previous 7 KST dates; manual refresh supports up to 31 days. Pagination is complete or fails without replacing the prior snapshot. API failures preserve the last successful snapshot and display a warning. Shared refresh leases and revision checks prevent stale responses overwriting changed credentials. Normal employee refresh is rate-limited. Provider IP allowlists and API permissions must permit this deployment's server.

Official references:

- https://apicenter.commerce.naver.com/docs/auth
- https://apicenter.commerce.naver.com/docs/commerce-api/current/find-commission-details-pay-settle
- https://developers.coupang.com/ko/getting-started/creating-hmac-signature
- https://developers.coupang.com/ko/api/settlement/sales-detail-query
