import dotenv from "dotenv";
dotenv.config();

import app from "./app.js";
import { CONFIG } from "./config/index.js";
// Initialize the image processing worker
import "./workers/imageProcessing.worker.js";

app.listen(CONFIG.port, () => {
  console.log(`Server is running on port ${CONFIG.port}`);
  console.log(`Image processing worker initialized`);
});
