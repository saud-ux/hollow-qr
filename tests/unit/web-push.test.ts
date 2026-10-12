import { describe, expect, it } from "vitest";
import { silentLogger } from "../../src/server/lib/logger";
import {
  encryptForBrowser,
  generateVapidKeys,
  isPushEndpoint,
  p256Jwk,
  VapidWebPushSender,
  webPushPayload,
  webPushToken,
} from "../../src/server/push/web-push";
import { base64UrlToBytes, bytesToBase64Url, utf8 } from "../../src/server/security/encoding";

// RFC 8291 section 5: the worked example.
const RFC = {
  plaintext: "When I grow up, I want to be a watermelon",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  asPublic: "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  uaPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  body:
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};

async function hkdf(salt: Uint8Array<ArrayBuffer>, ikm: Uint8Array<ArrayBuffer>, info: string, length: number) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info: utf8(info) }, key, length * 8));
}

/** What the browser does with a message: the other half of RFC 8291. */
async function decryptAsBrowser(body: Uint8Array<ArrayBuffer>, uaPrivateJwk: JsonWebKey, uaPublic: Uint8Array<ArrayBuffer>, auth: Uint8Array<ArrayBuffer>) {
  const salt = body.slice(0, 16);
  const idlen = body[20]!;
  const asPublic = body.slice(21, 21 + idlen);
  const sealed = body.slice(21 + idlen);
  const ua = await crypto.subtle.importKey("jwk", uaPrivateJwk, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  const as = await crypto.subtle.importKey("raw", asPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: as }, ua, 256));
  const info = new Uint8Array([...utf8("WebPush: info\0"), ...uaPublic, ...asPublic]);
  const sharedKey = await crypto.subtle.importKey("raw", shared, "HKDF", false, ["deriveBits"]);
  const ikm = new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: auth, info }, sharedKey, 256));
  const cek = await hkdf(salt, ikm, "Content-Encoding: aes128gcm\0", 16);
  const nonce = await hkdf(salt, ikm, "Content-Encoding: nonce\0", 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const record = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, sealed));
  expect(record.at(-1)).toBe(2);
  return new TextDecoder().decode(record.slice(0, -1));
}

describe("web push encryption", () => {
  it("matches the RFC 8291 worked example", async () => {
    const body = await encryptForBrowser({ p256dh: RFC.uaPublic, auth: RFC.auth }, utf8(RFC.plaintext), {
      salt: base64UrlToBytes(RFC.salt),
      serverPrivateJwk: p256Jwk(base64UrlToBytes(RFC.asPublic), RFC.asPrivate),
      serverPublic: base64UrlToBytes(RFC.asPublic),
    });
    expect(bytesToBase64Url(body)).toBe(RFC.body);
  });

  it("can be read by the browser it was made for", async () => {
    const ua = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
    const uaPublic = new Uint8Array(await crypto.subtle.exportKey("raw", ua.publicKey));
    const auth = crypto.getRandomValues(new Uint8Array(16));
    const message = JSON.stringify({ title: "قهوتك بالطريق!💨🚗", body: "طلبك رقم 12 طلع مع المندوب" });
    const body = await encryptForBrowser({ p256dh: bytesToBase64Url(uaPublic), auth: bytesToBase64Url(auth) }, utf8(message));
    expect(body.length).toBeLessThan(4096);
    expect(await decryptAsBrowser(body, await crypto.subtle.exportKey("jwk", ua.privateKey), uaPublic, auth)).toBe(message);
  });

  it("refuses keys that aren't a P-256 point and a 16-byte secret", async () => {
    await expect(encryptForBrowser({ p256dh: bytesToBase64Url(new Uint8Array(10)), auth: RFC.auth }, utf8("x"))).rejects.toThrow();
  });
});

