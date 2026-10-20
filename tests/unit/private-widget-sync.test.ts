import { describe, expect, it, vi } from "vitest";
import { PrivateWidgetSync } from "../../src/shared/private-widget-sync";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("private widget synchronization", () => {
  it("never restores a late API response after sign-out", async () => {
    const response = deferred<string>();
    const write = vi.fn().mockResolvedValue(undefined);
    const remove = vi.fn().mockResolvedValue(undefined);
    const load = vi.fn(() => response.promise);
    const sync = new PrivateWidgetSync(load, write, remove);
    const signingIn = sync.setAccount("A");
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    await sync.clear();
    response.resolve("private A");
    await signingIn;
    expect(write).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledTimes(2);
  });

  it("does not restore account A after switching directly to B", async () => {
    const a = deferred<string>();
    const load = vi.fn().mockReturnValueOnce(a.promise).mockResolvedValueOnce("private B");
    const write = vi.fn().mockResolvedValue(undefined);
    const sync = new PrivateWidgetSync(load, write, () => Promise.resolve());
    const signingInA = sync.setAccount("A");
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    await sync.setAccount("B");
    a.resolve("private A");
    await signingInA;
    expect(write.mock.calls).toEqual([["private B"]]);
  });

  it("waits for an already-started native write before clearing it", async () => {
    const nativeWrite = deferred<void>();
    const events: string[] = [];
    const sync = new PrivateWidgetSync(() => Promise.resolve("A"), async () => {
      events.push("write-start");
      await nativeWrite.promise;
      events.push("write-end");
    }, () => { events.push("clear"); return Promise.resolve(); });
    const signingIn = sync.setAccount("A");
    await vi.waitFor(() => expect(events).toContain("write-start"));
    const clearing = sync.clear();
    nativeWrite.resolve();
    await Promise.all([signingIn, clearing]);
    expect(events).toEqual(["clear", "write-start", "write-end", "clear"]);
  });

  it("preserves this user's snapshot offline and still clears on sign-out", async () => {
    const write = vi.fn();
    const remove = vi.fn().mockResolvedValue(undefined);
    const sync = new PrivateWidgetSync(() => Promise.reject(new Error("offline")), write, remove);
    await sync.setAccount("A");
    await sync.clear();
    expect(write).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledTimes(2);
  });

  it("does not fetch private data without an account", async () => {
    const load = vi.fn();
    const sync = new PrivateWidgetSync(load, () => Promise.resolve(), () => Promise.resolve());
    await sync.refresh(true);
    expect(load).not.toHaveBeenCalled();
  });
});
