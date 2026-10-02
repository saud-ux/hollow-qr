import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { PublicConfig } from "../../shared/types";

let client: SupabaseClient | null = null;

/**
 * Browser Supabase client. Uses ONLY the public anon/publishable key; all
 * privileged operations happen in the Worker with the service-role key.
 */
export function getSupabase(config: PublicConfig): SupabaseClient {
  if (!client) {
    client = createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        // Implicit flow lets password-reset / confirmation links work even when
        // opened on a different device than the one that requested them.
        flowType: "implicit",
      },
    });
  }
  return client;
}
