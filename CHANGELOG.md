# Changelog

All notable changes to `@zosmaai/pi-tally` are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/), versioning follows [SemVer](https://semver.org/).

## [Unreleased]

### Added — v0.2 foundations (PR1: Ring 1 + Ring 2 stub + audit log + CI)
- **Ring 1 — write gates**: `assertGate(cfg, category)` + `TallyWriteBlockedError` (code `GATE_CLOSED`) in `src/safety/gates.ts`. Every v0.2 write tool will call this as its first line.
- **Ring 2 stub — confirmation panel**: `confirmWrite(ctx, preview, auditDir)` + `renderPreview()` in `src/ui/confirm.ts`. Deterministic preview body; never shows raw XML.
- **Audit log**: append-only JSONL at `~/.pi-tally/audit/YYYY-MM.jsonl` (`src/audit/log.ts`). `appendAuditEvent` / `readAuditEvents` / `auditFileFor`. Monthly partitions, corrupt-line tolerance.
- **`/tally audit tail [n]`** subcommand and gate toggles now emit `gate.opened` / `gate.closed` / `gate.open-declined` events.
- **vitest + fast-check** wired (`vitest.config.ts`). 23 unit tests across `test/safety/`, `test/audit/`, `test/ui/`.
- **CI**: `.github/workflows/ci.yml` matrix on Node 20 + 22 running `typecheck` + `test`.

### Added — v0.1 MVP (read-only)
- TallyClient transport layer (XML over HTTP, Prime 7.0+ JSON auto-detect)
- Read tools: `tally_health`, `tally_list_companies`, `tally_use_company`, `tally_list_ledgers`, `tally_list_groups`, `tally_list_voucher_types`, `tally_list_vouchers`, `tally_get_voucher`, `tally_get_report`, `tally_get_outstanding`, `tally_query_collection`
- `/tally setup` interactive wizard
- `/tally health` command
- Network bind warning on `0.0.0.0`
- Education-mode auto-detect
- SKILL.md with pre-flight protocol and output style
- First HTN trees: `financial-snapshot.md`, `party-statement.md`, `post-receipt.md`

### Roadmap (not yet released)
- v0.2: write-gate framework + `tally_create_ledger`, `tally_post_receipt`, `tally_post_payment`
- v0.3: GST math + `tally_post_sales_invoice`, `tally_post_purchase`, `tally_post_debit_note`, `tally_post_credit_note`
- v0.4: bulk import + bank reconciliation
- v0.5: month-end close HTN + dual audit log
- v1.0: full v1 scope per [docs/plans/2026-06-01-pi-tally-design.md](docs/plans/2026-06-01-pi-tally-design.md)

Short-horizon execution plan lives in [`docs/NEXT_STEPS.md`](docs/NEXT_STEPS.md).
