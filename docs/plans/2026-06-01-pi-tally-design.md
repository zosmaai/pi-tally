# pi-tally — Design Document

**Status:** validated 2026-06-01
**Author:** zosmaai
**Package:** `@zosmaai/pi-tally`
**License:** MIT

---

## 1. Purpose

A production-grade pi extension that lets an LLM operate **TallyPrime** (India's dominant SMB accounting software) safely and end-to-end. Ships as a single npm package, installable with `pi install npm:@zosmaai/pi-tally`. No Python, no external services.

## 2. Primary persona (v1)

**In-house finance / accounts executive (Persona C)**, with a thin **business-owner natural-language layer (Persona B)** that emerges naturally from C's semantic tools.

Persona A — Chartered Accountants / multi-client tax pros — is roadmapped to v3 (see §11).

## 3. Scope envelope (v1)

| Bucket | In v1 | Why |
|---|---|---|
| Read everything (companies, ledgers, vouchers, reports) | ✅ | Baseline. Read tools always on. |
| Create masters (ledgers, groups) | ✅ gated | Low risk, daily need |
| Create transactional vouchers (Receipt, Payment, Contra, Journal) | ✅ gated | The 60% of daily entry |
| Sales / Purchase / DN / CN with GST | ✅ gated | The other 35% of daily entry |
| Bulk import from CSV | ✅ gated | The #1 accountant pain |
| Bank reconciliation (BRS) | ✅ gated | Weekly pain |
| AR / AP aging | ✅ | Monthly necessity |
| Month-end close checklist | ✅ | Closes the loop |
| GST return filing prep | ❌ → v2 | Needs portal API + JSON-spec work |
| TDS workflow (Form 26Q) | ❌ → v2 | Quarterly, narrower audience |
| Multi-company hot-switch | ✅ minimal | One command, no UI bloat |
| Inventory (stock items, manufacturing) | ❌ → v2.5 | Vertical-specific |
| Payroll | ❌ → v3 | Narrow audience, heavy compliance |

## 4. Architecture

Five-layer extension. Top-down dependency. Each layer independently testable.

```
LLM (Claude / GPT-5 / etc.)
   │
   ▼  ~25 semantic tool calls
┌────────────────────────────────────────────┐
│ Tools layer        — schema-validated      │
│ Safety layer       — gates, confirms, log  │
│ Domain layer       — GST calc, BRS matcher │
│ Envelope layer     — versioned XML/JSON    │
│ Transport layer    — TallyClient + fetch   │
└──────────────────┬─────────────────────────┘
                   │  XML or JSON over HTTP
                   ▼
        http://localhost:9000  (TallyPrime gateway)
```

**Why "own the XML client" beat every alternative:** evaluated REST (doesn't exist), official SDK (doesn't exist), JSON-Prime-7.0 (still same envelopes), ODBC (read-only, fragile), `tallyprime-js-sdk` (single-author, immature), `tally-mcp`/`TallyBridge` (Python, breaks npm-install promise). A tight ~300 LoC TypeScript client owned by us beats them all on robustness, footprint, and longevity. See ADR-001 in this folder.

## 5. Tool surface (v1, 25 tools)

### 5.1 Read (always on, 11 tools)

| Tool | Returns |
|---|---|
| `tally_health` | Gateway up, version, loaded companies, active company, books range, write-gate state |
| `tally_list_companies` | All loaded companies + financial year |
| `tally_use_company` | Set active company for the session |
| `tally_list_ledgers` | Filter by group / non-zero balance / name pattern |
| `tally_list_groups` | Account group hierarchy |
| `tally_list_voucher_types` | Built-in + user-defined voucher types |
| `tally_list_vouchers` | Filter by date / type / ledger / party |
| `tally_get_voucher` | Full voucher by GUID |
| `tally_get_report` | Enum: TrialBalance, DayBook, BalanceSheet, ProfitLoss, CashBook, BankBook, StockSummary |
| `tally_get_outstanding` | Enum: receivables, payables — with aging buckets (0-30/31-60/61-90/90+) |
| `tally_query_collection` | Power-user: raw collection + fetch fields |

### 5.2 Write — masters gate (2 tools)

| Tool | Behavior |
|---|---|
| `tally_create_ledger` | Name, parent group, GST regn, opening balance |
| `tally_create_group` | Name, parent, nature |

### 5.3 Write — vouchers gate (9 tools, semantic, deterministic math)

| Tool | Math handled by TypeScript |
|---|---|
| `tally_post_receipt` | Reconciles bill references |
| `tally_post_payment` | Reconciles bill references |
| `tally_post_contra` | Transfer between cash / bank |
| `tally_post_journal` | Arbitrary debit/credit pairs |
| `tally_post_sales_invoice` | GST regime → CGST+SGST / IGST / 0% / RCM |
| `tally_post_purchase` | Same GST split, reverse direction |
| `tally_post_debit_note` | Purchase return, GST adjustment |
| `tally_post_credit_note` | Sales return, GST adjustment |
| `tally_cancel_voucher` | By GUID |

### 5.4 Write — bulk-import gate (4 tools)

| Tool | |
|---|---|
| `tally_bulk_import_vouchers` | CSV + mapping config; LLM never sees raw rows |
| `tally_load_bank_statement` | Loads + parses CSV, stores in memory |
| `tally_propose_brs` | Match algorithm: date ±3, amount exact, narration fuzzy |
| `tally_apply_brs` | Posts unmatched to suspense; flagged for review |

### 5.5 Escape hatch (loudest gate, 1 tool)

| Tool | |
|---|---|
| `tally_raw_xml` | Send any envelope. Requires `--tally-allow-raw-xml` flag at launch. |

## 6. Safety model

Four concentric rings. An LLM hallucination must breach all four to cause a wrong entry.

1. **Per-category write gates** — `masters` / `vouchers` / `bulk-import` / `raw-xml`. Default OFF. Persisted in `~/.pi-tally/config.json` (user) and overridable in `.pi/pi-tally.json` (project).
2. **`ctx.ui.confirm()` per write** — every write tool renders a parsed preview before submit. `confirmMode` config: `"off" | "writes" | "all"`. Default: `"writes"`.
3. **Deterministic math** — LLM provides intent (party, base amount, GST regime); TypeScript computes line amounts, tax splits, totals, rounding. Off-by-one is mechanically impossible.
4. **Data-role boundary** — bulk-import and bank-statement file contents are parsed first, then injected into the LLM context as structured `data` blocks, never as text. Defeats prompt-injection via doctored CSVs.

### Passive layers

- **Network bind warning** on `session_start` if Tally is listening on `0.0.0.0` (it is, by default — see ADR-002).
- **Education-mode badge** — if connected to an Education company, every write tool gets a `[EDU]` badge in the TUI; date restrictions are validated client-side.
- **Pre-flight validation** of dates (YYYYMMDD), amounts (numeric, positive base), voucher type existence, and party-ledger existence — catches 90% of `LINEERROR` cases before they hit Tally.
- **Idempotency keys** — every voucher carries `KEY = hash(date|type|party|lines)`. Re-running detects duplicates and asks the user.
- **Dual audit log** — `pi.appendEntry("tally-write")` for in-session traceability, plus `~/.pi-tally/audit/YYYY-MM-DD.jsonl` for regulatory/cross-session needs.

## 7. Skill (LLM navigation manual)

Ships at `skills/pi-tally/SKILL.md` inside the package. Pi auto-discovers it on install.

Contents:

- **When to use** — any TallyPrime task
- **Boundaries** — read live data yes; write gated; out of scope (filing, payroll) in v1
- **Pre-flight protocol** — MUST call `tally_health` first; switch company if user mentions a different one; ask user to open the gate if write is needed
- **HTN task library reference** (see §8)
- **Workflow recipes** — top 10 v1 recipes with worked examples
- **Output style conventions** — ₹ + Indian numbering, DD-MMM-YYYY for humans, YYYYMMDD for tools, ▲/▼ for Dr/Cr
- **Anti-patterns** — don't use `tally_raw_xml` unless explicitly asked; never compute GST amounts yourself; never post to suspense silently; never invent voucher numbers

## 8. HTN planning

`skills/pi-tally/htn/` ships canonical task decompositions. Each `.md` file is a tree of `compound → method → primitive`. The skill instructs the LLM to **plan first, execute second**.

### v1 task library (10 trees)

```
htn/
├── post-invoice.md           Sales / Purchase / DN / CN
├── post-receipt.md           Customer receipt / advance
├── post-payment.md           Supplier payment / expense
├── post-journal.md           Accruals / prepayments / corrections
├── bulk-import-vouchers.md   Excel/CSV → vouchers
├── reconcile-bank.md         BRS with suspense
├── month-end-close.md        Top-level compound — 8 subtasks
├── party-statement.md        Ledger outstanding + ageing
├── financial-snapshot.md     Multi-report synthesis
└── investigate-mismatch.md   "Trial balance doesn't tie — find why"
```

### HTN file format

Plain Markdown with a structured fenced block. Example:

````markdown
# reconcile-bank — Bank Reconciliation

```htn
TASK: ReconcileBank(month, bankLedger)
  precond: writes-gate(vouchers) enabled
  method: standard-brs
    1. tally_list_vouchers(bankLedger, month)        [primitive]
    2. tally_load_bank_statement(file, bankLedger)   [primitive]
    3. tally_propose_brs(asOf=monthEnd)              [primitive]
    4. ReviewMatches                                 [compound]
         method: present-and-classify
           a. show matched pairs (no action)
           b. for each unmatched bank line:
                ClassifyUnmatched                    [compound]
                  methods:
                    - missing-receipt → tally_post_receipt
                    - missing-payment → tally_post_payment
                    - bank-charge     → tally_post_payment(Bank Charges)
                    - interest        → tally_post_receipt(Interest)
                    - transfer        → tally_post_contra
                    - unknown         → leave in suspense
    5. tally_apply_brs(brsId)                        [primitive, gated]
```
````

This format is a first-class extension point: community can contribute task trees as PRs without touching code. Future LLMs can be fine-tuned on the fenced `htn` blocks.

### v2 / v3 task library (roadmapped)

```
htn/v2/
├── gst-return-prep.md        GSTR-1 + GSTR-3B reconciliation
├── tds-deduct-and-pay.md     Form 26Q workflow
├── close-financial-year.md   Annual close
├── audit-preparation.md      Trial → adjustments → final
└── payroll-month.md          Salary processing

htn/v3/
└── multi-client-rounds.md    (persona A) batch across N companies
```

## 9. Project layout

```
pi-tally/
├── package.json              keywords: pi-package, tally, accounting, gst, india, htn
├── tsconfig.json
├── LICENSE                   MIT
├── README.md
├── CHANGELOG.md
├── docs/
│   ├── plans/                this design doc + ADRs
│   ├── adr/
│   │   ├── 001-own-the-xml-client.md
│   │   ├── 002-network-bind-warning.md
│   │   ├── 003-htn-file-format.md
│   │   └── 004-data-role-boundary.md
│   └── images/               screenshots for README
├── src/
│   ├── index.ts              extension entry — registers tools + commands
│   ├── client.ts             TallyClient (fetch + XML build/parse + errors)
│   ├── envelopes.ts          pure builders, one per request type
│   ├── parse.ts              XML → typed objects
│   ├── types.ts              Ledger, Group, Voucher, Report shapes
│   ├── config.ts             load/save ~/.pi-tally/config.json
│   ├── audit.ts              dual audit log
│   ├── safety.ts             gates, confirms, validators
│   ├── setup.ts              /tally setup wizard
│   ├── commands.ts           /tally health, use-company, enable-writes, ...
│   ├── domain/
│   │   ├── gst.ts            intra/inter/export/RCM split + rounding
│   │   ├── brs.ts            matcher: date ±3, amount, narration
│   │   ├── aging.ts          0-30 / 31-60 / 61-90 / 90+
│   │   └── idempotency.ts    KEY hash + dedupe
│   └── tools/
│       ├── read/             11 read tools
│       ├── write/            11 write tools
│       └── escape/           tally_raw_xml
├── skills/
│   └── pi-tally/
│       ├── SKILL.md
│       └── htn/              10 task trees
├── test/
│   ├── unit/                 builders, parsers, gst, brs, aging
│   ├── fixtures/             golden XML samples
│   └── integration/          runs against Tally Education Mode
└── examples/
    ├── month-end-close.md
    ├── voucher-from-invoice.md
    └── bank-reconciliation.md
```

## 10. Testing strategy

1. **Unit tests** — `vitest`, golden XML fixtures. Every envelope shape, every parser, every domain function (GST split, BRS matcher, aging buckets, idempotency key).
2. **Integration tests** — run against **TallyPrime Education Mode** (free, no license cost, runs in CI Windows runners). Education Mode restricts voucher dates to the 1st, 2nd, and last day of each month — our test harness uses those.
3. **Snapshot tests** — TUI render output for each tool's `renderResult`.
4. **Property tests** — fast-check, for GST math: for any base amount + rate combination, `CGST + SGST == IGST == base * rate` exactly (rupee rounding rules respected).

CI: GitHub Actions, matrix on Node 20 / 22, Windows + Linux (transport-only on Linux, integration on Windows).

## 11. Roadmap

| Version | Theme | New modules | Weeks |
|---|---|---|---|
| **v1.0** | Daily ops + month-end close | 25 tools, 10 HTN trees, full safety, dual audit log | 6 |
| **v1.1** | Polish | Excel (.xlsx) import via SheetJS, more bank-statement mappings, TUI improvements | 2 |
| **v2.0** | GST + TDS | `gst_prepare_gstr1`, `gst_reconcile_3b`, `tds_deduct`, `tds_form_26q_export`; 5 new HTN trees | 6 |
| **v2.5** | Inventory | Stock items, stock journals, stock summary; HTN for stock-take | 4 |
| **v3.0** | Persona A — CA firm | Multi-client roster, per-client write-gate, batch operations across N companies, audit-prep workflow | 6 |
| **v3.5** | Payroll | Salary processing, PF/ESI/PT, payslip generation | 4 |
| **v4.0** | Advanced | Custom TDL auto-deploy for fields not in standard API; DuckDB read-cache for offline analytics | 6 |

## 12. Distribution

- **npm**: `@zosmaai/pi-tally`, published from `main` branch on tag
- **Pi gallery**: tagged `pi-package` with `image:` preview in `package.json`
- **README** with screenshots, install one-liner, "first 5 minutes" worked example
- **Repo**: `github.com/zosmaai/pi-tally`, issues + discussions open
- **License**: MIT
- **Versioning**: semver. v1.0 stable, v0.x for pre-release

## 13. Non-goals (v1)

Explicitly out of scope:

- Filing GST returns to the portal (we prepare data; humans file)
- E-invoicing / e-way bill API
- Payroll processing
- Inventory beyond stock summary
- Multi-client CA-firm workflows
- Non-India tax regimes
- TallyServer (multi-user network mode)
- Tally on AWS / Tally.NET subscriptions
- DuckDB read-cache (v4)

## 14. Open questions (to revisit at end of v1)

- **DuckDB cache**: do users actually want it, or is live Tally fast enough?
- **Skill format**: stick with prose Markdown + fenced HTN, or move HTN to YAML?
- **Multi-company UX**: hot-switch command vs always-prefix every tool with `company`?
- **Tally upgrades**: how to test against future Tally Prime versions before they ship?

---

## ADR index

- ADR-001 — Own the XML client (not wrap a third-party library)
- ADR-002 — Network bind warning on `0.0.0.0`
- ADR-003 — HTN file format
- ADR-004 — Data-role boundary for file inputs
