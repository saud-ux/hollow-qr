import { FULFILLMENT_LABELS_AR, formatSar, type Order } from "../../shared/ordering";
import type { Repository } from "../data/repository";
import type { Logger } from "../lib/logger";
import type { AppPushMessage, AppPushSender } from "./app-push";

const TITLE = "HOLLOW";

/** The notification for an order's new status, or null when none is sent. */
export function orderStatusMessage(order: Order): AppPushMessage | null {
  const n = `#${order.orderNumber}`;
  let body: string;
  switch (order.status) {
    case "new":
      body = `استلمنا طلبك ${n} · الإجمالي ${formatSar(order.totalHalalas)} ر.س، والدفع عند الاستلام. نبلغك أول ما نبدأ نحضّره`;
      break;
    case "preparing":
      body = `بدأنا نحضّر طلبك ${n} ☕`;
      break;
    case "ready":
      if (order.fulfillment === "pickup") body = `طلبك ${n} جاهز، تفضّل استلمه من الكاشير`;
      else if (order.fulfillment === "curbside") body = `طلبك ${n} جاهز، اضغط «وصلت» إذا وصلت ونطلّعه لك`;
      else body = `طلبك ${n} جاهز وبيطلع لك مع المندوب قريبًا`;
      break;
    case "out_for_delivery":
      body = `طلبك ${n} في الطريق إليك`;
      break;
    case "completed": {
      const cups = order.loyaltyResult?.cupsAdded ?? 0;
      body = cups > 0 ? `بالعافية! انضاف لبطاقتك ${cups} ${cups === 1 ? "كوب" : "أكواب"}` : "بالعافية! تم تسليم طلبك";
      break;
    }
    case "cancelled":
      if (order.cancelledBy !== "staff") return null;
      body = order.cancelReason ? `نعتذر، تم إلغاء طلبك ${n}: ${order.cancelReason}` : `نعتذر، تم إلغاء طلبك ${n}`;
      break;
    default:
      return null;
  }
  return { title: TITLE, body, collapseId: order.id, data: { orderId: order.id } };
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
  const message = orderStatusMessage(order);
  if (!message) return;
  const tokens = await deps.repo.pushTokensForOrder(order.id);
  const sent = await sendToTokens(deps, tokens, message);
  if (tokens.length > 0) deps.logger.info("app_push.order_status", { orderId: order.id, status: order.status, devices: tokens.length, sent });
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
