import app from "./app.ts";
import { CONFIG } from "./config/index.ts";
app.listen(CONFIG.port, () => {
    console.log(`Server is running on port ${CONFIG.port}`);
});
