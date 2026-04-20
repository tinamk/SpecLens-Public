import { startAgentLoop } from "./services/worker";

startAgentLoop().catch(error => {
  console.error(error);
  process.exit(1);
});
