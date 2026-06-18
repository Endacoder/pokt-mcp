import { appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const AUDIT_DIR = process.env.POKT_AUDIT_DIR ?? join(homedir(), ".pokt-mcp");
const AUDIT_FILE = join(AUDIT_DIR, "audit.log");

export interface AuditEntry {
  timestamp: string;
  tool: string;
  chain?: string;
  from?: string;
  to?: string;
  value?: string;
  txHash?: string;
  status: string;
  sessionId?: string;
}

export async function writeAudit(entry: AuditEntry): Promise<void> {
  await mkdir(AUDIT_DIR, { recursive: true });
  await appendFile(AUDIT_FILE, `${JSON.stringify(entry)}\n`, "utf8");
}
