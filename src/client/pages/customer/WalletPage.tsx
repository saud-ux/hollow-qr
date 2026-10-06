import { useEffect, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router";
import { AddToWalletButton } from "../../components/AddToWalletButton";
import { CustomerLayout } from "../../components/CustomerLayout";
import { Alert, Spinner } from "../../components/Field";
import { PassPreview } from "../../components/PassPreview";
import { TabBar } from "../../components/Shop";
import { ApiClientError, apiPost, errorText } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { isAppleMobile } from "../../lib/hooks";

export function WalletPage() {
  const { session, loading, me, meError, refreshMe, signOut } = useAuth();
  const [params] = useSearchParams();
  const welcome = params.get("welcome") === "1";
  const [walletBusy, setWalletBusy] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);

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
        <Spinner />
      </CustomerLayout>
    );
  }
  if (!session) return <Navigate to="/login" replace />;

  async function addToWallet() {
    setWalletBusy(true);
    setWalletError(null);
    try {
      const { url } = await apiPost<{ url: string }>("/api/wallet/pass-link");
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
    <CustomerLayout dock={<TabBar />}>
      {!me && !meError && <Spinner />}
      {meError !== null && !emailError && <Alert tone="error">{errorText(meError)}</Alert>}
      {(notConfirmed || emailError) && (
        <Alert tone="warning">يرجى تأكيد بريدك الإلكتروني من الرسالة المرسلة إليك، ثم حدّث الصفحة.</Alert>
      )}
      {me && !card && me.user.role !== "customer" && (
        <section className="card center">
          <p>هذا حساب {me.user.role === "admin" ? "مدير" : "موظف"}.</p>
          <Link to="/staff" className="btn btn--primary">
            الذهاب إلى لوحة الموظفين
          </Link>
        </section>
      )}
      {card && (
        <>
          {welcome && (
            <section className="welcome" aria-live="polite">
              <h1>تم إنشاء بطاقتك بنجاح</h1>
              <p>{card.walletMode === "production" && card.walletReady ? "أضفها الآن إلى Apple Wallet" : "اعرض رمز QR للموظف عند الدفع"}</p>
            </section>
          )}
          {!welcome && <h1 className="page-title">بطاقتي {card.displayName}</h1>}

          {card.membershipStatus === "cancelled" && <Alert tone="error">عضويتك غير نشطة حاليًا. تواصل مع HOLLOW للمساعدة.</Alert>}

          {card.walletMode === "production" && card.walletReady && (
            <div className="wallet-actions">
              <AddToWalletButton onClick={() => void addToWallet()} busy={walletBusy} />
              {!isAppleMobile() && <p className="muted small">لإضافة البطاقة افتح هذه الصفحة من Safari على iPhone.</p>}
              {walletError && <Alert tone="error">{walletError}</Alert>}
            </div>
          )}

          <PassPreview card={card} />
          <p className="muted small center">اعرض رمز QR للموظف عند الدفع.</p>
        </>
      )}
      <div className="center">
        <button type="button" className="btn btn--ghost" onClick={() => void signOut()}>
          تسجيل الخروج
        </button>
      </div>
    </CustomerLayout>
  );
}
