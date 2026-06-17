import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY;
  if (!url || !key) {
    console.error("SUPABASE_URL and SUPABASE_KEY required");
    process.exit(1);
  }

  const client = createClient(url, key);
  const { data, error } = await client
    .from("collection_metadata")
    .select("id, collection_name, description, collection_type, settings, segmentation_config")
    .limit(1);

  if (error) {
    console.log("NOT_APPLIED");
    console.error(error.message);
    process.exit(2);
  }

  console.log("ALREADY_APPLIED");
  console.log(JSON.stringify(data?.[0] ?? null));
}

main();
