/**
 * Turning notifications on, wherever the customer is: the app asks iOS
 * (APNs), the website subscribes the browser (Web Push). Call from a tap.
 */
import { enablePush, isNative } from "./native";
import { turnOnWebPush } from "./webpush";

export function enableNotifications(): Promise<boolean> {
  if (isNative) return enablePush().catch(() => false);
  return turnOnWebPush().then((state) => state === "on");
}
