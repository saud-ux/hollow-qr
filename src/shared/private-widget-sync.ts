/** Serialize native writes and discard responses from a previous account/session. */
export class PrivateWidgetSync<T> {
  private owner: string | null = null;
  private generation = 0;
  private lastSync = 0;
  private writes: Promise<void> = Promise.resolve();

  constructor(
    private readonly load: () => Promise<T>,
    private readonly write: (value: T) => Promise<void>,
    private readonly remove: () => Promise<void>,
    private readonly now: () => number = Date.now,
  ) {}

  private enqueue(work: () => Promise<void>): Promise<void> {
    const next = this.writes.then(work);
    this.writes = next.catch(() => undefined);
    return next;
  }

  async setAccount(userId: string | null): Promise<void> {
    if (this.owner !== userId) {
      this.owner = userId;
      this.generation += 1;
      this.lastSync = 0;
      const generation = this.generation;
      await this.enqueue(this.remove);
      if (generation !== this.generation) return;
    }
    if (userId) await this.refresh(true);
    else await this.clear();
  }

  async refresh(force = false): Promise<void> {
    if (!this.owner || (!force && this.now() - this.lastSync < 3000)) return;
    this.lastSync = this.now();
    const generation = this.generation;
    try {
      const value = await this.load();
      await this.enqueue(async () => {
        if (generation === this.generation && this.owner) await this.write(value);
      });
    } catch {
      // Offline: keep this account's last snapshot, never restore an older session.
    }
  }

  async clear(): Promise<void> {
    this.owner = null;
    this.generation += 1;
    this.lastSync = 0;
    await this.enqueue(this.remove);
  }
}
