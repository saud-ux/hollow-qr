/**
 * Builds pass.json for a HOLLOW Rewards store card.
 *
 * Layout (Apple Wallet store card):
 *   header      CUPS            "3 / 5"            (visible when cards are stacked)
 *   strip       five HOLLOW cups (pre-rendered per state, see assets.ts)
 *   secondary   HOLLOW REWARDS  "3 / 5 Cups"   |   المكافأة "لك مشروب مجاني" / remaining
 *   auxiliary   الاسم  <customer name>         |   رقم العضوية  HLW-XXXXXX
 *   barcode     QR (opaque signed URL) with altText "SCAN AT CHECKOUT"
 *   back        program terms, shop, links
 *
 * Wallet decides fonts and exact placement; Arabic values render RTL with
 * PKTextAlignmentNatural. We deliberately do not use primaryFields because on
 * store cards they are drawn on top of the strip and would cover the cups.
 */
import { MAX_STAMPS, PROGRAM_NAME, QR_CAPTION, SHOP_LABEL } from "../../shared/constants";
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
        altText: QR_CAPTION,
      },
    ],
    storeCard: {
      headerFields: [
        {
          key: "cups",
          label: "CUPS",
          value: `${account.stampCount} / ${MAX_STAMPS}`,
          textAlignment: "PKTextAlignmentRight",
        },
      ],
      secondaryFields: [
        {
          key: "progress",
          label: PROGRAM_NAME.toUpperCase(),
          value: cupsLabel(account.stampCount),
        },
        {
          key: "reward",
          label: "المكافأة",
          value: rewardText(account),
          textAlignment: "PKTextAlignmentNatural",
          // Lock-screen notice when the value changes (e.g. reward unlocked).
          // This is the standard pass-update message, not a marketing push.
          changeMessage: "%@",
        },
      ],
      auxiliaryFields: [
        {
          key: "name",
          label: "الاسم",
          value: account.displayName,
          textAlignment: "PKTextAlignmentNatural",
        },
        {
          key: "member",
          label: "رقم العضوية",
          value: account.memberId,
          textAlignment: "PKTextAlignmentRight",
        },
      ],
      backFields: [
        {
          key: "program",
          label: "برنامج الولاء",
          value: "اشترِ 5 أكواب واحصل على السادس مجانًا. المكافأة تشمل أي مشروب ولا تنتهي صلاحيتها. تبدأ دورة جديدة بعد استخدام المشروب المجاني.",
        },
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
