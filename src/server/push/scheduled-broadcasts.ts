/**
 * Scheduled offers. A cron run (every minute) claims the oldest due offer,
 * sends it to one batch of opted-in devices and records where it stopped, so
 * a large audience is reached over a few runs without passing the Worker's
 * subrequest limit. The lease on the claim keeps two runs off the same batch.
 */
import type { Repository } from "../data/repository";
import { pushOff, sendToDevices, type PushDeps } from "./order-notifications";

/** Same size as a batch sent from the admin page. */
export const SCHEDULED_BATCH = 35;

export type ScheduledRun = "disabled" | "idle" | { id: string; sent: number; finished: boolean };

export async function runScheduledBroadcasts(deps: PushDeps & { repo: Repository }, now: Date): Promise<ScheduledRun> {
  if (pushOff(deps)) return "disabled";
  const broadcast = await deps.repo.claimDueBroadcast(now);
  if (!broadcast) return "idle";
  const devices = await deps.repo.offerPushDevices(broadcast.cursor, SCHEDULED_BATCH);
  const delivered = devices.length
    ? await sendToDevices(deps, devices, {
        title: broadcast.title,
        body: broadcast.body,
        collapseId: `offer-${broadcast.id}`,
        data: { link: "menu" },
      })
    : 0;
  const finished = devices.length < SCHEDULED_BATCH;
  const sent = broadcast.sent + delivered;
  const cursor = devices.length ? devices[devices.length - 1]!.token : broadcast.cursor;
  await deps.repo.advanceBroadcast(broadcast.id, sent, cursor, finished, now);
  if (finished) deps.logger.info("broadcast.sent", { id: broadcast.id, sent, recipients: broadcast.recipients, scheduled: true });
  return { id: broadcast.id, sent, finished };
}
