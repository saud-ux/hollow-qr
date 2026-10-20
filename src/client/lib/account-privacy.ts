/** Remove this customer's remembered contact/order data, keeping appearance
 * and language preferences. Accept a Storage interface so failure modes can
 * be checked without a browser or native device.
 */
export function clearCustomerDeviceData(storage: Pick<Storage, "removeItem">, memberId?: string): void {
  const keys = ["hollow.phone", "hollow.car", "hollow.address", "hollow.cart.v1", "hollow.pendingTopup", "hollow.tracked-orders", "hollow.push.token", "hollow.search.recent"];
  if (memberId) keys.push(`hollow.cups.seen.${memberId}`);
  for (const key of keys) {
    try { storage.removeItem(key); } catch { /* Other keys may still be removable. */ }
  }
}
