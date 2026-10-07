import { FULFILLMENT_LABELS_AR, formatSar, type Order } from "../../shared/ordering";
import type { PushLang, Repository } from "../data/repository";
import type { Logger } from "../lib/logger";
import type { AppPushMessage, AppPushSender } from "./app-push";

const TITLE = "HOLLOW";

/** The notification for an order's new status in the app's language, or null when none is sent. */
export function orderStatusMessage(order: Order, lang: PushLang = "ar"): AppPushMessage | null {
  const body = lang === "en" ? englishBody(order) : arabicBody(order);
  return body === null ? null : { title: TITLE, body, collapseId: order.id, data: { orderId: order.id } };
}

function arabicBody(order: Order): string | null {
  const n = `#${order.orderNumber}`;
  switch (order.status) {
    case "new":
      return `استلمنا طلبك ${n} · الإجمالي ${formatSar(order.totalHalalas)} ر.س، والدفع عند الاستلام. نبلغك أول ما نبدأ نحضّره`;
    case "preparing":
      return `بدأنا نحضّر طلبك ${n} ☕`;
    case "ready":
      if (order.fulfillment === "pickup") return `طلبك ${n} جاهز، تفضّل استلمه من الكاشير`;
      if (order.fulfillment === "curbside") return `طلبك ${n} جاهز، اضغط «وصلت» إذا وصلت ونطلّعه لك`;
      return `طلبك ${n} جاهز وبيطلع لك مع المندوب قريبًا`;
    case "out_for_delivery":
      return `طلبك ${n} في الطريق إليك`;
    case "completed": {
      const cups = order.loyaltyResult?.cupsAdded ?? 0;
      return cups > 0 ? `بالعافية! انضاف لبطاقتك ${cups} ${cups === 1 ? "كوب" : "أكواب"}` : "بالعافية! تم تسليم طلبك";
    }
    case "cancelled":
      if (order.cancelledBy !== "staff") return null;
      return order.cancelReason ? `نعتذر، تم إلغاء طلبك ${n}: ${order.cancelReason}` : `نعتذر، تم إلغاء طلبك ${n}`;
    default:
      return null;
  }
}

function englishBody(order: Order): string | null {
  const n = `#${order.orderNumber}`;
  switch (order.status) {
    case "new":
      return `We got your order ${n} · Total SAR ${formatSar(order.totalHalalas)}, pay on pickup. We'll let you know when we start on it`;
    case "preparing":
      return `We're preparing your order ${n} ☕`;
    case "ready":
      if (order.fulfillment === "pickup") return `Your order ${n} is ready, pick it up at the counter`;
      if (order.fulfillment === "curbside") return `Your order ${n} is ready. Tap "I'm here" when you arrive and we'll bring it out`;
      return `Your order ${n} is ready and leaving with the driver soon`;
    case "out_for_delivery":
      return `Your order ${n} is on its way`;
    case "completed": {
      const cups = order.loyaltyResult?.cupsAdded ?? 0;
      return cups > 0 ? `Enjoy! ${cups} ${cups === 1 ? "cup" : "cups"} added to your card` : "Enjoy! Your order is complete";
    }
    case "cancelled":
      if (order.cancelledBy !== "staff") return null;
      return order.cancelReason ? `Sorry, your order ${n} was cancelled: ${order.cancelReason}` : `Sorry, your order ${n} was cancelled`;
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

/** Sends the status notification to every device of the order's customer. */
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
