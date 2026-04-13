import { createApiApp } from "./app";

async function start() {
  const { app, config } = await createApiApp();
  await app.listen({
    port: config.port,
    host: "0.0.0.0",
  });
  console.log(`SpecLens API listening on ${config.apiUrl || `http://127.0.0.1:${config.port}`}`);
}

start().catch(error => {
  console.error(error);
  process.exit(1);
});
