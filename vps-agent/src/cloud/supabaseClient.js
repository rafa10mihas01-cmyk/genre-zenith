// Service-role client para o worker escrever no Cloud (insert/update/storage).
import { createClient } from "@supabase/supabase-js";
import { config } from "../config.js";

if (!config.SUPABASE_URL || !config.SUPABASE_SERVICE_ROLE_KEY) {
  console.warn("[cloud] SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY ausentes — handlers que persistem vão falhar");
}

export const sb = createClient(
  config.SUPABASE_URL ?? "https://invalid.local",
  config.SUPABASE_SERVICE_ROLE_KEY ?? "invalid",
  { auth: { persistSession: false, autoRefreshToken: false } }
);
