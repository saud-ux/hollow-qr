import { useEffect, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router";
import { AddToWalletButton } from "../../components/AddToWalletButton";
import { BackButton } from "../../components/BackButton";
import { CustomerLayout } from "../../components/CustomerLayout";
import { Alert } from "../../components/Field";
import { CardSkeleton } from "../../components/Skeletons";
import { PassPreview } from "../../components/PassPreview";
import { TabBar } from "../../components/Shop";
import { ApiClientError, apiPost, errorText } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { isAppleMobile } from "../../lib/hooks";
import { addPassNatively, isNative, successFeedback } from "../../lib/native";
import { tr } from "../../lib/i18n";

export function WalletPage() {
  const { session, loading, me, meError, refreshMe } = useAuth();
  const [params] = useSearchParams();
  const welcome = params.get("welcome") === "1";
  const [walletBusy, setWalletBusy] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [walletNote, setWalletNote] = useState<string | null>(null);

  // Keep the preview fresh after staff updates (on focus / every 30 s).
  useEffect(() => {
    const onVisible = () => document.visibilityState === "visible" && void refreshMe();
    document.addEventListener("visibilitychange", onVisible);
    const timer = setInterval(() => document.visibilityState === "visible" && void refreshMe(), 30_000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(timer);
    };
  }, [refreshMe]);

  if (loading) {
    return (
      <CustomerLayout dock={<TabBar />}>
        <CardSkeleton />
      </CustomerLayout>
    );
  }
  if (!session) return <Navigate to="/login" replace />;

  async function addToWallet() {
    setWalletBusy(true);
    setWalletError(null);
    setWalletNote(null);
    try {
      const { url } = await apiPost<{ url: string }>("/api/wallet/pass-link");
      if (isNative) {
        // The app shows Apple's "Add to Wallet" sheet itself.
        const result = await addPassNatively(url);
        if (result.alreadyInWallet) setWalletNote(tr("بطاقتك موجودة في Apple Wallet", "Your card is already in Apple Wallet"));
        else if (result.added) successFeedback();
        return;
      }
      // Navigating (not fetch) lets iOS Safari hand the .pkpass to Wallet.
      window.location.href = url;
    } catch (err) {
      setWalletError(errorText(err));
    } finally {
      setWalletBusy(false);
    }
  }

  const card = me?.card ?? null;
  const notConfirmed = me && !me.user.emailConfirmed && meError === null && !card;
  const emailError = meError instanceof ApiClientError && meError.code === "EMAIL_NOT_CONFIRMED";

  return (
    <CustomerLayout dock={<TabBar />} onRefresh={refreshMe}>
      {!welcome && <BackButton />}
      {!me && !meError && <CardSkeleton />}
      {meError !== null && !emailError && <Alert tone="error">{errorText(meError)}</Alert>}
      {(notConfirmed || emailError) && (
        <Alert tone="warning">{tr("يرجى تأكيد بريدك الإلكتروني من الرسالة المرسلة إليك، ثم حدّث الصفحة.", "Please confirm your email from the message we sent, then refresh.")}</Alert>
      )}
      {me && !card && me.user.role !== "customer" && (
        <section className="card center">
          <p>{me.user.role === "admin" ? tr("هذا حساب مدير.", "This is an admin account.") : tr("هذا حساب موظف.", "This is a staff account.")}</p>
          <Link to="/staff" className="btn btn--primary">
            {tr("الذهاب إلى لوحة الموظفين", "Go to the staff board")}
          </Link>
        </section>
      )}
      {card && (
        <>
          {welcome && (
            <section className="welcome" aria-live="polite">
              <h1>{tr("تم إنشاء بطاقتك بنجاح", "Your card is ready")}</h1>
              <p>
                {card.walletMode === "production" && card.walletReady
                  ? tr("أضفها الآن إلى Apple Wallet", "Add it to Apple Wallet now")
                  : tr("اعرض رمز QR للموظف عند الدفع", "Show the QR code to staff when you pay")}
              </p>
            </section>
          )}
          {!welcome && <h1 className="page-title">{tr("بطاقتي", "My card")}</h1>}

          {card.membershipStatus === "cancelled" && <Alert tone="error">{tr("عضويتك غير نشطة حاليًا. تواصل مع HOLLOW للمساعدة.", "Your membership is inactive. Contact HOLLOW for help.")}</Alert>}

          <PassPreview card={card} />

          {card.walletMode === "production" && card.walletReady && (
            <div className="wallet-actions">
              <AddToWalletButton onClick={() => void addToWallet()} busy={walletBusy} />
              {!isNative && !isAppleMobile() && <p className="muted small">{tr("لإضافة البطاقة افتح هذه الصفحة من Safari على iPhone.", "To add the card, open this page in Safari on an iPhone.")}</p>}
              {walletNote && <p className="muted small">{walletNote}</p>}
              {walletError && <Alert tone="error">{walletError}</Alert>}
            </div>
          )}
          <p className="muted small center">{tr("اعرض رمز QR للموظف عند الدفع.", "Show the QR code to staff when you pay.")}</p>
        </>
      )}
    </CustomerLayout>
  );
}
