/** API contracts shared between the Worker and the React app. */

export type AppRole = "customer" | "staff" | "admin";
export type MembershipStatus = "active" | "cancelled";

export type LoyaltyAction =
  | "ADD_CUPS"
  | "REMOVE_CUPS"
  | "REDEEM_REWARD"
  | "UNDO"
  | "CANCEL_MEMBERSHIP"
  | "REACTIVATE_MEMBERSHIP"
  | "ADMIN_ADJUSTMENT";

export type WalletMode = "mock" | "production";

export interface PublicConfig {
  appEnv: string;
  appUrl: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  requireEmailConfirmation: boolean;
  turnstileEnabled: boolean;
  turnstileSiteKey: string | null;
  walletMode: WalletMode;
  /** True only when production Wallet signing material is fully configured. */
  walletReady: boolean;
  duplicateWindowSeconds: number;
}

export interface MeResponse {
  user: {
    id: string;
    email: string;
    displayName: string;
    role: AppRole;
    emailConfirmed: boolean;
  };
  card: CustomerCard | null;
}

/** What a customer sees about their own membership. */
export interface CustomerCard {
  displayName: string;
  memberId: string;
  stampCount: number;
  rewardAvailable: boolean;
  membershipStatus: MembershipStatus;
  /** Opaque value encoded in the QR (a URL containing a signed token). */
  qrPayload: string;
  createdAt: string;
  walletMode: WalletMode;
  walletReady: boolean;
}

/** What staff/admin see after scanning or searching. */
export interface StaffCustomerView {
  accountId: string;
  memberId: string;
  displayName: string;
  /** Masked for staff (sa***@gmail.com); full for admins. */
  email: string;
  emailMasked: boolean;
  stampCount: number;
  rewardAvailable: boolean;
  membershipStatus: MembershipStatus;
  createdAt: string;
  lastMutationAt: string | null;
  /** The most recent action that UNDO would reverse, if any. */
  undoCandidate: { action: LoyaltyAction; quantity: number; createdAt: string } | null;
  /** Number of devices that registered this pass with our Wallet web service. Admin only. */
  walletDevices: number | null;
}

export interface CustomerSearchItem {
  accountId: string;
  memberId: string;
  displayName: string;
  email: string;
  stampCount: number;
  rewardAvailable: boolean;
  membershipStatus: MembershipStatus;
  createdAt: string;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface TransactionItem {
  id: string;
  accountId: string;
  memberId: string;
  customerName: string;
  actorName: string;
  actorRole: AppRole;
  action: LoyaltyAction;
  quantity: number;
  delta: number;
  previousStampCount: number;
  newStampCount: number;
  previousRewardAvailable: boolean;
  newRewardAvailable: boolean;
  previousMembershipStatus: MembershipStatus;
  newMembershipStatus: MembershipStatus;
  reversalOf: string | null;
  reversedBy: string | null;
  createdAt: string;
}

export interface DashboardStats {
  totalCustomers: number;
  activeCustomers: number;
  cancelledCustomers: number;
  newToday: number;
  newThisWeek: number;
  cupsAddedToday: number;
  rewardsAvailable: number;
  rewardsRedeemedToday: number;
  rewardsRedeemedTotal: number;
  timeZone: string;
}

export interface StaffMember {
  id: string;
  displayName: string;
  email: string;
  role: AppRole;
  createdAt: string;
}

export type StaffActionRequest =
  | { action: "ADD_CUPS"; quantity: number; idempotencyKey: string; confirmRecent?: boolean }
  | { action: "REMOVE_CUPS"; quantity?: number; idempotencyKey: string; confirmRecent?: boolean }
  | { action: "REDEEM_REWARD"; idempotencyKey: string; confirmRecent?: boolean }
  | { action: "UNDO"; idempotencyKey: string; confirmRecent?: boolean }
  | { action: "CANCEL_MEMBERSHIP"; idempotencyKey: string; confirmRecent?: boolean }
  | { action: "REACTIVATE_MEMBERSHIP"; idempotencyKey: string; confirmRecent?: boolean }
  | { action: "ADMIN_ADJUSTMENT"; targetStampCount: number; idempotencyKey: string; confirmRecent?: boolean };

export interface StaffActionResponse {
  transactionId: string;
  replayed: boolean;
  action: LoyaltyAction;
  previousStampCount: number;
  newStampCount: number;
  rewardAvailable: boolean;
  customer: StaffCustomerView;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

/** A delivery place the customer saved on their Account page. */
export type PlaceKind = "home" | "work" | "other";
export interface SavedPlace {
  id: string;
  kind: PlaceKind;
  /** Only for "other" places; home and work are named by the app. */
  label: string | null;
  address: string;
  details: string | null;
  lat: number;
  lng: number;
}
export const MAX_PLACES = 5;
