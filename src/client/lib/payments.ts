import { useEffect, useState } from "react";
import type { FulfillmentType } from "../../shared/ordering";
import { tr } from "./i18n";
import { isNative } from "./native";

/**
 * How a customer pays. Paying on pickup is all that works today: the online
 * methods (through Moyasar) show in the cart as «قريبًا» until the café's
 * account is connected, then this switch turns them on.
 */
export type PaymentMethod = "applepay" | "samsungpay" | "card" | "on_pickup";

export const ONLINE_PAYMENTS_READY = false;

export const paymentReady = (method: PaymentMethod) => method === "on_pickup" || ONLINE_PAYMENTS_READY;

export function paymentLabel(method: PaymentMethod, fulfillment: FulfillmentType): string {
  if (method === "applepay") return "Apple Pay";
  if (method === "samsungpay") return "Samsung Pay";
  if (method === "card") return tr("مدى أو فيزا", "mada or Visa");
  return fulfillment === "delivery" ? tr("عند التوصيل", "On delivery") : tr("عند الاستلام", "On pickup");
}

export function paymentNote(method: PaymentMethod): string {
  if (!paymentReady(method)) return tr("قريبًا", "Soon");
  if (method === "card") return tr("بطاقة", "Card");
  if (method === "on_pickup") return tr("نقدًا أو بالشبكة", "Cash or card");
  return tr("بلمسة", "One touch");
}

type ApplePayWindow = Window & { ApplePaySession?: { canMakePayments?: () => boolean } };
type ModelHints = { getHighEntropyValues?: (hints: string[]) => Promise<{ model?: string }> };

/** In the iPhone app, and in Safari on a device with Apple Pay set up. */
function hasApplePay(): boolean {
  if (isNative) return true;
  try {
    return Boolean((window as ApplePayWindow).ApplePaySession?.canMakePayments?.());
  } catch {
    return false;
  }
}

/** Samsung's browser says so; Chrome on a Samsung phone gives its model (SM-…) when asked. */
const SAMSUNG_UA = /SamsungBrowser|\bSM-[A-Z]\d/i;

/** The ways this device can pay, phone wallets first. */
export function usePaymentMethods(): PaymentMethod[] {
  const [apple] = useState(hasApplePay);
  const [samsung, setSamsung] = useState(() => !isNative && SAMSUNG_UA.test(navigator.userAgent));
  useEffect(() => {
    if (isNative || apple || samsung) return;
    const hints = (navigator as unknown as { userAgentData?: ModelHints }).userAgentData;
    let alive = true;
    hints?.getHighEntropyValues?.(["model"]).then(
      (v) => alive && setSamsung(Boolean(v.model?.startsWith("SM-"))),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [apple, samsung]);
  return [...(apple ? (["applepay"] as const) : []), ...(samsung ? (["samsungpay"] as const) : []), "card", "on_pickup"];
}
