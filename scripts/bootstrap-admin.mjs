#!/usr/bin/env node
/**
 * Creates the first HOLLOW admin, or promotes an existing account to admin.
 * Runs locally with the Supabase service-role key — there is deliberately no
 * public "create admin" endpoint.
 *
 *   pnpm bootstrap:admin --email owner@example.com --name "Owner"
 *   (prompts for the password; or set ADMIN_PASSWORD in the environment)
 *
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (shell, .env or .dev.vars).
 */
import { createClient } from "@supabase/supabase-js";
import { arg, loadLocalEnv, promptHidden, requireEnv, strongPassword } from "./lib/env.mjs";

loadLocalEnv();
requireEnv("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY");

const email = (arg("email") ?? "").trim().toLowerCase();
const name = (arg("name") ?? "HOLLOW Admin").trim();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error('Usage: pnpm bootstrap:admin --email owner@example.com --name "Owner"');
  process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function findUserByEmail(target) {
  for (let page = 1; page < 200; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    const hit = data.users.find((u) => (u.email ?? "").toLowerCase() === target);
    if (hit) return hit;
    if (data.users.length < 200) return null;
  }
  return null;
}

async function main() {
  let user = await findUserByEmail(email);
  if (user) {
    console.log(`Account exists (${email}); promoting to admin.`);
    const { error } = await supabase.auth.admin.updateUserById(user.id, {
      app_metadata: { ...user.app_metadata, hollow_role: "admin" },
    });
    if (error) throw new Error(`updateUserById failed: ${error.message}`);
  } else {
    const password = process.env.ADMIN_PASSWORD ?? (await promptHidden("Password for the new admin: "));
    if (!strongPassword(password)) {
      console.error("Password must be 8-128 characters and contain letters and digits.");
      process.exit(1);
    }
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: name },
      app_metadata: { hollow_role: "admin" },
    });
    if (error) throw new Error(`createUser failed: ${error.message}`);
    user = data.user;
    console.log(`Created admin account ${email}.`);
  }

  // public.profiles.role is the source of truth used by the server.
  const { error: roleError } = await supabase.from("profiles").update({ role: "admin" }).eq("id", user.id);
  if (roleError) throw new Error(`Could not set profile role (did you run the migrations?): ${roleError.message}`);
  const { data: profile, error: readError } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (readError || profile?.role !== "admin") throw new Error("Verification failed: profile role is not admin");
  console.log("Done. Sign in at /staff/login.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
