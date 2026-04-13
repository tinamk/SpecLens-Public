import { startRunnerLoop } from "./services/runner";

startRunnerLoop().catch(error => {
  console.error(error);
  process.exit(1);
});
