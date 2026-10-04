import { maskEmail } from "../../shared/format";
import type {
  AppRole,
  CustomerSearchItem,
  DashboardStats,
  StaffCustomerView,
  StaffMember,
  TransactionItem,
} from "../../shared/types";
import type { AccountRow, DashboardStatsRow, ProfileRow, SearchRow, TransactionRow } from "../data/repository";

const UNDOABLE = new Set(["ADD_CUPS", "REMOVE_CUPS", "REDEEM_REWARD", "ADMIN_ADJUSTMENT"]);

export function emailFor(role: AppRole, email: string): { email: string; emailMasked: boolean } {
  return role === "admin" ? { email, emailMasked: false } : { email: maskEmail(email), emailMasked: true };
}

export function findUndoCandidate(rows: TransactionRow[], viewerRole: AppRole): StaffCustomerView["undoCandidate"] {
  const tx = rows.find((r) => UNDOABLE.has(r.action) && r.reversedBy === null);
  if (!tx) return null;
  if (tx.action === "ADMIN_ADJUSTMENT" && viewerRole !== "admin") return null;
  return { action: tx.action, quantity: tx.quantity, createdAt: tx.createdAt };
}

export function toStaffCustomerView(
  account: AccountRow,
  viewerRole: AppRole,
  recent: TransactionRow[],
  walletDevices: number | null,
): StaffCustomerView {
  const undoCandidate =
    account.membershipStatus === "active" ? findUndoCandidate(recent, viewerRole) : null;
  return {
    accountId: account.id,
    memberId: account.memberId,
    displayName: account.displayName,
    ...emailFor(viewerRole, account.email),
    stampCount: account.stampCount,
    rewardAvailable: account.rewardAvailable,
    membershipStatus: account.membershipStatus,
    createdAt: account.createdAt,
    lastMutationAt: account.lastMutationAt,
    undoCandidate,
    walletDevices: viewerRole === "admin" ? walletDevices : null,
  };
}

export function toSearchItem(row: SearchRow, viewerRole: AppRole): CustomerSearchItem {
  return {
    accountId: row.accountId,
    memberId: row.memberId,
    displayName: row.displayName,
    email: emailFor(viewerRole, row.email).email,
    stampCount: row.stampCount,
    rewardAvailable: row.rewardAvailable,
    membershipStatus: row.membershipStatus,
    createdAt: row.createdAt,
  };
}

export function toTransactionItem(row: TransactionRow): TransactionItem {
  return {
    id: row.id,
    accountId: row.loyaltyAccountId,
    memberId: row.memberId,
    customerName: row.customerName,
    actorName: row.actorName,
    actorRole: row.actorRole,
    action: row.action,
    quantity: row.quantity,
    delta: row.delta,
    previousStampCount: row.previousStampCount,
    newStampCount: row.newStampCount,
    previousRewardAvailable: row.previousRewardAvailable,
    newRewardAvailable: row.newRewardAvailable,
    previousMembershipStatus: row.previousMembershipStatus,
    newMembershipStatus: row.newMembershipStatus,
    reversalOf: row.reversalOf,
    reversedBy: row.reversedBy,
    createdAt: row.createdAt,
  };
}

export function toDashboardStats(s: DashboardStatsRow): DashboardStats {
  return {
    totalCustomers: Number(s.total_customers),
    activeCustomers: Number(s.active_customers),
    cancelledCustomers: Number(s.cancelled_customers),
    newToday: Number(s.new_today),
    newThisWeek: Number(s.new_this_week),
    cupsAddedToday: Number(s.cups_added_today),
    rewardsAvailable: Number(s.rewards_available),
    rewardsRedeemedToday: Number(s.rewards_redeemed_today),
    rewardsRedeemedTotal: Number(s.rewards_redeemed_total),
    timeZone: String(s.time_zone),
  };
}

export function toStaffMember(p: ProfileRow): StaffMember {
  return { id: p.id, displayName: p.displayName, email: p.email, role: p.role, createdAt: p.createdAt };
}
