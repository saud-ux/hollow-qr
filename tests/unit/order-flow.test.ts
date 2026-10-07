import { describe, expect, it } from "vitest";
import { customerStatusLabel, flowStep, orderFlow, type FulfillmentType, type OrderStatus } from "../../src/shared/ordering";

const o = (status: OrderStatus, fulfillment: FulfillmentType) => ({ status, fulfillment });
const words = (fulfillment: FulfillmentType, lang: "ar" | "en") =>
  orderFlow(fulfillment).map((status) => customerStatusLabel({ status, fulfillment }, lang));

describe("the steps a customer sees", () => {
  it("pickup ends with picked up", () => {
    expect(words("pickup", "en")).toEqual(["Order received", "Preparing", "Ready for pickup", "Picked up"]);
    expect(words("pickup", "ar")).toEqual(["استلمنا طلبك", "قيد التحضير", "جاهز للاستلام", "تم الاستلام"]);
    expect(words("curbside", "en").at(-1)).toBe("Picked up");
  });

  it("delivery goes received, preparing, out for delivery, delivered", () => {
    expect(words("delivery", "en")).toEqual(["Order received", "Preparing", "Out for delivery", "Delivered"]);
    expect(words("delivery", "ar")).toEqual(["استلمنا طلبك", "قيد التحضير", "خرج للتوصيل", "تم التوصيل"]);
  });

  it("shows a delivery waiting for the driver as still preparing", () => {
    expect(flowStep(o("ready", "delivery"))).toBe(1);
    expect(customerStatusLabel(o("ready", "delivery"), "en")).toBe("Preparing");
    expect(flowStep(o("out_for_delivery", "delivery"))).toBe(2);
    expect(flowStep(o("ready", "pickup"))).toBe(2);
    expect(flowStep(o("cancelled", "pickup"))).toBe(-1);
  });
});
