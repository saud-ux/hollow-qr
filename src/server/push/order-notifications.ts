import { flowStep, FULFILLMENT_LABELS_AR, formatSar, orderFlow, type Order } from "../../shared/ordering";
import type { PushLang, Repository } from "../data/repository";
import type { Logger } from "../lib/logger";
import type { AppPushMessage, AppPushSender, LiveActivityUpdate } from "./app-push";

const TITLE = "HOLLOW";

/** The notification for an order's new status in the app's language, or null when none is sent. */
export function orderStatusMessage(order: Order, lang: PushLang = "ar"): AppPushMessage | null {
  const text = lang === "en" ? englishText(order) : arabicText(order);
  return text === null ? null : { ...text, collapseId: order.id, data: { orderId: order.id } };
}

type PushText = { title: string; body: string };

function arabicText(order: Order): PushText | null {
  const n = order.orderNumber;
  switch (order.status) {
    case "new":
      return { title: "استلمنا طلبك! 🤩", body: `طلبك رقم ${n} (الإجمالي ${formatSar(order.totalHalalas)} ر.س - دفع عند الاستلام). ثواني ونبدأ!` };
    case "preparing":
      return { title: "شغّالين على طلبك! ☕", body: `طلبك رقم ${n} قيد التحضير، جهّز نفسك!` };
    case "ready":
      if (order.fulfillment === "pickup") return { title: "قهوتك تناديك! 📣", body: `طلبك رقم ${n} جاهز، ننتظرك عند الكاشير!` };
      if (order.fulfillment === "curbside") return { title: "طلبك جاهز للتحريك! 🚗", body: `طلبك رقم ${n} جاهز. اضغط «وصلت» وبنجيبه لسيارتك!` };
      return { title: TITLE, body: `طلبك #${n} جاهز وبيطلع لك مع المندوب قريبًا` };
    case "out_for_delivery":
      return { title: "قهوتك في الطريق! 🛵", body: `طلبك رقم ${n} طلع مع المندوب وجاي لك!` };
    case "completed": {
      const cups = order.loyaltyResult?.cupsAdded ?? 0;
      return { title: TITLE, body: cups > 0 ? `بالعافية! انضاف لبطاقتك ${cups} ${cups === 1 ? "كوب" : "أكواب"}` : "بالعافية! تم تسليم طلبك" };
    }
    case "cancelled":
      if (order.cancelledBy !== "staff") return null;
      return { title: TITLE, body: order.cancelReason ? `نعتذر، تم إلغاء طلبك #${n}: ${order.cancelReason}` : `نعتذر، تم إلغاء طلبك #${n}` };
    default:
      return null;
  }
}

function englishText(order: Order): PushText | null {
  const n = order.orderNumber;
  switch (order.status) {
    case "new":
      return { title: `Got your order #${n}! 🤩`, body: `Total SAR ${formatSar(order.totalHalalas)}, pay on pickup. Loading up...` };
    case "preparing":
      return { title: "We're on it! ☕", body: `Your order #${n} is being prepared. Ready soon!` };
    case "ready":
      if (order.fulfillment === "pickup") return { title: "Ready at the counter! 📣", body: `Order #${n} is waiting for you at the counter.` };
      if (order.fulfillment === "curbside") return { title: "Ready to roll! 🚗", body: `Order #${n} is ready. Tap "I'm here" on arrival!` };
      return { title: TITLE, body: `Your order #${n} is ready and leaving with the driver soon` };
    case "out_for_delivery":
      return { title: "On its way! 🛵", body: `Order #${n} is with the driver, heading your way!` };
    case "completed": {
      const cups = order.loyaltyResult?.cupsAdded ?? 0;
      return { title: TITLE, body: cups > 0 ? `Enjoy! ${cups} ${cups === 1 ? "cup" : "cups"} added to your card` : "Enjoy! Your order is complete" };
    }
    case "cancelled":
      if (order.cancelledBy !== "staff") return null;
      return { title: TITLE, body: order.cancelReason ? `Sorry, your order #${n} was cancelled: ${order.cancelReason}` : `Sorry, your order #${n} was cancelled` };
    default:
      return null;
  }
}

type PushDeps = { repo: Repository; appPush: AppPushSender; logger: Logger };

/** Sends one message to each token; drops tokens APNs reports as gone. Returns how many were delivered. */
export async function sendToTokens(deps: PushDeps, tokens: string[], message: AppPushMessage): Promise<number> {
  let sent = 0;
  for (const token of tokens) {
    const outcome = await deps.appPush.send(token, message);
    if (outcome === "sent") sent++;
    else if (outcome === "invalid-token") await deps.repo.deletePushToken(token);
  }
  return sent;
}

