#!/usr/bin/env node
/**
 * DEVELOPMENT ONLY: creates safe sample data in a development Supabase project.
 *   - staff:    demo.staff@example.com
 *   - customer: Abdulaziz (demo.abdulaziz@example.com) with 3 / 5 cups
 * Uses reserved example.com addresses — no real customer data.
 *
 *   pnpm seed:dev --confirm-dev
 */
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { hasFlag, loadLocalEnv, requireEnv } from "./lib/env.mjs";

loadLocalEnv();
requireEnv("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY");
if (!hasFlag("confirm-dev") || (process.env.APP_ENV ?? "").toLowerCase() === "production") {
  console.error("Refusing to seed. Run against a DEVELOPMENT project with: pnpm seed:dev --confirm-dev");
  process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const devPassword = () => `Dev${randomBytes(6).toString("hex")}9`;

async function ensureUser(email, displayName, role) {
  const password = devPassword();
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: displayName },
    app_metadata: role ? { hollow_role: role } : {},
  });
  if (error) {
    if (/already/i.test(error.message)) {
      console.log(`  ${email} already exists (password unchanged)`);
      const { data: p } = await supabase.from("profiles").select("id").eq("email", email).single();
      return { id: p.id, password: null };
    }
    throw new Error(error.message);
  }
  return { id: data.user.id, password };
}

async function main() {
  const staff = await ensureUser("demo.staff@example.com", "Demo Barista", "staff");
  const customer = await ensureUser("demo.abdulaziz@example.com", "Abdulaziz", null);
  const { data: account } = await supabase.from("loyalty_accounts").select("id, stamp_count, member_id").eq("user_id", customer.id).single();
  if (account.stamp_count === 0) {
    const { data, error } = await supabase.rpc("apply_loyalty_action", {
      p_actor_id: staff.id,
      p_account_id: account.id,
      p_action: "ADD_CUPS",
      p_quantity: 3,
      p_confirm_recent: true,
      p_source: "seed",
    });
    if (error || !data?.ok) throw new Error(`seeding cups failed: ${error?.message ?? data?.code}`);
  }
  console.log("Seeded:");
  console.log(`  staff    demo.staff@example.com ${staff.password ? `password: ${staff.password}` : ""}`);
  console.log(`  customer demo.abdulaziz@example.com ${customer.password ? `password: ${customer.password}` : ""} member ${account.member_id} (3 / 5 Cups)`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
