import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const outputPath = process.env.AUDIT_EXPORT_PATH
  ?? path.resolve(process.cwd(), `.speclens-workspace/audit-export-${Date.now()}.json`);
const since = process.env.AUDIT_EXPORT_SINCE ? new Date(process.env.AUDIT_EXPORT_SINCE) : null;
const workspaceId = process.env.AUDIT_EXPORT_WORKSPACE_ID ?? null;
const userId = process.env.AUDIT_EXPORT_USER_ID ?? null;

const where = {
  ...(since ? { createdAt: { gte: since } } : {}),
  ...(workspaceId ? { workspaceId } : {}),
  ...(userId ? { userId } : {}),
};

const logs = await prisma.auditLog.findMany({
  where,
  orderBy: { createdAt: "asc" },
});

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(logs, null, 2)}\n`);

console.log(`Exported ${logs.length} audit log entries to ${outputPath}`);

await prisma.$disconnect();
