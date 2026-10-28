/** All amounts are integer halalas. Gift cups are separate from loyalty. */
export interface BenefitMovement {
  id: string;
  actor_name?: string | null;
  amount_halalas: number;
  cups: number;
  reason: string;
  created_at: string;
}
export interface BenefitAccount {
  balance_halalas: number;
  gift_cups: number;
  movements: BenefitMovement[];
  gift_item_ids: string[];
}
export interface BenefitQuote {
  ok: boolean;
  code?: string;
  subtotal: number;
  fee: number;
  gift_discount: number;
  reward_discount: number;
  coupon_discount: number;
  total: number;
  wallet_used: number;
  due: number;
  gifts: number;
  paid_drinks: number;
  coupon_id: string | null;
  /** Menu item id → halalas the coupon took off that item (adds up to coupon_discount). Absent before migration 20261029000000. */
  coupon_by_item?: Record<string, number>;
}
export interface Coupon {
  id: string;
  code: string;
  kind: "percent" | "fixed";
  value: number;
  item_ids: string[];
  minimum_halalas: number;
  maximum_halalas: number | null;
  per_customer_limit: number | null;
  starts_at: string | null;
  ends_at: string | null;
  active: boolean;
}
export interface BenefitResult {
  ok: boolean;
  code?: string;
}
