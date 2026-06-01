# financial-snapshot — "How are we doing?"

When the user asks for a high-level financial overview without specifying which report:
"How are we doing?", "Give me a snapshot", "Quick financial summary", "What's the
state of the business?", "Status check".

## When this applies

- Any open-ended request for the financial state of the business
- Before a board meeting, weekly review, or close conversation
- When the user is exploring rather than drilling into a specific report

## Pre-conditions

- `tally_health` already called this session (per pre-flight protocol)
- Active company set
- No write gates needed — this task is read-only

## Decomposition

```htn
TASK: FinancialSnapshot(asOf?)
  precond: gateway reachable, active company set
  method: standard-snapshot
    1. tally_get_report("TrialBalance", toDate=asOf)                  [primitive]
    2. tally_get_report("ProfitLoss", fromDate=fyStart, toDate=asOf)  [primitive]
    3. tally_get_report("BalanceSheet", toDate=asOf)                  [primitive]
    4. tally_list_ledgers(parent="Sundry Debtors", nonZeroOnly=true)  [primitive]
    5. tally_list_ledgers(parent="Sundry Creditors", nonZeroOnly=true) [primitive]
    6. tally_list_ledgers(parent="Bank Accounts", nonZeroOnly=true)   [primitive]
    7. tally_list_ledgers(parent="Cash-in-Hand", nonZeroOnly=true)    [primitive]
    8. Synthesize                                                     [compound]
         method: narrative
           a. Compute totals from (4)..(7): cash, bank, AR, AP
           b. Identify top-3 receivables and top-3 payables by amount
           c. From (2): YTD revenue, YTD net profit
           d. Render 5-line plain-English summary FIRST
           e. Then a compact table: Cash | Bank | AR | AP | Revenue YTD | Net Profit YTD
           f. Offer one follow-up question: "Want me to <chase overdue / draft reminders / drill into a specific area>?"
```

## What `asOf` defaults to

If the user does not specify a date:
- Default to today (`new Date().toISOString().slice(0, 10)`)
- State the date you used in the summary so the user can correct you

## Style requirements

- Lead with **plain English**, not numbers
- Use Indian-numbering with `₹` (the `formatINR` helper inside tools already does this; mirror it in your summary)
- Use `▲ Dr` / `▼ Cr` notation when relevant; otherwise just amounts
- Hide Tally jargon — say "cash on hand" not "Cash-in-Hand ledger group"
- End with **one** specific follow-up offer, not a generic "anything else?"

## Worked example

**User:** "How are we doing financially?"

**You — after pre-flight + executing tree:**

> Quick snapshot as of 1-Jun-2026 for **Aurora Foods Pvt Ltd** *(illustrative — fictional company)*:
>
> Liquid funds total **₹4.12L** — almost all of it in HDFC current account; cash on hand is nil. Customers owe us **₹2.34L** across 5 parties; the bulk (**₹1.20L**) is more than 30 days old — Acme Corp and Beta LLP are the names to chase. We owe vendors **₹15.6K** total. YTD revenue is **₹6.80L** with a net profit of **₹2.15L** (about 32% margin), which is healthy.
>
> | Cash | Bank | AR | AP | Revenue YTD | Net Profit YTD |
> |---|---|---|---|---|---|
> | ₹0 | ₹4,12,500 | ₹2,34,000 | ₹15,661 | ₹6,80,000 | ₹2,15,500 |
>
> Want me to draft follow-up reminders for the overdue receivables, or drill into May P&L?

## Variations

### "Snapshot for last month"

Replace `asOf` with last-day-of-previous-month. For P&L use last-month range, not YTD.

### "Snapshot for our parent company too" (multi-company)

For each company:
- Call `tally_use_company(<name>)`
- Run the standard tree
- Synthesize a comparative table at the end (one row per company)

### "Quick — just the receivables and cash"

Skip steps 1, 2, 3, 5. Render only AR + cash + bank.
