/**
 * v0.2 write tools — LLM-facing tool registrations for voucher posting.
 *
 * Every tool in this directory:
 *   1. Calls assertGate("vouchers") via its operation (Ring 1)
 *   2. Validates input via validatePostXInput before any UI (Ring 2 prep)
 *   3. Renders a structured WritePreview through confirmWrite (Ring 2)
 *   4. Writes audit events on every state transition
 *   5. Maps thrown errors to structured tool results the LLM can branch on
 *
 * Ring 3 (deterministic money + GST math) and Ring 4 (data-role boundary
 * for file inputs) are not yet exercised by these tools — receipt/payment
 * posting has no GST math and no file inputs. They land with sales/purchase
 * invoices in v0.3.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerPostReceiptTool } from "./post-receipt.js";
import { registerPostPaymentTool } from "./post-payment.js";
import { registerReverseVoucherTool } from "./reverse-voucher.js";

export function registerWriteTools(pi: ExtensionAPI): void {
  registerPostReceiptTool(pi);
  registerPostPaymentTool(pi);
  registerReverseVoucherTool(pi);
}
