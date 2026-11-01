/**
 * Zero-cost, isolated business journey.
 *
 * Uses a disposable PGlite database populated by committed migrations,
 * fake auth identities, and fake notification/payment integrations.
 * NEVER connects to the live Supabase or Cloudflare deployments.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Order, MenuResponse } from "../../src/shared/ordering";
import type { MeResponse } from "../../src/shared/types";
import { bearer, buildTestApp } from "../helpers/app";
import { accountFor, createAuthUser, createTestDb } from "../helpers/db";

const ALWAYS_OPEN = Array.from({ length: 7 }, () => ({
  closed: false,
  open: "00:00",
  close: "00:00",
}));

describe("isolated customer → staff → admin business journey", () => {
  it("enforces roles, creates and completes orders, then awards and redeems loyalty cups", async () => {
    const db = await createTestDb();
    try {
      const { app } = buildTestApp(db);
      const admin = await createAuthUser(db, {
        email: "owner@functional-test.invalid",
        name: "Owner",
        role: "admin",
      });
      const staff = await createAuthUser(db, {
        email: "staff@functional-test.invalid",
        name: "Staff",
        role: "staff",
      });
      const customer = await createAuthUser(db, {
        email: "customer@functional-test.invalid",
        name: "Customer",
      });
      const stranger = await createAuthUser(db, {
        email: "stranger@functional-test.invalid",
        name: "Stranger",
      });

      const get = (path: string, userId?: string) =>
        app.request(path, { headers: userId ? bearer(userId) : {} });
      const send = (method: string, path: string, body: unknown, userId: string) =>
        app.request(path, {
          method,
          headers: { "content-type": "application/json", ...bearer(userId) },
          body: JSON.stringify(body),
        });

      const who = await get("/api/me", customer.id);
      expect(who.status).toBe(200);
      expect((await who.json() as MeResponse).user.role).toBe("customer");
      expect(await accountFor(db, customer.id)).toMatchObject({
        stamp_count: 0,
        reward_available: false,
      });

      // Authentication, role-based permissions and private orders.
      expect((await get("/api/me")).status).toBe(401);
      expect((await get("/api/staff/orders", customer.id)).status).toBe(403);
      expect((await get("/api/admin/stats", staff.id)).status).toBe(403);
      expect((await get("/api/admin/stats", customer.id)).status).toBe(403);
      expect((await get("/api/admin/stats", admin.id)).status).toBe(200);
      expect((await send("PUT", "/api/admin/settings", { orderingPaused: false }, staff.id)).status).toBe(403);

      // Only the owner can open the shop in the disposable database.
      expect((await send("PUT", "/api/admin/settings", {
        orderingPaused: false,
        weeklyHours: ALWAYS_OPEN,
      }, admin.id)).status).toBe(200);
      const menuResponse = await get("/api/menu");
      expect(menuResponse.status).toBe(200);
      const menu = await menuResponse.json() as MenuResponse;
      expect(menu.shop.isOpen).toBe(true);
      const drink = menu.items.find((item) =>
        item.category === "drink" && item.options.length === 0 && item.isAvailable,
      );
      expect(drink).toBeDefined();

      const createOrder = async (quantity: number, useReward = false) => {
        const body = {
          items: [{ menuItemId: drink!.id, quantity }],
          fulfillment: "pickup",
          phone: "0512345678",
          useReward,
          idempotencyKey: randomUUID(),
        };
        const res = await send("POST", "/api/orders", body, customer.id);
        expect(res.status).toBe(201);
        const order = (await res.json() as { order: Order }).order;
        return { order, body };
      };
      const finishOrder = async (id: string) => {
        let order: Order | undefined;
        for (const status of ["preparing", "ready", "completed"]) {
          const res = await send("POST", `/api/staff/orders/${id}/status`, { status }, staff.id);
          expect(res.status, `status transition: ${status}`).toBe(200);
          order = (await res.json() as { order: Order }).order;
        }
        return order!;
      };

      // Customer orders two drinks; staff sees the order, strangers do not.
      const { order: first, body: firstBody } = await createOrder(2);
      expect(first.status).toBe("new");
      expect(first.totalHalalas).toBe(2 * drink!.priceHalalas);
      expect((await get(`/api/orders/${first.id}`, stranger.id)).status).toBe(404);
      expect((await get(`/api/orders/${first.id}`, customer.id)).status).toBe(200);
      expect((await send("POST", `/api/staff/orders/${first.id}/status`, {
        status: "preparing",
      }, customer.id)).status).toBe(403);
      const board = await get("/api/staff/orders", staff.id);
      expect(board.status).toBe(200);
      expect((await board.json() as { items: Order[] }).items.map((o) => o.id)).toContain(first.id);

      // Retrying a submission must not charge or order twice.
      const retry = await send("POST", "/api/orders", firstBody, customer.id);
      expect(retry.status).toBe(200);
      expect((await retry.json() as { order: Order }).order.id).toBe(first.id);

      const firstDone = await finishOrder(first.id);
      expect(firstDone.loyaltyResult).toMatchObject({ cupsAdded: 2 });
      expect(await accountFor(db, customer.id)).toMatchObject({
        stamp_count: 2,
        reward_available: false,
      });

      // Three more paid drinks produce the sixth-drink reward.
      const { order: second } = await createOrder(3);
      const secondDone = await finishOrder(second.id);
      expect(secondDone.loyaltyResult).toMatchObject({ cupsAdded: 3 });
      expect(await accountFor(db, customer.id)).toMatchObject({
        stamp_count: 5,
        reward_available: true,
      });

      // One rewarded drink is free; only staff can complete its redemption.
      const { order: rewarded } = await createOrder(1, true);
      expect(rewarded.useReward).toBe(true);
      expect(rewarded.totalHalalas).toBe(0);
      const rewardDone = await finishOrder(rewarded.id);
      expect(rewardDone.loyaltyResult).toMatchObject({ redeem: "REDEEMED" });
      expect(await accountFor(db, customer.id)).toMatchObject({
        stamp_count: 0,
        reward_available: false,
      });

      // Admin reporting is still available after the journey.
      expect((await get("/api/admin/stats", admin.id)).status).toBe(200);
    } finally {
      await db.close();
    }
  });
});
