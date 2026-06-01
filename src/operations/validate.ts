/**
 * Pre-confirm input validation for write operations.
 *
 * These checks run BEFORE the confirmation modal so an LLM passing
 * structurally invalid input (negative amount, "yesterday" as date,
 * empty party) gets a clean structured error and the human never sees
 * a junk preview to click "no" on.
 *
 * Validation is intentionally cheap and synchronous — no I/O, no Tally
 * calls. Deeper checks (does the party ledger actually exist? is the
 * date inside the FY?) belong in a later "preflight" step that needs
 * the Tally client.
 *
 * Wart fix: PR1 had the amount<=0 guard only in buildPostReceiptEnvelope,
 * which ran AFTER confirmWrite — the user was shown a "-₹10" preview
 * before the build-time guard fired. This module hoists those guards.
 */

import type { PostReceiptInput, PostPaymentInput } from "../envelopes.js";

/**
 * Thrown when an LLM-supplied write input fails structural validation.
 * Carries `code: "INVALID_INPUT"` + `field` so a tool wrapper can render
 * a focused message instead of a generic stack trace.
 */
export class WriteValidationError extends Error {
  readonly code = "INVALID_INPUT" as const;
  constructor(
    public readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = "WriteValidationError";
  }
}

function assertNonEmpty(field: string, value: string | undefined): void {
  if (value === undefined || value.trim() === "") {
    throw new WriteValidationError(field, `${field} must be a non-empty string.`);
  }
}

function assertPositiveFinite(field: string, value: number): void {
  if (!Number.isFinite(value)) {
    throw new WriteValidationError(field, `${field} must be a finite number, got ${value}.`);
  }
  if (!(value > 0)) {
    throw new WriteValidationError(field, `${field} must be positive, got ${value}.`);
  }
}

function assertIsoDate(field: string, value: string): void {
  // Wire-format (YYYYMMDD) also accepted because envelopes accept both,
  // but ISO is the canonical LLM-facing form.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) && !/^\d{8}$/.test(value)) {
    throw new WriteValidationError(
      field,
      `${field} must be YYYY-MM-DD, got "${value}". Example: "2026-06-01".`,
    );
  }
}

export function validatePostReceiptInput(input: PostReceiptInput): void {
  assertNonEmpty("company", input.company);
  assertNonEmpty("party", input.party);
  assertNonEmpty("destinationLedger", input.destinationLedger);
  assertIsoDate("date", input.date);
  assertPositiveFinite("amount", input.amount);
}

export function validatePostPaymentInput(input: PostPaymentInput): void {
  assertNonEmpty("company", input.company);
  assertNonEmpty("party", input.party);
  assertNonEmpty("sourceLedger", input.sourceLedger);
  assertIsoDate("date", input.date);
  assertPositiveFinite("amount", input.amount);
}
