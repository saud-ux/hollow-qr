import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import { AddToWalletButton } from "../../components/AddToWalletButton";
import { CustomerLayout } from "../../components/CustomerLayout";
import { NotificationSettings } from "../../components/NotificationSettings";
import { ConfirmDialog } from "../../components/Dialog";
import { Alert } from "../../components/Field";
import { CardSkeleton } from "../../components/Skeletons";
import { PassPreview } from "../../components/PassPreview";
import { TabBar } from "../../components/Shop";
import { ApiClientError, apiPost, errorText } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { isAppleMobile } from "../../lib/hooks";
import { addPassNatively, isNative, successFeedback } from "../../lib/native";
import { tr, useLang, type LangChoice } from "../../lib/i18n";
import { getThemeChoice, setThemeChoice, type ThemeChoice } from "../../lib/theme";

// Each language is written in itself so it can be found from either one.
const langs = (): { value: LangChoice; label: string }[] => [
  { value: "system", label: tr("تلقائي", "Auto") },
  { value: "ar", label: "العربية" },
  { value: "en", label: "English" },
];

const themes = (): { value: ThemeChoice; label: string }[] => [
  { value: "system", label: tr("تلقائي", "Auto") },
  { value: "light", label: tr("فاتح", "Light") },
  { value: "dark", label: tr("داكن", "Dark") },
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
  const { choice: langChoice, setChoice: setLangChoice } = useLang();

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
    <CustomerLayout dock={<TabBar />} onRefresh={refreshMe}>
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
      {isNative && me && (
        <>
          <h2 className="settings__title">{tr("الإشعارات", "Notifications")}</h2>
          <NotificationSettings role={me.user.role} />
          <h2 className="settings__title">{tr("الحساب", "Account")}</h2>
        </>
      )}
      <nav className="settings" aria-label={tr("الحساب", "Account")}>
        {isNative && (
          <div className="settings__row settings__row--theme">
            {tr("المظهر", "Appearance")}
            <div className="theme-switch" role="radiogroup" aria-label={tr("المظهر", "Appearance")}>
              {themes().map((t) => (
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
        <div className="settings__row settings__row--theme">
          {tr("اللغة", "Language")}
          <div className="theme-switch" role="radiogroup" aria-label={tr("اللغة", "Language")}>
            {langs().map((l) => (
              <button
                key={l.value}
                type="button"
                role="radio"
                aria-checked={langChoice === l.value}
                className={`theme-switch__opt ${langChoice === l.value ? "is-on" : ""}`}
                lang={l.value === "en" ? "en" : l.value === "ar" ? "ar" : undefined}
                onClick={() => setLangChoice(l.value)}
              >
                {l.label}
              </button>
            ))}
          </div>
        </div>
        <Link to="/support" className="settings__row">
          {tr("الدعم والمساعدة", "Help & support")}
          <ChevronIcon />
        </Link>
        <Link to="/privacy" className="settings__row">
          {tr("سياسة الخصوصية", "Privacy policy")}
          <ChevronIcon />
        </Link>
        <button type="button" className="settings__row" onClick={() => void signOut()}>
          {tr("تسجيل الخروج", "Sign out")}
        </button>
        {me?.user.role === "customer" && (
          <button type="button" className="settings__row settings__row--danger" onClick={() => setDeleteOpen(true)}>
            {tr("حذف الحساب", "Delete account")}
          </button>
        )}
      </nav>
      {deleteError && <Alert tone="error">{deleteError}</Alert>}
      <ConfirmDialog
        open={deleteOpen}
        title={tr("حذف حسابك نهائيًا؟", "Delete your account for good?")}
        message={
          <p>
            {tr(
              "نحذف اسمك وبريدك وأرقامك وعناوينك، وتُلغى بطاقة الولاء وما فيها من أكواب ومكافآت. لا يمكن التراجع عن هذا.",
              "We delete your name, email, numbers and addresses, and cancel your loyalty card with its cups and rewards. This can't be undone.",
            )}
          </p>
        }
        confirmLabel={tr("احذف حسابي", "Delete my account")}
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
