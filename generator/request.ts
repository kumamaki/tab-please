// request.ts — file a "please curate this CLI" request as a GitHub issue.
//
//   bun generator/request.ts <tool> [--force] [--dry-run]
//
// Vets the tool first (reusing classify): tools that are already curated, ship
// their own completion, or are too flat are turned away with a reason, so the
// tracker stays signal-rich. Files via `gh` when it's authed; otherwise prints
// (and opens) a pre-filled issue URL — no token or gh required.

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { classify, toolVersion } from "./classify.ts";

const pexec = promisify(execFile);
const SAFE = { cwd: tmpdir(), maxBuffer: 8 * 1024 * 1024 } as const;
const ROOT = resolve(import.meta.dir, "..");
const REPO = process.env.TAB_PLEASE_REPO || "kumamaki/tab-please";

const argv = process.argv.slice(2);
const tool = argv.find((a) => !a.startsWith("-"));
const force = argv.includes("--force");
const dryRun = argv.includes("--dry-run");

if (!tool) {
  console.error("usage: bun generator/request.ts <tool> [--force] [--dry-run]");
  process.exit(1);
}

const refuse = (msg: string): never => {
  console.error(`tab-please: ${msg}`);
  process.exit(1);
};

async function installed(cmd: string): Promise<boolean> {
  try {
    await pexec("which", [cmd], SAFE);
    return true;
  } catch {
    return false;
  }
}

// ── vet ──────────────────────────────────────────────────────────────────────
if (existsSync(resolve(ROOT, "dist", `_${tool}`)) && !force) {
  refuse(`'${tool}' is already curated — it ships with tab-please and completes once the plugin is loaded. Nothing to request.`);
}

let body: string;
if (!(await installed(tool))) {
  body =
    `Requesting a curated tab-please completion for **${tool}**.\n\n` +
    `_Not installed locally, so no auto-detected context._\n\n` +
    `Why curate (vs \`tab-please add\` locally): \n`;
} else {
  const verdict = await classify(tool);
  if (!force) {
    if (verdict.kind === "native") {
      refuse(`'${tool}' ships its own completion (\`${verdict.detail}\`) — that's better than a generated one. Enable it instead; not a curate candidate. (use --force to request anyway)`);
    }
    if (verdict.kind === "low") {
      refuse(`'${tool}' looks flat (${verdict.detail}) — zsh's file default already covers it, or run \`tab-please add ${tool}\` locally. (use --force to request anyway)`);
    }
  }
  const version = await toolVersion(tool);
  body =
    `Requesting a curated tab-please completion for **${tool}**.\n\n` +
    "Auto-detected via `tab-please request`:\n" +
    (version ? `- version: ${version}\n` : "") +
    `- format: ${verdict.format ?? "unknown"}\n` +
    `- parses: ${verdict.subcommands ?? 0} subcommands, ${verdict.flags ?? 0} flags\n` +
    `- ships own completion: ${verdict.kind === "native" ? "yes" : "no"}\n\n` +
    `Why curate (vs \`tab-please add\` locally): \n`;
}

const title = `[request] ${tool}`;
const url = `https://github.com/${REPO}/issues/new?${new URLSearchParams({ title, body, labels: "tool-request" })}`;

// ── dry run: show what would be filed, touch nothing ─────────────────────────
if (dryRun) {
  console.log(`[dry-run] would file in ${REPO}:`);
  console.log(`  title: ${title}`);
  console.log(`  url:   ${url}`);
  process.exit(0);
}

// ── file it ──────────────────────────────────────────────────────────────────
async function ghReady(): Promise<boolean> {
  try {
    await pexec("gh", ["auth", "status"], SAFE);
    return true;
  } catch {
    return false;
  }
}

if (await ghReady()) {
  // Dedup: an open or closed request for this exact title already exists?
  try {
    const { stdout } = await pexec(
      "gh",
      ["issue", "list", "--repo", REPO, "--search", `${title} in:title`, "--state", "all", "--json", "url,title"],
      SAFE,
    );
    const existing = (JSON.parse(stdout || "[]") as Array<{ url: string; title: string }>).find((i) => i.title === title);
    if (existing) {
      console.log(`tab-please: '${tool}' was already requested → ${existing.url}`);
      process.exit(0);
    }
  } catch {
    /* search failed (offline, etc.) — go ahead and create */
  }

  const createArgs = ["issue", "create", "--repo", REPO, "--title", title, "--body", body];
  try {
    const { stdout } = await pexec("gh", [...createArgs, "--label", "tool-request"], SAFE);
    console.log(`tab-please: filed → ${stdout.trim()}`);
  } catch {
    // The label may not exist on the repo yet — retry without it.
    const { stdout } = await pexec("gh", createArgs, SAFE);
    console.log(`tab-please: filed → ${stdout.trim()}`);
  }
} else {
  console.log(`tab-please: open this to file the request for '${tool}':\n  ${url}`);
  const opener = process.platform === "darwin" ? "open" : "xdg-open";
  try {
    await pexec(opener, [url], SAFE);
  } catch {
    /* no opener — the user has the URL above */
  }
}
