# Sales and rental calculator

Adapted from the user-provided `best.zip` (2026-10-02). The HTML/CSS/JS preserve its store rates, sale-margin formula, rental pricing, model matching, price tables and rental history. The calculator runs in a same-origin frame to isolate its stylesheet from the inventory app.

All content and catalog routes require the inventory session and use private/no-store responses. Browser preferences and rental history are scoped to the authenticated account ID. Price data is never placed under `public/`.

`catalog.json` is a generated snapshot of the supplied August base workbook and September update workbook. Source SHA-256 hashes are included. Excel imports preserve cached values, highlighted toner/consumable rules, VAT distinctions and the supplied rounding behavior. They do not change source workbooks or inventory data.

To replace price data, place the authorized workbooks in a local folder and run:

```
python scripts/import-calculator.py <workbook-folder> src/calculator/catalog.json
```

Requires Python and openpyxl 3.1.5 only for importing, not on Vercel. Review and redeploy the generated catalog when prices change. Original archives, virtual environments, repositories and workbooks are not deployed.
