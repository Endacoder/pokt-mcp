import { appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

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

function auditPaths() {
  const dir = process.env.POKT_AUDIT_DIR ?? join(homedir(), ".pokt-mcp");
  return { dir, file: join(dir, "audit.log") };
}

export async function writeAudit(entry: AuditEntry): Promise<void> {
  const { dir, file } = auditPaths();
  await mkdir(dir, { recursive: true });
  await appendFile(file, `${JSON.stringify(entry)}\n`, "utf8");
}