/** Sends the status notification to every device of the order's customer, and moves its lock-screen tracker on. */
export async function notifyOrderStatus(deps: PushDeps, order: Order): Promise<void> {
  if (deps.appPush.kind === "disabled") return;
  const devices = await deps.repo.pushTokensForOrder(order.id);
  let sent = 0;
  for (const lang of ["ar", "en"] as const) {
    const message = orderStatusMessage(order, lang);
    const tokens = devices.filter((d) => d.lang === lang).map((d) => d.token);
    if (message && tokens.length > 0) sent += await sendToTokens(deps, tokens, message);
  }
  if (devices.length > 0) deps.logger.info("app_push.order_status", { orderId: order.id, status: order.status, devices: devices.length, sent });
  await updateLiveActivities(deps, order);
}

/** How long a finished tracker stays on the lock screen. */
const DONE_LINGER_MS = 15 * 60 * 1000;

/**
 * The lock-screen tracker for an order's status: the same steps as the order
 * screen. A finished order ends it (the notification already alerted).
 */
export function liveActivityUpdate(order: Order, lang: PushLang, now: Date): LiveActivityUpdate {
  const state = { status: order.status, label: trackerLabel(order, lang), step: Math.max(flowStep(order), 0), steps: orderFlow(order.fulfillment).length };
  if (order.status === "completed" || order.status === "cancelled") {
    return { event: "end", state, dismissAt: new Date(now.getTime() + (order.status === "completed" ? DONE_LINGER_MS : 60_000)) };
  }
  return { event: "update", state };
}

/** Short status line for the lock screen, written to the customer. */
function trackerLabel(order: Order, lang: PushLang): string {
  const en = lang === "en";
  switch (order.status) {
    case "new":
      return en ? "Order received" : "استلمنا طلبك";
    case "preparing":
      return en ? "Preparing your order" : "نحضّر طلبك";
    case "ready":
      if (order.fulfillment === "pickup") return en ? "Ready, pick it up at the counter" : "جاهز، استلمه من الكاشير";
      if (order.fulfillment === "curbside") return en ? "Ready, we'll bring it out" : "جاهز، نطلّعه لك";
      // Delivery has no ready step for the customer: still being prepared.
      return en ? "Preparing your order" : "نحضّر طلبك";
    case "out_for_delivery":
      return en ? "Out for delivery" : "خرج للتوصيل";
    case "completed":
      return order.fulfillment === "delivery" ? (en ? "Delivered, enjoy!" : "تم التوصيل، بالعافية!") : en ? "Picked up, enjoy!" : "تم الاستلام، بالعافية!";
    case "cancelled":
      return en ? "Order cancelled" : "تم إلغاء الطلب";
    default:
      return "";
  }
}

async function updateLiveActivities(deps: PushDeps, order: Order): Promise<void> {
  const activities = await deps.repo.liveActivitiesForOrder(order.id);
  if (activities.length === 0) return;
  const now = new Date();
  for (const a of activities) {
    const outcome = await deps.appPush.sendLiveActivity(a.token, liveActivityUpdate(order, a.lang, now));
    if (outcome === "invalid-token") await deps.repo.deleteLiveActivities(order.id, a.token);
  }
  if (order.status === "completed" || order.status === "cancelled") await deps.repo.deleteLiveActivities(order.id);
}

/** What staff see when an order comes in: who, what and how it is collected. */
export function newOrderStaffMessage(order: Order): AppPushMessage {
  const lines = order.items.map((l) => `${l.quantity > 1 ? `${l.quantity}× ` : ""}${l.nameAr}${l.optionNameAr ? ` (${l.optionNameAr})` : ""}`);
  const shown = lines.slice(0, 3).join("، ") + (lines.length > 3 ? ` +${lines.length - 3}` : "");
  return {
    title: `طلب جديد #${order.orderNumber}`,
    body: `${order.customerName} · ${shown} · ${formatSar(order.totalHalalas)} ر.س · ${FULFILLMENT_LABELS_AR[order.fulfillment]}`,
    collapseId: `staff-${order.id}`,
    data: { link: "staff-orders" },
  };
}

/** Alerts staff and admins who signed in to the app and kept new-order alerts on. */
export async function notifyStaffNewOrder(deps: PushDeps, order: Order): Promise<void> {
  if (deps.appPush.kind === "disabled") return;
  const tokens = await deps.repo.staffPushTokens("new_orders");
  if (tokens.length === 0) return;
  const sent = await sendToTokens(deps, tokens, newOrderStaffMessage(order));
  deps.logger.info("app_push.staff_new_order", { orderId: order.id, devices: tokens.length, sent });
}
