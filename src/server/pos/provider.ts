/**
 * Future POS integration seam (e.g. Loyverse). Not active in V1: the loyalty
 * system runs independently and staff add cups manually. A future provider
 * could map POS receipts to `ADD_CUPS` actions via apply_loyalty_action()
 * using the receipt ID as the idempotency key.
 */
export interface PosPurchase {
  externalReceiptId: string;
  memberId: string | null;
  drinkCount: number;
  occurredAt: string;
}

export interface POSProvider {
  readonly name: string;
  readonly enabled: boolean;
  /** Parse and authenticate an inbound POS webhook into purchases. */
  parseWebhook(request: Request): Promise<PosPurchase[]>;
}

export class NoopPOSProvider implements POSProvider {
  readonly name = "none";
  readonly enabled = false;
  parseWebhook(): Promise<PosPurchase[]> {
    return Promise.resolve([]);
  }
}
