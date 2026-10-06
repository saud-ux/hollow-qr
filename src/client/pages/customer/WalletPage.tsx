import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import { AddToWalletButton } from "../../components/AddToWalletButton";
import { CustomerLayout } from "../../components/CustomerLayout";
import { ConfirmDialog } from "../../components/Dialog";
import { Alert, Spinner } from "../../components/Field";
import { PassPreview } from "../../components/PassPreview";
import { TabBar } from "../../components/Shop";
import { ApiClientError, apiPost, errorText } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { isAppleMobile } from "../../lib/hooks";
import { addPassNatively, isNative, successFeedback } from "../../lib/native";
import { getThemeChoice, setThemeChoice, type ThemeChoice } from "../../lib/theme";

const THEMES: { value: ThemeChoice; label: string }[] = [
  { value: "system", label: "تلقائي" },
  { value: "light", label: "فاتح" },
  { value: "dark", label: "داكن" },
];

export function WalletPage() {
  const { session, loading, me, meError, refreshMe, signOut } = useAuth();
  const [params] = useSearchParams();
  const welcome = params.get("welcome") === "1";
  const [walletBusy, setWalletBusy] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [walletNote, setWalletNote] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const navigate = useNavigate();
  const [theme, setTheme] = useState<ThemeChoice>(getThemeChoice);

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
    setWalletNote(null);
    try {
      const { url } = await apiPost<{ url: string }>("/api/wallet/pass-link");
      if (isNative) {
        // The app shows Apple's "Add to Wallet" sheet itself.
        const result = await addPassNatively(url);
        if (result.alreadyInWallet) setWalletNote("بطاقتك موجودة في Apple Wallet");
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

  async function deleteAccount() {
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await apiPost("/api/me/delete", { confirm: "DELETE" });
      setDeleteOpen(false);
      await signOut().catch(() => undefined);
      void navigate(isNative ? "/menu" : "/", { replace: true });
    } catch (err) {
      setDeleteError(errorText(err));
    } finally {
      setDeleteBusy(false);
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
          {!welcome && <h1 className="page-title">بطاقتي</h1>}

          {card.membershipStatus === "cancelled" && <Alert tone="error">عضويتك غير نشطة حاليًا. تواصل مع HOLLOW للمساعدة.</Alert>}

          <PassPreview card={card} />

          {card.walletMode === "production" && card.walletReady && (
            <div className="wallet-actions">
              <AddToWalletButton onClick={() => void addToWallet()} busy={walletBusy} />
              {!isNative && !isAppleMobile() && <p className="muted small">لإضافة البطاقة افتح هذه الصفحة من Safari على iPhone.</p>}
              {walletNote && <p className="muted small">{walletNote}</p>}
              {walletError && <Alert tone="error">{walletError}</Alert>}
            </div>
          )}
          <p className="muted small center">اعرض رمز QR للموظف عند الدفع.</p>
        </>
      )}
      <nav className="settings" aria-label="الحساب">
        {isNative && (
          <div className="settings__row settings__row--theme">
            المظهر
            <div className="theme-switch" role="radiogroup" aria-label="المظهر">
              {THEMES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  role="radio"
                  aria-checked={theme === t.value}
                  className={`theme-switch__opt ${theme === t.value ? "is-on" : ""}`}
                  onClick={() => {
                    setThemeChoice(t.value);
                    setTheme(t.value);
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        )}
        <Link to="/support" className="settings__row">
          الدعم والمساعدة
          <ChevronIcon />
        </Link>
        <Link to="/privacy" className="settings__row">
          سياسة الخصوصية
          <ChevronIcon />
        </Link>
        <button type="button" className="settings__row" onClick={() => void signOut()}>
          تسجيل الخروج
        </button>
        {me?.user.role === "customer" && (
          <button type="button" className="settings__row settings__row--danger" onClick={() => setDeleteOpen(true)}>
            حذف الحساب
          </button>
        )}
      </nav>
      {deleteError && <Alert tone="error">{deleteError}</Alert>}
      <ConfirmDialog
        open={deleteOpen}
        title="حذف حسابك نهائيًا؟"
        message={
          <p>
            نحذف اسمك وبريدك وأرقامك وعناوينك، وتُلغى بطاقة الولاء وما فيها من أكواب ومكافآت. لا يمكن التراجع عن هذا.
          </p>
        }
        confirmLabel="احذف حسابي"
        tone="danger"
        busy={deleteBusy}
        onConfirm={() => void deleteAccount()}
        onCancel={() => setDeleteOpen(false)}
      />
    </CustomerLayout>
  );
}

function ChevronIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m15 6-6 6 6 6" />
    </svg>
  );
}
