/**
 * Structured JSON logger with defensive redaction. Callers should never pass
 * secrets, but any key that looks sensitive is masked anyway.
 */
export interface Logger {
  info(event: string, data?: Record<string, unknown>): void;
  warn(event: string, data?: Record<string, unknown>): void;
  error(event: string, data?: Record<string, unknown>): void;
}

const SENSITIVE = /(token|secret|key|password|authorization|cert|private|passphrase|cookie|jwt)/i;

export function redact(data: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!data) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    out[k] = SENSITIVE.test(k) ? "[redacted]" : v;
  }
  return out;
}

export function createLogger(sink: Pick<Console, "log" | "warn" | "error"> = console): Logger {
  const write = (level: "info" | "warn" | "error", event: string, data?: Record<string, unknown>) => {
    const line = JSON.stringify({ level, event, ...redact(data) });
    if (level === "error") sink.error(line);
    else if (level === "warn") sink.warn(line);
    else sink.log(line);
  };
  return {
    info: (e, d) => write("info", e, d),
    warn: (e, d) => write("warn", e, d),
    error: (e, d) => write("error", e, d),
  };
}

export const silentLogger: Logger = { info() {}, warn() {}, error() {} };
