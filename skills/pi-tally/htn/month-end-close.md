# month-end-close — Top-level monthly close checklist

When the user says: "close the month", "month-end", "close May", "wrap up the month",
"prepare for month-end review", "MIS for last month".

## When this applies

End-of-month finance ritual. Not a single tool call — a sequence of checks and
classifications with the LLM walking the user through each.

## Pre-conditions

- `tally_health` called
- Active company set
- Ideally `writeGates.vouchers` is OPEN (some sub-tasks post adjustments)
- User has the bank statement(s) for the month available

## Top-level decomposition

```htn
TASK: MonthEndClose(month)
  precond: gateway reachable, active company set
  method: standard-close
    1. AnnounceScope                                                  [compound]
         a. state the close month, FY, and the 8 subtasks
         b. ask user to confirm or amend the scope
    2. ValidateOpeningPosition                                        [compound]
         method: open-from-prior-close
           a. tally_get_report("TrialBalance", toDate=monthStart-1)
           b. confirm with user: prior closing == this opening
    3. ReconcileBank(month, eachBankLedger)                           [compound]
         → see htn/reconcile-bank.md  (one per bank ledger)
    4. ReviewSuspense(month)                                          [compound]
         a. tally_list_ledgers(namePattern="Suspense")
         b. tally_list_vouchers(ledger=suspense, fromDate=monthStart, toDate=monthEnd)
         c. for each entry: ask user to reclassify or leave; post adjustment
    5. BookAccruals(month)                                            [compound]
         method: standard-accruals
           a. ask user what's pending (utilities, salaries, rent)
           b. for each: tally_post_journal (expense Dr, accrued-liability Cr)
    6. BookPrepaidAmortization(month)                                 [compound]
         a. list prepaid-expense ledgers
         b. compute monthly amortization (1/period of asset balance)
           — confirm period with user, never assume 12 months
           — tally_post_journal (expense Dr, prepaid Cr)
    7. ValidateGSTConsistency(month)                                  [compound]
         method: trial-balance-vs-gstr
           a. tally_get_report("TrialBalance") → sum CGST/SGST/IGST output and input
           b. compare against expected from sales/purchase vouchers
           c. report mismatches; do NOT auto-fix (v2 will)
    8. PresentClosingReports                                          [compound]
         a. tally_get_report("ProfitLoss", monthRange)
         b. tally_get_report("BalanceSheet", toDate=monthEnd)
         c. tally_get_outstanding(receivables, asOf=monthEnd) — v0.2
         d. tally_get_outstanding(payables, asOf=monthEnd) — v0.2
         e. render summary checklist: what was done, what was deferred,
            what needs human follow-up
```

## Subtask references

Each compound step expands per its own `htn/` file:
- `reconcile-bank.md`
- `investigate-mismatch.md` (used when GST validation flags mismatches)
- `post-journal.md` (used in accruals and prepaid amortization)
- `financial-snapshot.md` (used in the closing presentation)

## State to track across the close

Maintain a running checklist in pi's session log as you go:

```
☑ Scope confirmed: May 2025, ZOSMAAI SOLUTIONS PRIVATE LIMITED
☑ Opening tied to prior close (₹4,21,500 cash+bank)
☐ HDFC bank rec   ← in progress
☐ ICICI bank rec
☐ Suspense review (1 entry, ₹5,000)
☐ Accruals (electricity, rent)
☐ Prepaid amortization (insurance 1/12)
☐ GST consistency
☐ Final reports
```

Update the checklist after each subtask. At end-of-session, persist the checklist via `pi.appendEntry("tally-close-checklist", {...})` so a future session can resume.

## Stopping points (where you ASK and wait)

Always stop and wait for human acknowledgement at these gates:
- After AnnounceScope, before doing anything
- After each unmatched-line classification during BRS
- Before posting any accrual or amortization journal
- After GST mismatch report (do not auto-adjust)
- Before final reports — confirm the user wants them rendered or saved

## Anti-patterns

- ❌ Don't post adjustments silently. Every journal in steps 5 and 6 needs explicit user confirmation.
- ❌ Don't run the GST mismatch check inside vouchers gate write — it's read-only, classify only.
- ❌ Don't close the FY in the same session as month-end close. Year-end has its own tree (v2: `close-financial-year.md`).
- ❌ Don't proceed if `ValidateOpeningPosition` shows a delta. A non-tied opening means prior close has a problem — pause and investigate.

## Worked example

**User:** "Let's close May."

**You — after pre-flight:**

> Closing **May 2025** for **ZOSMAAI SOLUTIONS PRIVATE LIMITED** — here's what I'll walk you through (8 subtasks):
>
> 1. Confirm opening position ties to April close
> 2. Bank reconciliation for each bank ledger
> 3. Suspense review
> 4. Book accruals (utilities, salaries, rent)
> 5. Prepaid expense amortization
> 6. GST consistency check
> 7. Final P&L + BS + outstanding
> 8. Persist checklist for resume
>
> Vouchers gate is **CLOSED** — I'll need you to open it before steps 4, 5, 6 can post adjustments. Bulk-import is also closed; I'll need that for the bank rec CSV.
>
> Shall I start with step 1, opening position?

*(user: "yes")*

> Fetching trial balance as of 30-Apr-2025… *(continues)*
