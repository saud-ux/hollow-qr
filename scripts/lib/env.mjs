/**
 * Loads KEY=VALUE pairs from .env and .dev.vars (if present) into process.env
 * without overriding variables already set in the shell. Never prints values.
 */
import { existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";

export function loadLocalEnv(root = process.cwd()) {
  for (const file of [".env", ".dev.vars"]) {
    const path = join(root, file);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!m || line.trim().startsWith("#")) continue;
      const value = m[2].replace(/^(['"])(.*)\1$/, "$2");
      if (process.env[m[1]] === undefined && value !== "") process.env[m[1]] = value;
    }
  }
}

export function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : "";
}

export function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

/** Prompts for a secret without echoing it to the terminal. */
export function promptHidden(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const write = rl._writeToOutput?.bind(rl);
    rl._writeToOutput = (s) => {
      if (s.includes(question)) write?.(s);
      else write?.("*");
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

export function requireEnv(...names) {
  const missing = names.filter((n) => !process.env[n]);
  if (missing.length) {
    console.error(`Missing required environment variables: ${missing.join(", ")}`);
    console.error("Set them in your shell, .env or .dev.vars (never commit these files).");
    process.exit(1);
  }
}

export function strongPassword(p) {
  return typeof p === "string" && p.length >= 8 && p.length <= 128 && /[A-Za-z]/.test(p) && /\d/.test(p);
}
