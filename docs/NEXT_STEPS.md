# Next Steps

Live working list of what comes next for `@zosmaai/pi-tally`. Updated as items land.

The big-picture roadmap lives in [`plans/2026-06-01-pi-tally-design.md`](plans/2026-06-01-pi-tally-design.md) and the table in [`../README.md`](../README.md#roadmap). This file is the **short-horizon execution plan**: what's already shipped in `main`, what's actively next, and how to pick something up.

---

## Status snapshot

**Shipped in v0.1 (current `main`)**
- TallyClient with own XML envelope build/parse (no external deps for the wire)
- Read tools: `tally_health`, `tally_companies`, `tally_use_company`, `tally_get_ledgers`, `tally_get_report`, `tally_get_outstanding`
- Pi extension entry (`src/index.ts`) wiring tools + `/tally setup` command
- Skill (`skills/pi-tally/SKILL.md`) with three canonical HTN trees: `financial-snapshot`, `month-end-close`, `post-receipt`
- Design doc + 4 ADRs
- Smoke test (`test/smoke-live.mjs`) for a live Tally on `localhost:9000`

**Not yet implemented** — every write tool, every safety ring beyond the manifest-level statement, bulk import, bank reconciliation, GST math module.

---

## v0.2 — write foundations + safety rings (target: 2–3 weeks)

Goal: end the read-only era with the *smallest* possible safe write surface and **all four safety rings live** before any tool can post.

### Must-land before any write tool

These are non-negotiable. A write tool merged without them is a revert.

- [x] **Ring 1 — per-category write gates** (`src/safety/gates.ts`) — shipped PR1
  - Persisted gates in `~/.pi-tally/config.json` (already in v0.1)
  - `assertGate(cfg, category)` throws `TallyWriteBlockedError { code: "GATE_CLOSED", category, userAction }`
  - Toggled via `/tally enable-writes <category>` / `/tally disable-writes <category>` (existing v0.1 commands now emit audit events)
- [x] **Ring 2 stub — pre-submit confirmation** (`src/ui/confirm.ts`) — shipped PR1
  - `confirmWrite(ctx, preview, auditDir)` + deterministic `renderPreview()`
  - Uses host `ctx.ui.confirm()` modal; richer pi-tui panel deferred until first write tool needs it
  - Both accept and decline write an audit event (`write.confirmed` / `write.declined`)
- [ ] **Ring 3 — deterministic math module** (`src/money/`)
  - `gst.ts`: intra/inter classification, slab table, reverse charge, cess
  - `inr.ts`: integer-paisa arithmetic, Indian-numbering formatter (already used in read path — promote here)
  - **Property tests** in `test/money/` with `fast-check` — already a dev dep
  - LLM passes intent (`{ party, items, gstMode }`); module returns line items + totals. Off-by-one mechanically impossible.
- [ ] **Ring 4 — data-role boundary** (`src/import/parse-boundary.ts`)
  - CSV / bank-statement files parsed to a typed structure **before** any LLM-visible string is produced
  - Parsed rows are tool-result data, not prompt text
  - ADR-004 already specifies the contract — implement it

### First write tools (depend on rings above)

Ordered by minimum-blast-radius first. Each is its own PR; each adds its HTN.

- [~] `tally_post_receipt` core (`src/operations/post-receipt.ts`) shipped PR1.5 — demoed live with vouchers 446/447/448 against ZOSMAAI test books. Still needs:
  - LLM-callable `registerTool("tally_post_receipt", ...)` wiring in `src/tools/write/` so a fresh pi session exposes it
  - HTN already exists at `skills/pi-tally/htn/post-receipt.md`
  - **Bug:** preview shows bogus amounts (e.g. -₹10) and asks for confirmation BEFORE the build-time positive-amount guard fires. Move validation into the preview step so the user never sees an invalid preview.
- [ ] `tally_post_payment` + HTN — mirror of receipt with Dr/Cr swapped
- [ ] `tally_post_journal` + HTN
- [ ] `tally_post_contra` + HTN

### Quality-of-life

- [ ] `idempotency.ts` — write tools accept optional `idempotencyKey`; client de-dups against a small on-disk SQLite/JSON index
- [~] Dual audit log: human-readable JSONL in `~/.pi-tally/audit/YYYY-MM.jsonl` shipped PR1; machine-grep XML in `~/.pi-tally/audit/raw/` deferred until first write tool produces XML
- [x] CI: GitHub Actions matrix on Node 20 + 22 running `npm run typecheck` and `npm test` — shipped PR1 (`.github/workflows/ci.yml`)
- [ ] Publish `0.2.0-alpha.0` to npm (`npm publish --access public --tag alpha`)

---

## v0.3 — bulk + reconcile (target: +3 weeks after v0.2)

- [ ] `tally_bulk_import_vouchers` — CSV in, vouchers out, gated by `bulkImport`
  - Mapping presets in `presets/` (open question: ship community mappings here vs. separate package)
  - Per-row pre-submit summary panel (not per-voucher)
- [ ] `tally_reconcile_bank` — present-and-classify per HTN tree in design doc §8
  - Statement parsers: HDFC, ICICI, SBI to start. PRs welcome for others.
  - HTN `reconcile-bank.md` (referenced in README but not yet written)
- [ ] Suspense ledger auto-create on first use, with explicit user opt-in
- [ ] HTN `bulk-import-vouchers.md`

---

## v0.4–v0.5 — remaining canonical HTNs

Stub list — flesh out as v0.2 lands and we learn what the LLM actually struggles with:

- [ ] `party-statement.md`
- [ ] `investigate-mismatch.md`
- [ ] `post-invoice.md` (sales + purchase variants, GST-aware)
- [ ] `post-payment.md`
- [ ] `post-journal.md`

---

## Cross-cutting / always-on

- [ ] **Network-bind warning** (ADR-002) currently only described — implement the probe + first-run banner
- [ ] **Education mode badges** in confirmation panel (explain *why* a journal balances, GST flow)
- [ ] **Telemetry: none.** Keep it that way. If we ever add it, opt-in only, separate ADR, separate package.
- [ ] **Docs site?** Defer until v1.0. README + `docs/` is enough for now.

---

## How to pick something up

1. Open a GitHub issue describing the slice you want to ship (one ring, one tool, one HTN).
2. Reference the relevant ADR(s) and the line in this file.
3. Branch `feat/<short-name>`, PR into `main`, squash-merge.
4. Update this file in the same PR — check the box, or add new sub-items you discovered.

When a section is fully shipped, move it under a `## Done` heading at the bottom rather than deleting (kept for traceability until the next minor release, then dropped to keep this file short).

---

## Done

### PR1 — Ring 1 + Ring 2 stub + audit log + CI (2026-06-01, branch `feat/ring-1-gates-and-audit`)
- `src/safety/gates.ts` with `assertGate` + `TallyWriteBlockedError`
- `src/ui/confirm.ts` with `confirmWrite` + `renderPreview`
- `src/audit/log.ts` with monthly-rotated JSONL append-only log
- `commands.ts` wired: gate toggles emit audit events; new `/tally audit tail [n]`
- `vitest.config.ts` + 23 unit tests (safety, audit, ui)
- `.github/workflows/ci.yml` Node 20 + 22 matrix
