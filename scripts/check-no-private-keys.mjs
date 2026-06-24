#!/usr/bin/env node
/**
 * Fail if tracked source files contain literal private keys or mnemonics.
 * Run: npm run check:secrets
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

function trackedFiles() {
  const out = execSync("git ls-files", { cwd: ROOT, encoding: "utf8" });
  return out
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((f) => !f.startsWith("scripts/check-no-private-keys.mjs"));
}

const KEY_PATTERNS = [
  {
    name: "private key assignment",
    re: /(?:private[_-]?key|PRIVATE_KEY|localPrivateKey)\s*[:=]\s*["'`]?(0x)?[0-9a-fA-F]{64}/i,
  },
  {
    name: "privateKeyToAccount literal",
    re: /privateKeyToAccount\s*\(\s*["'`]0x[0-9a-fA-F]{64}["'`]/,
  },
  {
    name: "BIP39 mnemonic (12+ words)",
    re: /\b(?:[a-z]{3,8}\s+){11,23}[a-z]{3,8}\b/,
  },
];

const ALLOWLIST = new Set([
  ".env.example",
]);

const issues = [];

for (const file of trackedFiles()) {
  if (ALLOWLIST.has(file)) continue;
  if (file.endsWith(".png") || file.endsWith(".jpg") || file.endsWith(".svg")) continue;

  let text;
  try {
    text = readFileSync(`${ROOT}/${file}`, "utf8");
  } catch {
    continue;
  }

  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*#/.test(line) || /^\s*\/\//.test(line)) {
      // Skip commented placeholders like # PRIVATE_KEY=0x...
      if (/PRIVATE_KEY/i.test(line)) continue;
    }

    for (const { name, re } of KEY_PATTERNS) {
      if (re.test(line)) {
        issues.push({
          file,
          line: i + 1,
          kind: name,
          snippet: line.trim().slice(0, 120),
        });
      }
    }
  }
}

if (issues.length > 0) {
  console.error("Possible secrets found in tracked files:\n");
  for (const issue of issues) {
    console.error(
      `  ${relative(ROOT, `${ROOT}/${issue.file}`)}:${issue.line} [${issue.kind}]\n    ${issue.snippet}\n`,
    );
  }
  console.error(`${issues.length} issue(s). Remove literals; use env vars or ephemeral test keys.`);
  process.exit(1);
}

console.log("check:secrets — no literal private keys or mnemonics in tracked files.");
