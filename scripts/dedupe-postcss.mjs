import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const nested = join("node_modules", "next", "node_modules", "postcss");
if (!existsSync(nested)) process.exit(0);

const version = JSON.parse(readFileSync(join(nested, "package.json"), "utf8")).version;
const [major, minor, patch] = version.split(".").map(Number);
if (major > 8 || (major === 8 && minor > 5) || (major === 8 && minor === 5 && patch >= 10)) {
  process.exit(0);
}

rmSync(nested, { recursive: true, force: true });
console.log(`postinstall: removed next's nested postcss@${version}; using hoisted postcss@8.5.15`);
