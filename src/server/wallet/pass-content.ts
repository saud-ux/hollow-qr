/**
 * Builds pass.json for a HOLLOW Rewards store card.
 *
 * Layout (Apple Wallet store card):
 *   header      (none, so the whole "HOLLOW Rewards" logo text fits)
 *   strip       five HOLLOW cups, and under them "3 / 5 Cups" and the reward
 *               line, drawn into the image (pre-rendered per state, see assets.ts)
 *   barcode     QR (opaque signed URL); under it, in Wallet's small caption
 *               type, the customer's name and member number
 *   back        reward, progress, name, member number, terms, shop, links
 *
 * Wallet puts every front field in one row under the strip and picks their
 * fonts, so the progress line lives in the strip image, where we control its
 * layout (like the in-app card), and the name and member number ride in the
 * barcode caption, which is smaller and sits lower than a field. The reward
 * also stays a (back) field: its changeMessage is what shows on the lock
 * screen when it changes, and the image cannot do that. We deliberately do
 * not use primaryFields because on store cards they are drawn on top of the
 * strip and would cover the cups.
 */
import { PROGRAM_NAME, SHOP_LABEL } from "../../shared/constants";
import { cupsLabel, remainingCups } from "../../shared/format";
import type { AccountRow } from "../data/repository";

export interface PassIdentity {
  passTypeIdentifier: string;
  teamIdentifier: string;
  /** Base URL Wallet appends "/v1/..." to. */
  webServiceURL: string;
  authenticationToken: string;
  qrPayload: string;
}

export const PASS_COLORS = {
  background: "rgb(244, 237, 224)",
  foreground: "rgb(43, 30, 22)",
  label: "rgb(140, 98, 57)",
} as const;

export function rewardText(account: Pick<AccountRow, "stampCount" | "rewardAvailable" | "membershipStatus">): string {
  if (account.membershipStatus === "cancelled") return "العضوية غير نشطة";
  if (account.rewardAvailable) return "لك مشروب مجاني";
  const left = remainingCups(account.stampCount);
  return left === 1 ? "باقي كوب واحد للمشروب المجاني" : `باقي ${left} أكواب للمشروب المجاني`;
}

export function buildPassJson(account: AccountRow, identity: PassIdentity): Record<string, unknown> {
  const cancelled = account.membershipStatus === "cancelled";
  return {
    formatVersion: 1,
    passTypeIdentifier: identity.passTypeIdentifier,
    teamIdentifier: identity.teamIdentifier,
    serialNumber: account.passSerial,
    organizationName: "HOLLOW",
    description: `${PROGRAM_NAME}، بطاقة ولاء HOLLOW`,
    logoText: "Rewards",
    backgroundColor: PASS_COLORS.background,
    foregroundColor: PASS_COLORS.foreground,
    labelColor: PASS_COLORS.label,
    webServiceURL: identity.webServiceURL,
    authenticationToken: identity.authenticationToken,
    // Personal membership card: hide the share button (does not prevent
    // forwarding the file, which is why the QR alone grants no privileges).
    sharingProhibited: true,
    // Legitimate Wallet behavior for an inactive card: Wallet shows it as void.
    voided: cancelled,
    barcodes: [
      {
        format: "PKBarcodeFormatQR",
        message: identity.qrPayload,
        messageEncoding: "iso-8859-1",
        altText: `${account.displayName} · ${account.memberId}`,
      },
    ],
    storeCard: {
      backFields: [
        {
          key: "reward",
          label: "المكافأة",
          value: rewardText(account),
          // Lock-screen notice when the value changes (e.g. reward unlocked).
          // This is the standard pass-update message, not a marketing push.
          changeMessage: "%@",
        },
        { key: "progress", label: PROGRAM_NAME, value: cupsLabel(account.stampCount) },
        {
          key: "program",
          label: "برنامج الولاء",
          value: "اشترِ 5 أكواب واحصل على السادس مجانًا. المكافأة تشمل أي مشروب ولا تنتهي صلاحيتها. تبدأ دورة جديدة بعد استخدام المشروب المجاني.",
        },
        { key: "name", label: "الاسم", value: account.displayName },
        { key: "status", label: "حالة العضوية", value: cancelled ? "ملغاة" : "نشطة" },
        { key: "memberBack", label: "رقم العضوية", value: account.memberId },
        { key: "shop", label: "الفرع", value: SHOP_LABEL },
        {
          key: "howto",
          label: "طريقة الاستخدام",
          value: "اعرض رمز QR للموظف عند الدفع. يتم تحديث البطاقة تلقائيًا بعد كل عملية.",
        },
      ],
    },
  };
}
