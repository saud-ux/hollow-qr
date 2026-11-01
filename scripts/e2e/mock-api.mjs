// Local, read-only simulator fixture. This server must never proxy to production.
import { createServer } from "node:http";

const HOST = "127.0.0.1";
const PORT = 8765;
const HOURS = Array.from({ length: 7 }, () => ({
  closed: false,
  open: "00:00",
  close: "23:59",
}));

const config = {
  appEnv: "e2e-isolated",
  appUrl: `http://${HOST}:${PORT}`,
  supabaseUrl: `http://${HOST}:${PORT}`,
  supabaseAnonKey: "e2e-public-placeholder-not-a-real-key",
  requireEmailConfirmation: false,
  turnstileEnabled: false,
  turnstileSiteKey: null,
  walletMode: "mock",
  walletReady: false,
  duplicateWindowSeconds: 30,
};

const baseItem = {
  nameEn: null,
  descriptionAr: null,
  descriptionEn: null,
  imageUrl: null,
  isAvailable: true,
  isArchived: false,
  sortOrder: 0,
  optionLabel: null,
  optionLabelEn: null,
  options: [],
  calories: null,
  isBestSeller: false,
  stockQuantity: null,
  discountPercent: null,
  salePriceHalalas: null,
};
const menu = {
  shop: {
    isOpen: true,
    settings: {
      orderingPaused: false,
      pickupEnabled: true,
      curbsideEnabled: true,
      deliveryEnabled: false,
      deliveryFeeHalalas: 0,
      deliveryMinOrderHalalas: 0,
      weeklyHours: HOURS,
    },
  },
  items: [
    {
      ...baseItem,
      id: "00000000-0000-4000-8000-000000000001",
      nameAr: "إسبريسو تجريبي",
      nameEn: "QA Espresso",
      category: "drink",
      priceHalalas: 1200,
    },
    {
      ...baseItem,
      id: "00000000-0000-4000-8000-000000000002",
      nameAr: "حلوى تجريبية",
      nameEn: "QA Dessert",
      category: "dessert",
      priceHalalas: 1800,
      sortOrder: 1,
    },
  ],
};

const getHandlers = new Map([
  ["/health", { status: "ok", environment: "e2e-isolated" }],
  ["/api/public-config", config],
  ["/api/menu", menu],
]);

const server = createServer((req, res) => {
  const origin = req.headers.origin;
  // Only allow the test app's Capacitor origin, with no cookies or credentials.
  if (origin === "capacitor://localhost") {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method === "OPTIONS") {
    res.writeHead(origin === "capacitor://localhost" ? 204 : 403);
    res.end();
    return;
  }

  // Explicit deny for *every* write and unrecognized endpoint.
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405);
    res.end(JSON.stringify({ error: { code: "E2E_READ_ONLY", message: "Writes disabled in test fixture" } }));
    return;
  }
  const path = new URL(req.url ?? "/", `http://${HOST}`).pathname;
  const response = getHandlers.get(path);
  if (!response) {
    res.writeHead(404);
    res.end(JSON.stringify({ error: { code: "E2E_NOT_MOCKED", message: "Endpoint not mocked" } }));
    return;
  }
  res.writeHead(200);
  res.end(req.method === "HEAD" ? undefined : JSON.stringify(response));
});
server.listen(PORT, HOST, () => {
  process.stdout.write(`E2E fixture listening at http://${HOST}:${PORT} (no upstream, no writes)\n`);
});
