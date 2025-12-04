import dotenv from "dotenv";
dotenv.config();

import app from "./app.js";
import { CONFIG } from "./config/index.js";

app.listen(CONFIG.port, () => {
  console.log(`Server is running on port ${CONFIG.port}`);
});
