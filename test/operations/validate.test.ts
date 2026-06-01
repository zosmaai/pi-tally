/**
 * Pre-confirm validation for write operations.
 *
 * Wart fixed: in PR1 the build-time guard inside buildPostReceiptEnvelope
 * rejected amount<=0, but only AFTER confirmWrite had already shown the
 * preview modal with an invalid amount. The human shouldn't have to look at
 * "-₹10" in a modal and reject it — the operation should never get that far.
 *
 * `validatePostReceiptInput` runs cheap, synchronous checks before any I/O
 * or UI and throws WriteValidationError with a structured field/reason.
 */

import { describe, expect, it } from "vitest";
import {
  validatePostReceiptInput,
  validatePostPaymentInput,
  WriteValidationError,
} from "../../src/operations/validate.js";

const validReceipt = {
  company: "Co",
  party: "Acme",
  destinationLedger: "Cash",
  date: "2026-06-01",
  amount: 100,
};

describe("validatePostReceiptInput", () => {
  it("accepts a well-formed input", () => {
    expect(() => validatePostReceiptInput(validReceipt)).not.toThrow();
  });

  it("rejects amount <= 0 with structured error", () => {
    try {
      validatePostReceiptInput({ ...validReceipt, amount: -10 });
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(WriteValidationError);
      const err = e as WriteValidationError;
      expect(err.field).toBe("amount");
      expect(err.message).toMatch(/positive/i);
    }
  });

  it("rejects amount === 0", () => {
    expect(() => validatePostReceiptInput({ ...validReceipt, amount: 0 })).toThrow(
      WriteValidationError,
    );
  });

  it("rejects NaN amount", () => {
    expect(() => validatePostReceiptInput({ ...validReceipt, amount: Number.NaN })).toThrow(
      WriteValidationError,
    );
  });

  it("rejects non-finite amounts (Infinity)", () => {
    expect(() =>
      validatePostReceiptInput({ ...validReceipt, amount: Number.POSITIVE_INFINITY }),
    ).toThrow(WriteValidationError);
  });

  it("rejects malformed date", () => {
    try {
      validatePostReceiptInput({ ...validReceipt, date: "yesterday" });
      throw new Error("should have thrown");
    } catch (e) {
      const err = e as WriteValidationError;
      expect(err.field).toBe("date");
    }
  });

  it("rejects empty party name", () => {
    expect(() => validatePostReceiptInput({ ...validReceipt, party: "" })).toThrow(
      WriteValidationError,
    );
    expect(() => validatePostReceiptInput({ ...validReceipt, party: "   " })).toThrow(
      WriteValidationError,
    );
  });

  it("rejects empty destination ledger", () => {
    expect(() =>
      validatePostReceiptInput({ ...validReceipt, destinationLedger: "" }),
    ).toThrow(WriteValidationError);
  });

  it("rejects empty company", () => {
    expect(() => validatePostReceiptInput({ ...validReceipt, company: "" })).toThrow(
      WriteValidationError,
    );
  });

  it("WriteValidationError exposes code GATE_INVALID_INPUT for catchers", () => {
    try {
      validatePostReceiptInput({ ...validReceipt, amount: -1 });
    } catch (e) {
      expect((e as WriteValidationError).code).toBe("INVALID_INPUT");
    }
  });
});

describe("validatePostPaymentInput", () => {
  const validPayment = {
    company: "Co",
    party: "Acme",
    sourceLedger: "Cash",
    date: "2026-06-01",
    amount: 100,
  };

  it("accepts a well-formed input", () => {
    expect(() => validatePostPaymentInput(validPayment)).not.toThrow();
  });

  it("rejects amount <= 0", () => {
    expect(() => validatePostPaymentInput({ ...validPayment, amount: 0 })).toThrow(
      WriteValidationError,
    );
  });

  it("rejects empty source ledger (the field that differs from receipt)", () => {
    try {
      validatePostPaymentInput({ ...validPayment, sourceLedger: "" });
    } catch (e) {
      expect((e as WriteValidationError).field).toBe("sourceLedger");
    }
  });
});
