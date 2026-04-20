import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { sourceSchema, type AddSourceInput, type Source } from "@speclens/contracts";
import { createSourceForUser, getPrismaClient, statusError } from "./repositories";

function createTestSourceId(): string {
  return `source_${randomUUID()}`;
}

export async function createSourceForUserForTests(
  workspaceId: string,
  userId: string,
  input: AddSourceInput,
): Promise<Source> {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("createSourceForUserForTests is only available in test mode.");
  }

  if (!(input.type === "git-public" && input.location.startsWith("file://"))) {
    return await createSourceForUser(workspaceId, userId, input);
  }

  const prisma = getPrismaClient();
  const workspace = await prisma.workspace.findFirst({
    where: {
      id: workspaceId,
      OR: [
        { ownerUserId: userId },
        { memberships: { some: { userId, role: "owner" } } },
      ],
    },
  });
  if (!workspace) {
    throw statusError(404, `Workspace not found: ${workspaceId}`);
  }

  const normalizedLocation = (() => {
    try {
      return fileURLToPath(input.location);
    } catch {
      return input.location;
    }
  })();

  const source = await prisma.source.create({
    data: {
      id: createTestSourceId(),
      workspaceId,
      type: input.type,
      displayName: input.displayName,
      location: normalizedLocation,
      visibility: "public",
      verificationStatus: "verified",
      verificationError: null,
      githubInstallationId: null,
      uploadObjectKey: null,
    },
  });

  return sourceSchema.parse({
    id: source.id,
    workspaceId: source.workspaceId,
    type: source.type,
    displayName: source.displayName,
    location: source.location,
    visibility: source.visibility,
    verificationStatus: source.verificationStatus,
    verificationError: source.verificationError,
    githubInstallationId: source.githubInstallationId,
    uploadObjectKey: source.uploadObjectKey,
    createdAt: source.createdAt.toISOString(),
  });
}
