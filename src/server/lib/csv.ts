/**
 * CSV generation for admin exports.
 *  - RFC 4180 quoting
 *  - CSV/formula-injection protection: cells starting with = + - @ TAB CR
 *    are prefixed with an apostrophe so Excel treats them as text
 *  - UTF-8 with BOM so Excel opens Arabic text correctly
 */
export const CSV_BOM = "﻿";

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  // Numbers and booleans are emitted as-is (a negative delta stays numeric).
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  let s = value instanceof Date ? value.toISOString() : typeof value === "string" ? value : JSON.stringify(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function csvRow(values: unknown[]): string {
  return values.map(csvCell).join(",");
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return CSV_BOM + [csvRow(header), ...rows.map(csvRow)].join("\r\n") + "\r\n";
}
