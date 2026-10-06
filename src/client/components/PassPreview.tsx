import { MAX_STAMPS, QR_CAPTION } from "../../shared/constants";
import { cupsLabel } from "../../shared/format";
import type { CustomerCard } from "../../shared/types";
import { CupStrip } from "./CupStrip";
import { QrCode } from "./QrCode";

/**
 * Web PREVIEW of the Apple Wallet store card. It mirrors the real pass fields
 * and uses the same strip images, but Apple Wallet controls the real layout.
 */
export function PassPreview({ card }: { card: CustomerCard }) {
  const cancelled = card.membershipStatus === "cancelled";
  const strip = cancelled ? "strip-cancelled" : `strip-${Math.min(card.stampCount, MAX_STAMPS)}`;
  const remaining = MAX_STAMPS - card.stampCount;
  return (
    <figure className={`pass ${cancelled ? "pass--void" : ""}`} aria-label="بطاقة HOLLOW Rewards">
      <div className="pass__header">
        <img src="/wallet-preview/logo.png" alt="HOLLOW" className="pass__logo" />
        <span className="pass__logo-text">Rewards</span>
        <div className="pass__header-field" dir="ltr">
          <span className="pass__label">CUPS</span>
          <span className="pass__value">
            {card.stampCount} / {MAX_STAMPS}
          </span>
        </div>
      </div>
      {cancelled ? (
        <img src={`/wallet-preview/${strip}.png`} alt="" className="pass__strip" />
      ) : (
        <CupStrip count={card.stampCount} memberId={card.memberId} stamp="all" className="pass__strip" />
      )}
      <div className="pass__fields">
        <div className="pass__field">
          <span className="pass__label" dir="ltr">HOLLOW REWARDS</span>
          <span className="pass__value pass__value--lg" dir="ltr">{cupsLabel(card.stampCount)}</span>
        </div>
        <div className="pass__field">
          <span className="pass__label">المكافأة</span>
          <span className={`pass__value ${card.rewardAvailable ? "pass__value--reward" : ""}`}>
            {cancelled
              ? "العضوية غير نشطة"
              : card.rewardAvailable
                ? "لك مشروب مجاني"
                : remaining === 1
                  ? "باقي كوب واحد للمشروب المجاني"
                  : `باقي ${remaining} أكواب للمشروب المجاني`}
          </span>
        </div>
      </div>
      <div className="pass__fields pass__fields--aux">
        <div className="pass__field">
          <span className="pass__label">الاسم</span>
          <span className="pass__value">{card.displayName}</span>
        </div>
        <div className="pass__field">
          <span className="pass__label">رقم العضوية</span>
          <span className="pass__value" dir="ltr">{card.memberId}</span>
        </div>
      </div>
      <div className="pass__barcode">
        <div className="pass__qr">
          <QrCode value={card.qrPayload} size={190} label="رمز QR لبطاقة HOLLOW" />
          <span className="pass__caption" dir="ltr">{QR_CAPTION}</span>
        </div>
      </div>
      {cancelled && <div className="pass__void-badge">VOID</div>}
    </figure>
  );
}
