/**
 * Decoding helpers for Apple certificate / key secrets.
 *
 * Secrets are stored base64-encoded (APPLE_*_BASE64) so multi-line PEM files
 * survive `wrangler secret put`. The decoded content may be PEM text or raw
 * DER. Errors never include key or certificate material.
 */
import { base64ToBytes } from "../security/encoding";

export class SigningMaterialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SigningMaterialError";
  }
}

export interface PemBlock {
  label: string;
  headers: string;
  der: Uint8Array<ArrayBuffer>;
}

export function decodeBase64Secret(name: string, value: string | undefined): Uint8Array<ArrayBuffer> {
  if (!value || !value.trim()) throw new SigningMaterialError(`${name} is not configured`);
  try {
    return base64ToBytes(value.trim());
  } catch {
    throw new SigningMaterialError(`${name} is not valid base64`);
  }
}

export function parsePemBlocks(text: string): PemBlock[] {
  const blocks: PemBlock[] = [];
  const re = /-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const label = m[1]!;
    const body = m[2]!;
    const lines = body.split(/\r?\n/);
    const headerLines = lines.filter((l) => l.includes(":"));
    const b64 = lines.filter((l) => !l.includes(":")).join("");
    blocks.push({ label, headers: headerLines.join("\n"), der: base64ToBytes(b64) });
  }
  return blocks;
}

/** Returns PEM blocks if the bytes are PEM text, otherwise null (raw DER). */
export function asPem(bytes: Uint8Array): PemBlock[] | null {
  const head = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 4096)));
  if (!head.includes("-----BEGIN")) return null;
  return parsePemBlocks(new TextDecoder().decode(bytes));
}

/** Extracts the first certificate as DER from PEM or DER input. */
export function certificateDer(name: string, bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const pem = asPem(bytes);
  if (!pem) return bytes;
  const cert = pem.find((b) => b.label === "CERTIFICATE");
  if (!cert) throw new SigningMaterialError(`${name} does not contain a PEM CERTIFICATE block`);
  return cert.der;
}
