import dotenv from "dotenv";
dotenv.config();

import { redisService } from "./services/redis.service.js";

async function start() {
  try {
    await redisService.ensureEvictionPolicy();
  } catch (err) {
    console.error(
      "Redis eviction policy check failed:",
      err instanceof Error ? err.message : err
    );
  }

  const { default: app } = await import("./app.js");
  const { CONFIG } = await import("./config/index.js");

  await import("./workers/imageProcessing.worker.js");
  await import("./workers/videoProcessing.worker.js");

  app.listen(CONFIG.port, () => {
    console.log(`Server is running on port ${CONFIG.port}`);
    console.log(`Image processing worker initialized`);
    console.log(`Video processing worker initialized`);
  });
}

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
