/**
 * tally_list_companies + tally_use_company
 *
 * Companies is informational. Use-company mutates session-local state only —
 * does not change TallyPrime's own active company.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { TallyClient } from "../../client.js";
import { loadConfig, saveUserConfig } from "../../config.js";

const LIST_PARAMS = Type.Object({});

const USE_PARAMS = Type.Object({
  company: Type.String({
    description: "Exact name of the company to make active for this session.",
  }),
});

export function registerCompanyTools(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "tally_list_companies",
    label: "List Tally Companies",
    description:
      "List all companies currently loaded in TallyPrime, with financial-year and books-from dates.",
    promptSnippet: "List companies loaded in TallyPrime",
    promptGuidelines: [
      "Use tally_list_companies when the user asks about which companies are loaded, or when ambiguity arises about which company they mean.",
    ],
    parameters: LIST_PARAMS,
    async execute(_id, _params, _signal, _onUpdate, ctx) {
      const cfg = loadConfig(ctx.cwd);
      const client = new TallyClient({ url: cfg.url, timeoutMs: cfg.timeoutMs });
      const companies = await client.listCompanies();
      const lines = companies.map(
        (c) => `• ${c.name}  (FY from ${c.startingFrom}, books from ${c.booksFrom})`,
      );
      return {
        content: [
          {
            type: "text",
            text: companies.length
              ? `Loaded companies:\n${lines.join("\n")}`
              : "No companies loaded.",
          },
        ],
        details: { companies },
      };
    },
  });

  pi.registerTool({
    name: "tally_use_company",
    label: "Use Tally Company",
    description:
      "Set the active company for subsequent Tally calls in this pi installation. Persists to ~/.pi-tally/config.json. Does NOT switch TallyPrime's own active company — it only scopes our requests via SVCURRENTCOMPANY.",
    promptSnippet:
      "Set the active TallyPrime company for subsequent Tally calls in this pi installation",
    promptGuidelines: [
      "Use tally_use_company when the user mentions a different company than the current active one, or when starting work on a new company.",
      "Always confirm the chosen company is in the list returned by tally_list_companies before calling tally_use_company.",
    ],
    parameters: USE_PARAMS,
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const cfg = loadConfig(ctx.cwd);
      const client = new TallyClient({ url: cfg.url, timeoutMs: cfg.timeoutMs });
      const companies = await client.listCompanies();
      const match = companies.find(
        (c) => c.name.toLowerCase() === params.company.toLowerCase(),
      );
      if (!match) {
        throw new Error(
          `Company "${params.company}" is not loaded. Loaded: ${companies.map((c) => c.name).join(", ")}`,
        );
      }
      saveUserConfig({ defaultCompany: match.name });
      return {
        content: [{ type: "text", text: `Active company set to: ${match.name}` }],
        details: { activeCompany: match.name },
      };
    },
  });
}
