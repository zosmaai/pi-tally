# post-receipt — Record a customer receipt

When the user says: "post a receipt", "record payment received", "<party> paid us ₹X",
"got a receipt of ₹X from <party>", "credit note from customer for cash received", etc.

## When this applies

- Customer paid us money (most common)
- Refund received from a vendor (vendor's credit balance moving to bank/cash)
- Advance received from a customer (no bill reference)

Does **not** apply for:
- Payment we made (use `post-payment`)
- Bank-to-cash or bank-to-bank transfer (use `post-contra`)

## Pre-conditions

- `tally_health` already called
- Active company set
- `writeGates.vouchers` is OPEN
- Party ledger exists (or you're prepared to create it via `tally_create_ledger`, which needs `writeGates.masters` open)
- Destination ledger exists (Cash, HDFC Bank, etc.)

## Decomposition

```htn
TASK: PostReceipt(party, amount, destinationLedger, date?, billRef?, narration?)
  precond: writes-gate(vouchers) open
           party ledger exists in tally_list_ledgers
           destinationLedger exists
  method: standard
    1. tally_list_ledgers(namePattern=party)                          [primitive]
    2. ResolveParty                                                   [compound]
         method: exact-match → use it
         method: ambiguous → ask user to disambiguate
         method: missing →
            precond: writes-gate(masters) open
            a. propose tally_create_ledger(name=party, parent="Sundry Debtors") [primitive, gated]
            b. ask user to confirm before proceeding
    3. tally_list_ledgers(namePattern=destinationLedger)              [primitive]
    4. Verify destination is in Cash-in-Hand or Bank Accounts         [client-side]
    5. If billRef provided:
         tally_list_vouchers(party, fromDate=fy_start, voucherType="Sales")
         → find matching bill, attach as billRef                      [primitive]
    6. Present preview to user:
         "Receipt: ₹X from <party> into <destination> on <date>.
          Bill ref: <ref or 'none / advance'>. Narration: <narration>.
          Proceed?"
    7. tally_post_receipt(...)                                        [primitive, gated, confirmed]
    8. On success: state voucher number + GUID + new ledger balance
    9. On error:
         - DATE_OUT_OF_FY  → ask user for correct date
         - LEDGER_NOT_FOUND → re-run step 1 with broader pattern
         - LINEERROR       → quote Tally's error verbatim, ask user
```

## Critical rules

- **Date format**: tool accepts `YYYY-MM-DD`. Internally converted to Tally's `YYYYMMDD`.
- **Bill ref classification**: if amount matches an outstanding bill exactly, use `Agst Ref`. Otherwise, advance is `Advance`; unattached is `On Account`. Never invent.
- **Narration**: if user doesn't specify, leave blank. Don't fabricate.
- **Auto-numbering**: never pass a `voucherNumber` unless user explicitly supplies one. Tally auto-numbers.

## Worked example

**User:** "Got ₹50,000 from Acme yesterday into HDFC"

**You — after pre-flight + executing tree:**

> Resolving party "Acme"… found `Acme Pvt Ltd` under Sundry Debtors with outstanding ₹50,000 against invoice INV-2025-014. Destination `HDFC Current A/c` confirmed under Bank Accounts.
>
> About to post:
> - **Receipt** ₹50,000 on 31-May-2026
> - From: `Acme Pvt Ltd` (matching against INV-2025-014, fully settling it)
> - Into: `HDFC Current A/c`
> - Narration: *(none)*
>
> Proceed?

*(user confirms)*

> ✅ Posted. Voucher number `RV/2026/142`. New balance on Acme: ₹0. New balance on HDFC: ₹4,62,500.

## Anti-patterns

- ❌ Don't post without confirming the party-to-bill match. If amount doesn't tie to a bill exactly, ask user whether to treat as advance or split.
- ❌ Don't guess the destination ledger. If user just says "received ₹X", ask "into cash or bank?"
- ❌ Don't classify a vendor refund as a customer receipt. Vendor refunds technically post against the vendor's ledger which is a Sundry Creditor — direction matters. Ask.
