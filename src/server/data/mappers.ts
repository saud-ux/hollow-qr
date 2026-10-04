/** Row mappers shared by every Repository implementation (snake_case -> camelCase). */
import type { AccountRow, ProfileRow, SearchRow, TransactionRow } from "./repository";

type Raw = Record<string, unknown>;

function asText(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "bigint" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toISOString();
  return v === null || v === undefined ? "" : JSON.stringify(v);
}
const str = (v: unknown): string => asText(v);
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : asText(v));
const num = (v: unknown): number => Number(v ?? 0);
const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : str(v));
const isoOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : iso(v));

export function mapProfile(r: Raw): ProfileRow {
  return {
    id: str(r.id),
    displayName: str(r.display_name),
    email: str(r.email),
    role: str(r.role) as ProfileRow["role"],
    emailConfirmedAt: isoOrNull(r.email_confirmed_at),
    createdAt: iso(r.created_at),
  };
}

/** Accepts a loyalty_accounts row with either flattened or embedded profile columns. */
export function mapAccount(r: Raw): AccountRow {
  const profile = (r.profiles ?? {}) as Raw;
  return {
    id: str(r.id),
    userId: str(r.user_id),
    memberId: str(r.member_id),
    stampCount: num(r.stamp_count),
    rewardAvailable: Boolean(r.reward_available),
    membershipStatus: str(r.membership_status) as AccountRow["membershipStatus"],
    passSerial: str(r.pass_serial),
    qrTokenId: str(r.qr_token_id),
    walletUpdatedAt: iso(r.wallet_updated_at),
    lastMutationAt: isoOrNull(r.last_mutation_at),
    cancelledAt: isoOrNull(r.cancelled_at),
    createdAt: iso(r.created_at),
    displayName: str(r.display_name ?? profile.display_name),
    email: str(r.email ?? profile.email),
  };
}

export function mapSearchRow(r: Raw): SearchRow {
  return {
    accountId: str(r.account_id),
    memberId: str(r.member_id),
    displayName: str(r.display_name),
    email: str(r.email),
    stampCount: num(r.stamp_count),
    rewardAvailable: Boolean(r.reward_available),
    membershipStatus: str(r.membership_status) as SearchRow["membershipStatus"],
    lastMutationAt: isoOrNull(r.last_mutation_at),
    createdAt: iso(r.created_at),
  };
}

export function mapTransaction(r: Raw): TransactionRow {
  return {
    id: str(r.id),
    seq: num(r.seq),
    loyaltyAccountId: str(r.loyalty_account_id),
    memberId: str(r.member_id),
    customerName: str(r.customer_name),
    customerEmail: str(r.customer_email),
    actorUserId: str(r.actor_user_id),
    actorName: str(r.actor_name),
    actorRole: str(r.actor_role) as TransactionRow["actorRole"],
    action: str(r.action) as TransactionRow["action"],
    quantity: num(r.quantity),
    delta: num(r.delta),
    previousStampCount: num(r.previous_stamp_count),
    newStampCount: num(r.new_stamp_count),
    previousRewardAvailable: Boolean(r.previous_reward_available),
    newRewardAvailable: Boolean(r.new_reward_available),
    previousMembershipStatus: str(r.previous_membership_status) as TransactionRow["previousMembershipStatus"],
    newMembershipStatus: str(r.new_membership_status) as TransactionRow["newMembershipStatus"],
    reversalOf: strOrNull(r.reversal_of),
    reversedBy: strOrNull(r.reversed_by),
    reversedAt: isoOrNull(r.reversed_at),
    createdAt: iso(r.created_at),
  };
}

export function totalFrom(rows: Raw[]): number {
  return rows.length > 0 ? num(rows[0]!.total_count) : 0;
}
