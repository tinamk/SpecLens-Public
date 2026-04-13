import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import Fastify from "fastify";
import { ZodError } from "zod";
import { registerRoutes } from "./routes";
import { loadApiConfig } from "./services/config";
import { disconnectPersistence } from "./services/persistence";
import { createAppState } from "./services/state";

async function createApiApp() {
  const config = loadApiConfig();
  const state = await createAppState();
  const app = Fastify({
    logger: false,
  });

  await app.register(cors, {
    origin: true,
    credentials: true,
  });
  await app.register(multipart);
  app.addHook("onClose", async () => {
    await disconnectPersistence();
  });
  app.setErrorHandler((error, _request, reply) => {
    const message = error instanceof Error ? error.message : "Unknown server error";
    if (error instanceof ZodError) {
      reply.status(400).send({
        error: "validation_error",
        issues: error.issues,
      });
      return;
    }
    const lowerMessage = message.toLowerCase();
    if (lowerMessage.includes("not found")) {
      reply.status(404).send({ error: message });
      return;
    }
    if (lowerMessage.includes("required") || lowerMessage.includes("forbidden") || lowerMessage.includes("entitlement")) {
      reply.status(403).send({ error: message });
      return;
    }
    reply.status(500).send({ error: message });
  });
  await registerRoutes(app, state);

  return {
    app,
    config,
    state,
  };
}

export { createApiApp };
export default createApiApp;
