import { createClient, SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";
import { CONFIG } from "../config";

const supabaseClientOptions = {
  realtime: {
    transport: ws as unknown as typeof WebSocket,
  },
};

export function createSupabaseClient(): SupabaseClient {
  return createClient(
    CONFIG.supabase.supabaseUrl,
    CONFIG.supabase.supabaseKey,
    supabaseClientOptions
  );
}
