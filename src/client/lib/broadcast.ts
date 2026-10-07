import type { Broadcast } from "../../shared/ordering";
import { apiPost } from "./api";

/**
 * Sends an offer push to everyone who opted in, one batch per request (the
 * server says where to continue). Returns how many devices it reached.
 */
export async function sendBroadcast(title: string, body: string, onProgress?: (sent: number, of: number) => void): Promise<number> {
  const { broadcast } = await apiPost<{ broadcast: Broadcast }>("/api/admin/broadcasts", { title, body });
  onProgress?.(0, broadcast.recipients);
  let after: string | null = null;
  let sent = 0;
  for (let round = 0; round < 200; round++) {
    const r: { sent: number; next: string | null } = await apiPost(`/api/admin/broadcasts/${broadcast.id}/send`, { after });
    sent = r.sent;
    onProgress?.(sent, broadcast.recipients);
    if (!r.next) break;
    after = r.next;
  }
  return sent;
}
