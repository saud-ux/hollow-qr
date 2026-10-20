import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(), deleteUser: vi.fn(), update: vi.fn(), select: vi.fn(),
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    rpc: mocks.rpc,
    auth: { admin: { deleteUser: mocks.deleteUser } },
    from: () => ({
      update: (value: unknown) => {
        const done = mocks.update(value) as Promise<{ error: unknown }>;
        return { eq: () => ({ is: () => done, then: done.then.bind(done) }) };
      },
      select: () => ({ is: () => ({ order: () => ({ limit: mocks.select }) }) }),
    }),
  }),
}));
import { SupabaseRepository } from "../../src/server/data/supabase-repository";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.rpc.mockResolvedValue({ data: { ok: true }, error: null });
  mocks.update.mockResolvedValue({ error: null });
  mocks.select.mockResolvedValue({ data: [{ user_id: "customer" }], error: null });
  mocks.deleteUser.mockResolvedValue({ error: null });
});

describe("durable account deletion retry", () => {
  const repo = () => new SupabaseRepository("https://example.supabase.co", "test-key");

  it("returns accepted/pending after anonymization when Auth is unavailable", async () => {
    mocks.deleteUser.mockResolvedValue({ error: { status: 503, code: "unexpected_failure" } });
    expect(await repo().deleteCustomerAccount("customer")).toEqual({ ok: true, pending: true });
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.deleteUser).toHaveBeenCalledWith("customer");
  });

  it("completes the queued request after the provider recovers", async () => {
    expect(await repo().completeAccountDeletions()).toEqual({ completed: 1, pending: 0 });
    expect(mocks.update.mock.calls[1]?.[0]).toHaveProperty("completed_at");
  });

  it("treats already removed Auth as completed, allowing a lost acknowledgement retry", async () => {
    mocks.deleteUser.mockResolvedValue({ error: { status: 404, code: "user_not_found" } });
    expect(await repo().completeAccountDeletions()).toEqual({ completed: 1, pending: 0 });
  });

  it("does not call Auth when SQL rejects deletion", async () => {
    mocks.rpc.mockResolvedValue({ data: { ok: false, code: "ACTIVE_ORDER" }, error: null });
    expect(await repo().deleteCustomerAccount("customer")).toEqual({ ok: false, code: "ACTIVE_ORDER" });
    expect(mocks.deleteUser).not.toHaveBeenCalled();
  });

  it("does not erase the queue acknowledgement if Auth still fails", async () => {
    mocks.deleteUser.mockRejectedValue(new Error("offline"));
    expect(await repo().completeAccountDeletions()).toEqual({ completed: 0, pending: 1 });
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });
});
