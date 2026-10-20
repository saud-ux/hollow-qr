import { describe, expect, it } from "vitest";
import { clearCustomerDeviceData } from "../../src/client/lib/account-privacy";

describe("account deletion device cleanup", () => {
  it("clears contact, order and benefit history without changing appearance preferences", () => {
    const values = new Map([
      ["hollow.phone", "0512345678"], ["hollow.car", "personal car"],
      ["hollow.address", "personal address"], ["hollow.cart.v1", "private notes"],
      ["hollow.search.recent", "private search"], ["hollow.cups.seen.member", "5"],
      ["hollow.pendingTopup", "payment"], ["hollow.tracked-orders", "order"],
      ["hollow.push.token", "token"], ["hollow.theme", "dark"], ["hollow.locale", "ar"],
    ]);
    clearCustomerDeviceData({ removeItem: (key) => { values.delete(key); } }, "member");
    expect([...values]).toEqual([["hollow.theme", "dark"], ["hollow.locale", "ar"]]);
  });

  it("continues clearing other keys if a storage operation throws", () => {
    const attempted: string[] = [];
    clearCustomerDeviceData({ removeItem: (key) => {
      attempted.push(key);
      if (key === "hollow.phone") throw new Error("storage unavailable");
    } });
    expect(attempted).toContain("hollow.search.recent");
    expect(attempted).toContain("hollow.cart.v1");
  });
});
