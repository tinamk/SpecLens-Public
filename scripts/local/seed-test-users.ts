import { PrismaClient } from "@prisma/client";
import { localTestUsers } from "./test-users";

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    for (const user of localTestUsers) {
      const existing = await prisma.user.findUnique({
        where: { email: user.email },
      });
      if (existing) {
        await prisma.user.update({
          where: { id: existing.id },
          data: {
            identityProvider: user.provider,
            identitySubject: user.subject,
            displayName: user.displayName,
            entitlement: user.entitlement,
          },
        });
        continue;
      }

      await prisma.user.create({
        data: {
          id: user.id,
          identityProvider: user.provider,
          identitySubject: user.subject,
          email: user.email,
          displayName: user.displayName,
          entitlement: user.entitlement,
        },
      });
    }
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch(error => {
  console.error("[seed-test-users] failed", error);
  process.exitCode = 1;
});
