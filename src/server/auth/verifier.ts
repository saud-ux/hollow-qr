import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface VerifiedIdentity {
  userId: string;
  email: string | null;
}

/** Verifies a Supabase access token. Implementations must never trust unverified claims. */
export interface AuthVerifier {
  verify(accessToken: string): Promise<VerifiedIdentity | null>;
}

// One client per isolate so Supabase's JWKS cache is reused across requests.
const clients = new Map<string, SupabaseClient>();

/**
 * Uses supabase-js `auth.getClaims()`:
 *  - projects with asymmetric JWT signing keys: verified locally against the
 *    project's JWKS with WebCrypto (no network call per request);
 *  - legacy HS256 projects: falls back to Supabase Auth `getUser` (server-side
 *    verification over HTTPS).
 * Role is NOT taken from the token; it is read from public.profiles afterwards.
 */
export class SupabaseAuthVerifier implements AuthVerifier {
  private readonly client: SupabaseClient;

  constructor(url: string, anonKey: string) {
    const cacheKey = `${url}|${anonKey}`;
    let client = clients.get(cacheKey);
    if (!client) {
      client = createClient(url, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      clients.set(cacheKey, client);
    }
    this.client = client;
  }

  async verify(accessToken: string): Promise<VerifiedIdentity | null> {
    try {
      const { data, error } = await this.client.auth.getClaims(accessToken);
      if (error || !data?.claims) return null;
      const claims = data.claims as { sub?: string; email?: string; role?: string };
      if (!claims.sub || claims.role !== "authenticated") return null;
      return { userId: claims.sub, email: claims.email ?? null };
    } catch {
      return null;
    }
  }
}
