#!/usr/bin/env node
/**
 * Compare committed SQL migration filenames with a separately exported
 * Supabase migration-history JSON snapshot. Purely offline: no network access,
 * database credentials, queries, migrations, or customer records.
 *
 * Usage:
 *   node scripts/audit-production-migrations.mjs --history docs/audits/supabase-migration-history-2026-11-01.json
 *   node scripts/audit-production-migrations.mjs --history /path/to/fresh-history.json --strict
 *
 * A matching migration name is NOT proof of equivalent schema/function bodies.
 * --strict intentionally fails on *any* mismatch, including known renumbering.
 */
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const migrationsDirectory = fileURLToPath(new URL("../supabase/migrations/", import.meta.url));

export function auditMigrationHistory(localFiles, hostedMigrations) {
  if (!Array.isArray(localFiles) || !Array.isArray(hostedMigrations)) {
    throw new TypeError("Expected local filename array and hosted migrations array");
  }

  const local = localFiles.filter((f) => f.endsWith(".sql")).map((filename) => {
    const match = /^(\d{14})_([a-z0-9_]+)\.sql$/.exec(filename);
    if (!match) throw new Error(`Invalid migration filename: ${filename}`);
    return { filename, version: match[1], name: match[2] };
  });
  const hosted = hostedMigrations.map((m) => {
    if (!m || typeof m.version !== "string" || typeof m.name !== "string") {
      throw new Error("Each hosted migration must include string version and name");
    }
    if (!/^\d{14}$/.test(m.version) || !/^[a-z0-9_]+$/.test(m.name)) {
      throw new Error(`Invalid hosted migration: ${JSON.stringify(m)}`);
    }
    return { version: m.version, name: m.name };
  });

  const unique = (entries, key, location) => {
    const seen = new Set();
    for (const entry of entries) {
      if (seen.has(entry[key])) throw new Error(`Duplicate ${key} in ${location}: ${entry[key]}`);
      seen.add(entry[key]);
    }
  };
  unique(local, "version", "local");
  unique(hosted, "version", "hosted");
  unique(hosted, "name", "hosted");

  const hostedByVersion = new Map(hosted.map((entry) => [entry.version, entry]));
  const hostedByName = new Map(hosted.map((entry) => [entry.name, entry]));
  const used = new Set();

  const exact = [];
  const renumbered = [];
  const unrecorded = [];
  const conflicts = [];

  for (const entry of local) {
    const atVersion = hostedByVersion.get(entry.version);
    if (atVersion) {
      used.add(atVersion.version);
      if (atVersion.name === entry.name) exact.push(entry);
      else conflicts.push({ ...entry, hostedName: atVersion.name });
      continue;
    }
    const atName = hostedByName.get(entry.name);
    if (atName) {
      used.add(atName.version);
      renumbered.push({ ...entry, hostedVersion: atName.version });
      continue;
    }
    unrecorded.push(entry);
  }

  const hostedOnly = hosted.filter((entry) => !used.has(entry.version));
  return {
    localCount: local.length,
    hostedCount: hosted.length,
    exact,
    renumbered,
    unrecorded,
    conflicts,
    hostedOnly,
  };
}

async function main(args) {
  const idx = args.indexOf("--history");
  if (idx < 0 || !args[idx + 1]) {
    throw new Error("Usage: node scripts/audit-production-migrations.mjs --history <snapshot.json> [--strict]");
  }
  const historyPath = resolve(args[idx + 1]);
  const payload = JSON.parse(await readFile(historyPath, "utf8"));
  const history = Array.isArray(payload) ? payload : payload.migrations;
  const result = auditMigrationHistory(await readdir(migrationsDirectory), history);

  console.log(`Local SQL files: ${result.localCount}; hosted history: ${result.hostedCount}`);
  console.log(`Exact version+name: ${result.exact.length}`);
  console.log(`Same name, different version (must inspect live schema): ${result.renumbered.length}`);
  for (const row of result.renumbered) console.log(`  RENNUMBERED: ${row.filename} -> ${row.hostedVersion}_${row.name}`);
  console.log(`Not recorded in hosted history: ${result.unrecorded.length}`);
  for (const row of result.unrecorded) console.log(`  UNRECORDED: ${row.filename}`);
  console.log(`Version/name conflicts: ${result.conflicts.length}; hosted-only entries: ${result.hostedOnly.length}`);
  for (const row of result.conflicts) console.log(`  CONFLICT: ${row.filename} vs ${row.hostedName}`);
  for (const row of result.hostedOnly) console.log(`  HOSTED_ONLY: ${row.version}_${row.name}`);
  console.log("NOTICE: This is a history comparison only, NOT proof of schema equivalence. Never auto-apply or repair migrations based on it.");

  if (args.includes("--strict") && (result.renumbered.length || result.unrecorded.length || result.conflicts.length || result.hostedOnly.length)) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
