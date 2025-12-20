import dotenv from "dotenv";
dotenv.config();

import app from "./app.js";
import { CONFIG } from "./config/index.js";
// Initialize the image and video processing workers
import "./workers/imageProcessing.worker.js";
import "./workers/videoProcessing.worker.js";

app.listen(CONFIG.port, () => {
  console.log(`Server is running on port ${CONFIG.port}`);
  console.log(`Image processing worker initialized`);
  console.log(`Video processing worker initialized`);
});
