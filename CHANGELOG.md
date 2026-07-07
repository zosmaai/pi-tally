# Changelog

All notable changes to `@zosmaai/pi-tally` are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/), versioning follows [SemVer](https://semver.org/).

## [Unreleased]

### Fixed — false "Education mode" from company names
- **`tally_health` no longer infers edition from company names.** Previously `isEducationMode` was set when any loaded company name matched `/educational|sample|company demo/i`. A real, licensed company literally named **"PHOENIX EDUCATIONAL INSTITUTE PRIVATE LIMITED"** tripped the regex, so a genuine **Silver** license was reported as *Educational Mode*.
- Edition is now resolved **authoritatively** from Tally's own `$$LicenseInfo` function (`IsEducationalMode`, `IsSilver`, `IsGold`, `SerialNumber`, `AccountId`). Company names are never consulted.
- `tally_health` output now shows an **Edition** line (e.g. `Edition: Silver (Serial 784409490, arjun@zosma.ai)`); `Unknown` when Tally does not report `$$LicenseInfo`.

### Added — license probe plumbing
- `src/envelopes.ts`: `buildLicenseInfoEnvelope(param)` — `Export`/`Function` request for `$$LicenseInfo` with a `<PARAM>`.
- `src/parse.ts`: `parseLicenseInfoResult()` + `parseTallyLogical()`.
- `src/client.ts`: `licenseInfo(param)` and `probeLicense()` (returns a typed `LicenseProbe`).
- `src/types.ts`: `LicenseProbe`, `TallyEdition`; `HealthInfo` gains `edition`, `licenseSerial`, `licenseAccountId`.
- `src/tools/read/health.ts`: exported pure `deriveEdition(license)`.
- **11 new tests** (`test/parse/license.test.ts`) incl. the exact regression: an `EDUCATIONAL`-named company must not flip a Silver license. **102/102 green.**

### Added — v0.2 PR2 (LLM-callable write tools)
- **`tally_post_receipt`**, **`tally_post_payment`**, **`tally_reverse_voucher`** are now registered via `pi.registerTool()` and exposed to the LLM in a fresh `pi` session. All three live under `src/tools/write/` and consume the operation layer.
- `src/envelopes.ts`: `buildPostPaymentEnvelope()` (mirror of Receipt with Dr/Cr swapped) + `PostPaymentInput` type. **10 wire-shape tests**.
- `src/operations/post-payment.ts`: `postPayment()` follows the same ring flow as `postReceipt`; preview reads "Pay X to Party from Source".
- `src/operations/reverse-voucher.ts`: `reverseReceiptVoucher()` — thin wrapper that posts an offsetting Payment with auto-generated narration linking back to the original. Production path for undoing a receipt (TallyPrime's XML gateway cannot truly delete vouchers).
- `src/operations/validate.ts`: `validatePostReceiptInput` / `validatePostPaymentInput` + `WriteValidationError { code: "INVALID_INPUT", field }`. Wired into both ops so structural errors (negative amount, malformed date, empty party) throw BEFORE the confirm modal renders. **13 validation tests**.
- `src/parse.ts`: `parseTallyError` extended to flag `STATUS=0` + no error tag as a silent-reject (the exact bug that bit us in PR1.5). Order-preserves explicit `LINEERROR`/`ERRORMSG` over the generic hint. **6 tests**.
- 4 new test files (post-payment env, validate, post-receipt-flow, post-payment, reverse-voucher): **91/91 tests green**, up from 46.

### Fixed — v0.2 PR2
- **Validation order wart**: negative amounts no longer reach the confirm modal. `postReceipt` and `postPayment` now run `validatePostXInput()` immediately after `assertGate()`, before any UI call.
- **Silent-reject detection**: TallyPrime responses with `STATUS=0` and no error tag now raise a `TallyError` instead of being treated as success.

### Added — v0.2 PR1.5 (first real write path, demoed end-to-end)
- `src/envelopes.ts`: `buildPostReceiptEnvelope()` + `tallyAmount()`. **17 envelope-shape tests** lock the wire format (sign convention, ISDEEMEDPOSITIVE, bill allocation, XML escaping, no VOUCHERNUMBER, etc).
- `src/operations/post-receipt.ts`: `postReceipt()` ties all rings together (assertGate → confirmWrite → envelope build → client.send → audit). Includes `parsePostVoucherResponse()` with success/no-op detection.
- `scripts/manual-post-receipt.mjs`: live 5-scenario demo (gate closed, decline, dry-run, real submit, audit tail).
- `scripts/manual-post-bonus.mjs`: generalisation demo across multiple parties + destinations, plus client-side validation of bad inputs.
- `scripts/diagnose-receipt.mjs`: debug utility for envelope variants.
- **Lesson learned (the hard way):** the HEADER must include `<ID>Vouchers</ID>` for voucher imports. Without it, TallyPrime silently returns `<STATUS>0</STATUS>` with empty BODY, no LINEERROR. Codified in tests so it can never regress.
- Verified live: vouchers 446 (₹1 FOODSTORIES → Cash), 447 (₹5 SENSALABS LLP → ICICI BANK), 448 (₹2.50 DASHFIT → Cash) all posted to ZOSMAAI test books with correct double-entry math.
- **Cleanup proven:** `scripts/find-voucher-guids.mjs` + `scripts/probe-delete-variants.mjs` + `scripts/reverse-test-vouchers.mjs` walk through Tally's hostile delete API. Books restored to exact baseline via reversal Payment vouchers (452, 453, 454) — the textbook accounting fix. Lessons captured in memex (delete-via-XML doesn't work; use reversal entries; `TAGNAME=MasterID TAGVALUE=N Action=Alter ISDELETED=Yes` is accepted but doesn't actually delete).
- `tsx` added as dev dep (`scripts/*.mjs` import `.ts` sources directly; Node's strip-types can't handle parameter properties).

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
- v0.2: write-gate framework + `tally_create_ledger` (`tally_post_receipt`, `tally_post_payment`, `tally_reverse_voucher` shipped in PR2)
- v0.3: GST math + `tally_post_sales_invoice`, `tally_post_purchase`, `tally_post_debit_note`, `tally_post_credit_note`
- v0.4: bulk import + bank reconciliation
- v0.5: month-end close HTN + dual audit log
- v1.0: full v1 scope per [docs/plans/2026-06-01-pi-tally-design.md](docs/plans/2026-06-01-pi-tally-design.md)

Short-horizon execution plan lives in [`docs/NEXT_STEPS.md`](docs/NEXT_STEPS.md).
