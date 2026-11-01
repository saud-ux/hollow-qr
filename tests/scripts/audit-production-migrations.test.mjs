import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { auditMigrationHistory } from "../../scripts/audit-production-migrations.mjs";

const migrationDir = fileURLToPath(new URL("../../supabase/migrations/", import.meta.url));
const snapshotPath = fileURLToPath(new URL("../../docs/audits/supabase-migration-history-2026-11-01.json", import.meta.url));

test("historical production snapshot has documented differences and no unexpected orphans", () => {
  const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
  const result = auditMigrationHistory(readdirSync(migrationDir).filter((f) => f.endsWith(".sql") && f.slice(0, 8) <= "20261031").sort(), snapshot.migrations);
  assert.equal(result.localCount, 28);
  assert.equal(result.hostedCount, 27);
  assert.equal(result.exact.length, 25);
  assert.deepEqual(
    result.renumbered.map((m) => [m.name, m.hostedVersion]),
    [["customer_cars", "20261027093823"], ["coupon_by_item", "20261028115232"]],
  );
  assert.deepEqual(result.unrecorded.map((m) => m.name), ["explicit_where_on_deletes"]);
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.hostedOnly.length, 0);
});

test("distinguishes matching versions, renamed versions, missing history and version conflicts", () => {
  const r = auditMigrationHistory([
    "20260101000000_equal.sql",
    "20260102000000_renumbered.sql",
    "20260103000000_missing.sql",
    "20260104000000_conflict.sql",
  ], [
    {version:"20260101000000",name:"equal"},
    {version:"20260102010000",name:"renumbered"},
    {version:"20260104000000",name:"different"},
    {version:"20260105000000",name:"remote_only"},
  ]);
  assert.equal(r.exact.length, 1);
  assert.equal(r.renumbered.length, 1);
  assert.equal(r.unrecorded.length, 1);
  assert.equal(r.conflicts.length, 1);
  assert.deepEqual(r.hostedOnly.map((m) => m.name), ["remote_only"]);
});

test("rejects duplicate hosted versions or names and invalid migration filenames", () => {
  const file = ["20260101000000_one.sql"];
  assert.throws(() => auditMigrationHistory(file, [
    {version:"20260101000000",name:"one"},
    {version:"20260101000000",name:"two"},
  ]), /Duplicate version/);
  assert.throws(() => auditMigrationHistory(file, [
    {version:"20260101000000",name:"one"},
    {version:"20260102000000",name:"one"},
  ]), /Duplicate name/);
  assert.throws(() => auditMigrationHistory(["not_a_migration.sql"], []), /Invalid migration filename/);
});

test("does not treat same name under another version as identical migration SQL", () => {
  const r = auditMigrationHistory(["20260101000000_foo.sql"], [{version:"20260102000000",name:"foo"}]);
  assert.equal(r.exact.length, 0);
  assert.equal(r.renumbered.length, 1);
  assert.equal(r.renumbered[0].hostedVersion, "20260102000000");
});
