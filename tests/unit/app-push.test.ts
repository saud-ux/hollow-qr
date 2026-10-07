import { describe, expect, it } from "vitest";
import { silentLogger } from "../../src/server/lib/logger";
import { ApnsTokenSender, AppPushKeyError, apnsKeyDer } from "../../src/server/push/app-push";
import { orderStatusMessage } from "../../src/server/push/order-notifications";
import { base64ToBytes, bytesToBase64 } from "../../src/server/security/encoding";
import type { Order } from "../../src/shared/ordering";

const DEVICE = "a1".repeat(32);

async function p8(): Promise<{ pem: string; publicKey: CryptoKey }> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  const b64 = bytesToBase64(der).replace(/(.{64})/g, "$1\n");
  return { pem: `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----\n`, publicKey: pair.publicKey };
}

const b64url = (s: string) => base64ToBytes(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));

function fakeFetch(responses: Response[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher = (input: string, init?: RequestInit) => {
    calls.push({ url: input, init: init! });
    return Promise.resolve(responses.shift() ?? new Response(null, { status: 200 }));
  };
  return { calls, fetcher: fetcher as unknown as typeof fetch };
}

describe("ApnsTokenSender", () => {
  it("sends an alert with a valid ES256 provider token", async () => {
    const { pem, publicKey } = await p8();
    const { calls, fetcher } = fakeFetch([]);
    const sender = new ApnsTokenSender(
      { authKey: pem, keyId: "ABC123DEFG", teamId: "N2KXQ7MVY3", bundleId: "com.hollowzulfi.coffee" },
      silentLogger,
      fetcher,
    );
    const outcome = await sender.send(DEVICE, { title: "HOLLOW", body: "طلبك جاهز", collapseId: "order-1", data: { orderId: "order-1" } });
    expect(outcome).toBe("sent");
    expect(calls).toHaveLength(1);
    const { url, init } = calls[0]!;
    expect(url).toBe(`https://api.push.apple.com/3/device/${DEVICE}`);
    const headers = init.headers as Record<string, string>;
    expect(headers).toMatchObject({
      "apns-topic": "com.hollowzulfi.coffee",
      "apns-push-type": "alert",
      "apns-collapse-id": "order-1",
    });
    expect(JSON.parse(init.body as string)).toEqual({
      aps: { alert: { title: "HOLLOW", body: "طلبك جاهز" }, sound: "default" },
      orderId: "order-1",
    });

    const jwt = headers.authorization!.replace(/^bearer /, "");
    const [h, c, s] = jwt.split(".");
    expect(JSON.parse(new TextDecoder().decode(b64url(h!)))).toEqual({ alg: "ES256", kid: "ABC123DEFG" });
    expect(JSON.parse(new TextDecoder().decode(b64url(c!)))).toMatchObject({ iss: "N2KXQ7MVY3" });
    const valid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      publicKey,
      b64url(s!),
      new TextEncoder().encode(`${h}.${c}`),
    );
    expect(valid).toBe(true);
  });

  it("reuses the provider token and reports dead device tokens", async () => {
    const { pem } = await p8();
    const { calls, fetcher } = fakeFetch([
      new Response(null, { status: 200 }),
      new Response(JSON.stringify({ reason: "Unregistered" }), { status: 410 }),
      new Response(JSON.stringify({ reason: "BadDeviceToken" }), { status: 400 }),
      new Response(JSON.stringify({ reason: "TooManyRequests" }), { status: 429 }),
    ]);
    const sender = new ApnsTokenSender({ authKey: pem, keyId: "ABC123DEFG", teamId: "N2KXQ7MVY3", bundleId: "b" }, silentLogger, fetcher);
    const msg = { title: "t", body: "b" };
    expect(await sender.send(DEVICE, msg)).toBe("sent");
    expect(await sender.send(DEVICE, msg)).toBe("invalid-token");
    expect(await sender.send(DEVICE, msg)).toBe("invalid-token");
    expect(await sender.send(DEVICE, msg)).toBe("failed");
    expect(await sender.send("not-a-token", msg)).toBe("invalid-token");
    const auths = calls.map((c) => (c.init.headers as Record<string, string>).authorization);
    expect(new Set(auths).size).toBe(1);
  });

  it("accepts the .p8 as PEM or base64, and rejects other keys", async () => {
    const { pem } = await p8();
    const der = apnsKeyDer(pem);
    expect(apnsKeyDer(bytesToBase64(new TextEncoder().encode(pem)))).toEqual(der);
    expect(() => apnsKeyDer("-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----")).toThrow(AppPushKeyError);
    const sender = new ApnsTokenSender({ authKey: "bm90IGEga2V5", keyId: "K", teamId: "T", bundleId: "b" }, silentLogger, fakeFetch([]).fetcher);
    expect(await sender.send(DEVICE, { title: "t", body: "b" })).toBe("failed");
  });
});

describe("orderStatusMessage", () => {
  const base = { id: "o1", orderNumber: 12, fulfillment: "pickup", cancelledBy: null, cancelReason: null, loyaltyResult: null } as unknown as Order;

  it("words each step for the way the order is collected", () => {
    expect(orderStatusMessage({ ...base, status: "new", totalHalalas: 1550 })).toMatchObject({
      title: "استلمنا طلبك! 🤩",
      body: "طلبك رقم 12 (الإجمالي 15.50 ر.س - دفع عند الاستلام). ثواني ونبدأ!",
    });
    expect(orderStatusMessage({ ...base, status: "preparing" })).toMatchObject({ title: "شغّالين على طلبك! ☕", body: "طلبك رقم 12 قيد التحضير، جهّز نفسك!" });
    expect(orderStatusMessage({ ...base, status: "ready" })).toMatchObject({ title: "قهوتك تناديك! 📣", body: "طلبك رقم 12 جاهز، ننتظرك عند الكاشير!" });
    expect(orderStatusMessage({ ...base, status: "ready", fulfillment: "curbside" })).toMatchObject({
      title: "طلبك جاهز للتحريك! 🚗",
      body: "طلبك رقم 12 جاهز. اضغط «وصلت» وبنجيبه لسيارتك!",
    });
    expect(orderStatusMessage({ ...base, status: "ready", fulfillment: "delivery" })!.body).toContain("المندوب");
    expect(orderStatusMessage({ ...base, status: "out_for_delivery", fulfillment: "delivery" })).toMatchObject({
      title: "قهوتك في الطريق! 🛵",
      body: "طلبك رقم 12 طلع مع المندوب وجاي لك!",
    });
    const oneCup = { redeem: null, cupsAdded: 1, cupsNotAdded: 0, skipped: false };
    expect(orderStatusMessage({ ...base, status: "completed", loyaltyResult: oneCup })!.body).toContain("1 كوب");
    expect(orderStatusMessage({ ...base, status: "cancelled", cancelledBy: "customer" })).toBeNull();
    expect(orderStatusMessage({ ...base, status: "cancelled", cancelledBy: "staff" })!.data).toEqual({ orderId: "o1" });
  });
});
