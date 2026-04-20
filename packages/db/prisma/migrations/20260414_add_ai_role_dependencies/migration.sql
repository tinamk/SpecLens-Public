CREATE TABLE "AiRoleDependency" (
  "roleId" TEXT NOT NULL,
  "dependsOnRoleId" TEXT NOT NULL,
  "order" INTEGER NOT NULL DEFAULT 0,

  CONSTRAINT "AiRoleDependency_pkey" PRIMARY KEY ("roleId","dependsOnRoleId"),
  CONSTRAINT "AiRoleDependency_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "AiRole" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AiRoleDependency_dependsOnRoleId_fkey" FOREIGN KEY ("dependsOnRoleId") REFERENCES "AiRole" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