describe("web push requests", () => {
  it("only posts to real push services", () => {
    expect(isPushEndpoint("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
    expect(isPushEndpoint("https://web.push.apple.com/QGx")).toBe(true);
    expect(isPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/x")).toBe(true);
    expect(isPushEndpoint("https://wns2-par02p.notify.windows.com/w/?token=x")).toBe(true);
    expect(isPushEndpoint("http://fcm.googleapis.com/fcm/send/abc")).toBe(false);
    expect(isPushEndpoint("https://fcm.googleapis.com:8443/x")).toBe(false);
    expect(isPushEndpoint("https://evil.example/fcm.googleapis.com")).toBe(false);
    expect(isPushEndpoint("https://user@fcm.googleapis.com/x")).toBe(false);
    expect(isPushEndpoint("not a url")).toBe(false);
  });

  it("keys each browser by the hash of its endpoint", async () => {
    const token = await webPushToken("https://fcm.googleapis.com/fcm/send/abc");
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(await webPushToken("https://fcm.googleapis.com/fcm/send/abc")).toBe(token);
  });

  it("opens the order, the menu or the staff board when tapped", () => {
    const id = "0b1f6c1e-2a3b-4c5d-8e9f-0123456789ab";
    expect(webPushPayload({ title: "t", body: "b", collapseId: `order-${id}`, data: { orderId: id } })).toEqual({ title: "t", body: "b", tag: `order-${id}`, url: `/orders/${id}` });
    expect(webPushPayload({ title: "t", body: "b", data: { link: "menu" } }).url).toBe("/menu");
    expect(webPushPayload({ title: "t", body: "b", data: { link: "staff-orders" } }).url).toBe("/staff/orders");
  });

  it("signs a VAPID token for the push service and sends the encrypted message", async () => {
    const keys = await generateVapidKeys();
    const calls: { url: string; init: RequestInit }[] = [];
    const fetcher: typeof fetch = (input, init) => {
      calls.push({ url: input instanceof Request ? input.url : input.toString(), init: init! });
      return Promise.resolve(new Response(null, { status: 201 }));
    };
    const sender = new VapidWebPushSender(() => Promise.resolve(keys), "https://rewards.hollow.test", silentLogger, fetcher);
    const ua = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
    const sub = {
      endpoint: "https://web.push.apple.com/QGxyz",
      p256dh: bytesToBase64Url(new Uint8Array(await crypto.subtle.exportKey("raw", ua.publicKey))),
      auth: bytesToBase64Url(crypto.getRandomValues(new Uint8Array(16))),
    };
    expect(await sender.send(sub, { title: "Hi", body: "There", collapseId: "order-0b1f6c1e-2a3b-4c5d-8e9f-0123456789ab" })).toBe("sent");
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(calls[0]!.url).toBe(sub.endpoint);
    expect(headers["content-encoding"]).toBe("aes128gcm");
    expect(headers.topic).toMatch(/^[A-Za-z0-9_-]{32}$/);
    const [, jwt, k] = /^vapid t=([^,]+), k=(.+)$/.exec(headers.authorization!)!;
    expect(k).toBe(keys.publicKey);
    const [h, c, s] = jwt!.split(".");
    expect(JSON.parse(new TextDecoder().decode(base64UrlToBytes(c!)))).toMatchObject({ aud: "https://web.push.apple.com", sub: "https://rewards.hollow.test" });
    const verifyKey = await crypto.subtle.importKey("raw", base64UrlToBytes(keys.publicKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    expect(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, verifyKey, base64UrlToBytes(s!), utf8(`${h}.${c}`))).toBe(true);
  });

  it("reports a browser that unsubscribed so it can be dropped", async () => {
    const keys = await generateVapidKeys();
    const gone: typeof fetch = () => Promise.resolve(new Response(null, { status: 410 }));
    const sender = new VapidWebPushSender(() => Promise.resolve(keys), "https://rewards.hollow.test", silentLogger, gone);
    const ua = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
    const sub = {
      endpoint: "https://fcm.googleapis.com/fcm/send/abc",
      p256dh: bytesToBase64Url(new Uint8Array(await crypto.subtle.exportKey("raw", ua.publicKey))),
      auth: bytesToBase64Url(crypto.getRandomValues(new Uint8Array(16))),
    };
    expect(await sender.send(sub, { title: "t", body: "b" })).toBe("invalid-token");
    expect(await sender.send({ ...sub, endpoint: "https://evil.example/x" }, { title: "t", body: "b" })).toBe("invalid-token");
  });
});
