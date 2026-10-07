import { describe, expect, it } from "vitest";
import { appLinkPath } from "../../src/shared/app-links";

describe("links from the widget and the lock-screen tracker", () => {
  it("opens the order, the card or the menu", () => {
    expect(appLinkPath("hollowcoffee://orders/11111111-2222-4333-8444-555555555555")).toBe("/orders/11111111-2222-4333-8444-555555555555");
    expect(appLinkPath("hollowcoffee://wallet")).toBe("/wallet");
    expect(appLinkPath("HOLLOWCOFFEE://menu/")).toBe("/menu");
  });

  it("ignores anything else", () => {
    expect(appLinkPath("hollowcoffee://staff/orders")).toBeNull();
    expect(appLinkPath("hollowcoffee://orders/../wallet")).toBeNull();
    expect(appLinkPath("https://example.com/wallet")).toBeNull();
  });
});
