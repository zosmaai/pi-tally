/**
 * Ring 1 — per-category write gates.
 *
 * Every write tool's handler MUST call `assertGate(cfg, category)` as its
 * first line. If the corresponding gate in `cfg.writeGates` is false the
 * call throws `TallyWriteBlockedError` with a stable structured payload the
 * LLM cannot mask, retry, or "creatively interpret".
 *
 * The error message is intentionally short and instructive: it names the
 * exact slash-command the user must run, and avoids any language ("retry",
 * "try again") that would tempt an autonomous LLM loop.
 *
 * Gates are loaded via `loadConfig()` and toggled exclusively through
 * `/tally enable-writes <category>` / `/tally disable-writes <category>`
 * (see `commands.ts`). Tools never mutate gates themselves.
 */

import type { TallyConfig } from "../config.js";
import type { WriteGateState } from "../types.js";

export type GateCategory = keyof WriteGateState;

/**
 * Public-facing kebab-case names used in slash commands and error hints.
 * The internal config keys are camelCase to play nicely with JSON; the
 * mapping lives here, in one place.
 */
export const GATE_COMMAND_NAME: Record<GateCategory, string> = {
  masters: "masters",
  vouchers: "vouchers",
  bulkImport: "bulk-import",
  rawXml: "raw-xml",
};

export interface TallyWriteBlockedErrorJSON {
  code: "GATE_CLOSED";
  category: GateCategory;
  userAction: string;
  message: string;
}

/**
 * Thrown when a write tool runs while its category gate is closed.
 *
 * Carries enough structured data that the host CLI (or a test harness) can
 * render it as a friendly "ask the user to enable writes" prompt without
 * string-matching the message.
 */
export class TallyWriteBlockedError extends Error {
  readonly code = "GATE_CLOSED" as const;
  readonly category: GateCategory;
  readonly userAction: string;

  constructor(category: GateCategory) {
    const cmd = GATE_COMMAND_NAME[category];
    const userAction = `/tally enable-writes ${cmd}`;
    super(
      `Tally write gate '${category}' is closed. Ask the user to run ${userAction} before calling this tool again.`,
    );
    this.name = "TallyWriteBlockedError";
    this.category = category;
    this.userAction = userAction;
  }

  toJSON(): TallyWriteBlockedErrorJSON {
    return {
      code: this.code,
      category: this.category,
      userAction: this.userAction,
      message: this.message,
    };
  }
}

/**
 * Throw if the named gate is closed in the given config snapshot.
 *
 * Call this synchronously at the top of every write tool handler, BEFORE
 * any other work (no XML build, no confirmation prompt, nothing). Failing
 * fast is the whole point of Ring 1.
 */
export function assertGate(cfg: TallyConfig, category: GateCategory): void {
  if (!cfg.writeGates[category]) {
    throw new TallyWriteBlockedError(category);
  }
}
