# @zosmaai/pi-tally

> Production-grade pi extension for **TallyPrime** — semantic accounting tools, GST-aware math, bank reconciliation, bulk import, HTN-guided workflows, and four-ring write safety.

[![pi-package](https://img.shields.io/badge/pi-package-blue)](https://pi.dev/packages)
[![license: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![status: alpha](https://img.shields.io/badge/status-alpha-orange)]()

---

## What it does

Lets any LLM running inside [pi](https://pi.dev) operate TallyPrime safely and end-to-end:

- **Read** any ledger, voucher, report (Trial Balance, P&L, Balance Sheet, Day Book, Outstanding with aging)
- **Post** receipts, payments, journals, contras — with deterministic GST math for sales/purchase invoices
- **Bulk import** vouchers from CSV (Excel in v1.1)
- **Reconcile** bank statements against Tally — automatic match + suspense for the rest
- **Plan** monthly close as an HTN-decomposed checklist the LLM walks through with you

All write operations are gated by per-category switches (`masters`, `vouchers`, `bulk-import`, `raw-xml`), all default to **off**, and every write triggers a pre-submit confirmation panel.

## Install

```bash
pi install npm:@zosmaai/pi-tally
```

Then in any pi session:

```
/tally setup
```

The wizard probes Tally on `http://localhost:9000`, lists your companies, picks a default, warns if Tally is exposed on the LAN, and writes config to `~/.pi-tally/config.json`.

## Prerequisites

- TallyPrime installed and **running** (Windows; macOS/Linux not yet supported by Tally itself)
- HTTP/XML gateway enabled (`F1 → Settings → Connectivity → ODBC: Yes`, port 9000 — this is the default)
- At least one company loaded
- pi v0.x or later

## 30-second demo

```
You ▸ How are we doing financially?

pi  ▸ [calls tally_health]
       Connected to ZOSMAAI SOLUTIONS PRIVATE LIMITED (books from 1-Apr-2025).
       Write gates: all closed.

       [calls tally_get_report("TrialBalance"), ("ProfitLoss"), tally_get_outstanding("receivables")]

       Snapshot as of 31-May-2025:
       • Cash on hand: ₹0  | Bank: ₹4,12,500
       • Trade receivables: ₹2,34,000 (₹1,20,000 over 30 days — chase Acme & Beta)
       • Trade payables: ₹15,661
       • Revenue YTD: ₹6,80,000  | Net profit YTD: ₹2,15,500

       Want me to draft follow-up reminders for the overdue receivables?
```

## Safety model (the part that matters)

Four concentric rings. An LLM hallucination must breach all four to cause a wrong entry.

1. **Per-category write gates** — `masters` / `vouchers` / `bulk-import` / `raw-xml`. Default OFF. Persisted in `~/.pi-tally/config.json`.
2. **Pre-submit confirmation** on every write tool — shows parsed preview, not raw XML.
3. **Deterministic math** — LLM provides intent, TypeScript computes amounts. Off-by-one mechanically impossible.
4. **Data-role boundary** — file content from bulk-import and bank-statement is parsed before the LLM sees it. Defeats prompt-injection via doctored CSVs.

Plus: network bind warning, education-mode badges, idempotency keys, dual audit log.

Full details in [docs/plans/2026-06-01-pi-tally-design.md](docs/plans/2026-06-01-pi-tally-design.md).

## HTN-guided workflows

The bundled skill (`skills/pi-tally/SKILL.md`) teaches the LLM to **plan first, execute second**. Common tasks ship as canonical Hierarchical Task Networks the LLM consults before acting:

```
htn/
├── post-invoice.md
├── post-receipt.md
├── post-payment.md
├── post-journal.md
├── bulk-import-vouchers.md
├── reconcile-bank.md
├── month-end-close.md
├── party-statement.md
├── financial-snapshot.md
└── investigate-mismatch.md
```

You can drop your own HTN files in `.pi/pi-tally/htn/` to teach the LLM your firm's specific workflows. Community contributions are welcome via PR.

## Roadmap

| Version | Theme |
|---|---|
| **v0.1** *(now)* | Read-only MVP — health, companies, ledgers, reports, outstanding |
| **v0.2–0.5** | Write tools with full safety model, bulk import, bank reconciliation |
| **v1.0** | Daily ops + month-end close, full HTN library |
| **v2.0** | GSTR-1 / GSTR-3B prep, TDS Form 26Q workflow |
| **v2.5** | Inventory + stock journals |
| **v3.0** | Persona A — CA firm multi-client mode |
| **v3.5** | Payroll |
| **v4.0** | Custom TDL auto-deploy, DuckDB offline read-cache |

See the [design doc](docs/plans/2026-06-01-pi-tally-design.md) for the full module breakdown.

## Contributing

PRs welcome. Areas where help is especially valuable:

- HTN trees for industry-specific workflows
- Bank-statement parser mappings (HDFC, ICICI, SBI, Razorpay, Stripe, PayU, …)
- GST edge cases (composition scheme, mixed supply, RCM variations)
- Test fixtures from real (anonymized) Tally responses

## License

[MIT](LICENSE)
