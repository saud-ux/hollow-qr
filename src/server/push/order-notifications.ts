import { amountDue, flowStep, FULFILLMENT_LABELS_AR, formatSar, orderFlow, type Order } from "../../shared/ordering";
import type { PushDevice, PushLang, Repository } from "../data/repository";
import type { Logger } from "../lib/logger";
import type { AppPushMessage, AppPushSender, LiveActivityUpdate } from "./app-push";
import type { WebPushSender } from "./web-push";

const TITLE = "HOLLOW";

/** The notification for an order's new status, in Arabic on every phone whatever its language, or null when none is sent. */
export function orderStatusMessage(order: Order): AppPushMessage | null {
  const text = arabicText(order);
  return text === null ? null : { ...text, collapseId: order.id, data: { orderId: order.id } };
}

type PushText = { title: string; body: string };

const paidFromBalance = (order: Order) => (order.walletHalalas ?? 0) > 0;

/** What is left to pay and where: the balance already paid part of it, and delivery is paid on delivery. */
function amountAr(order: Order): string {
  const due = amountDue(order);
  if (due === 0) return paidFromBalance(order) ? "مدفوع بالكامل من رصيدك" : "لا يوجد مبلغ للدفع";
  return `${paidFromBalance(order) ? "المتبقي" : "الإجمالي"} ${formatSar(due)} ر.س - دفع عند ${order.fulfillment === "delivery" ? "التوصيل" : "الاستلام"}`;
}

function arabicText(order: Order): PushText | null {
  const n = order.orderNumber;
  switch (order.status) {
    case "new":
      return { title: "استلمنا طلبك! 🤩", body: `طلبك رقم ${n} (${amountAr(order)}). ثواني ونبدأ!` };
    case "preparing":
      return { title: "شغّالين على طلبك! ☕", body: `طلبك رقم ${n} قيد التحضير، جهّز نفسك!` };
    case "ready":
      if (order.fulfillment === "pickup") return { title: "قهوتك تناديك! 📣", body: `طلبك رقم ${n} جاهز، ننتظرك عند الكاشير!` };
      if (order.fulfillment === "curbside") return { title: "طلبك جاهز! 🚗", body: `طلبك رقم ${n} جاهز. اضغط «وصلت» وبنجيبه لسيارتك!` };
      return { title: TITLE, body: `طلبك #${n} جاهز وبيطلع لك مع المندوب قريبًا` };
    case "out_for_delivery":
      return { title: "قهوتك بالطريق!💨🚗", body: `طلبك رقم ${n} طلع مع المندوب وجاي لك!` };
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

export type PushDeps = { repo: Repository; appPush: AppPushSender; webPush: WebPushSender; logger: Logger };

/** Neither the app nor the website can be notified (production without keys or a database). */
export const pushOff = (deps: PushDeps) => deps.appPush.kind === "disabled" && deps.webPush.kind === "disabled";

/**
 * Sends one message to each device (the app through APNs, browsers through
 * Web Push); drops devices the push service reports as gone. Returns how many were delivered.
 */
export async function sendToDevices(deps: PushDeps, devices: PushDevice[], message: AppPushMessage): Promise<number> {
  let sent = 0;
  for (const device of devices) {
    const outcome = device.web ? await deps.webPush.send(device.web, message) : await deps.appPush.send(device.token, message);
    if (outcome === "sent") sent++;
    else if (outcome === "invalid-token") await deps.repo.deletePushToken(device.token);
  }
  return sent;
}

/** Sends the status notification to every device of the order's customer, and moves its lock-screen tracker on. */
export async function notifyOrderStatus(deps: PushDeps, order: Order): Promise<void> {
  if (pushOff(deps)) return;
  const devices = await deps.repo.pushDevicesForOrder(order.id);
  const message = orderStatusMessage(order);
  const sent = message && devices.length > 0 ? await sendToDevices(deps, devices, message) : 0;
  if (devices.length > 0) deps.logger.info("app_push.order_status", { orderId: order.id, status: order.status, devices: devices.length, sent });
  if (deps.appPush.kind !== "disabled") await updateLiveActivities(deps, order);
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
    body: `${order.customerName} · ${shown} · ${paidFromBalance(order) ? "المتبقي " : ""}${formatSar(amountDue(order))} ر.س · ${FULFILLMENT_LABELS_AR[order.fulfillment]}`,
    collapseId: `staff-${order.id}`,
    data: { link: "staff-orders" },
  };
}

/** Alerts staff and admins who turned notifications on and kept new-order alerts on. */
export async function notifyStaffNewOrder(deps: PushDeps, order: Order): Promise<void> {
  if (pushOff(deps)) return;
  const devices = await deps.repo.staffPushDevices("new_orders");
  if (devices.length === 0) return;
  const sent = await sendToDevices(deps, devices, newOrderStaffMessage(order));
  deps.logger.info("app_push.staff_new_order", { orderId: order.id, devices: devices.length, sent });
}
