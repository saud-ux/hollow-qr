import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { DISPLAY_NAME_MAX_LENGTH, MAX_STAMPS } from "../../../shared/constants";
import { MAX_PLACES } from "../../../shared/types";
import { AccountIcon, type AccountIconName } from "../../components/AccountIcons";
import { CustomerLayout } from "../../components/CustomerLayout";
import { ConfirmDialog, Dialog } from "../../components/Dialog";
import { Alert } from "../../components/Field";
import { TabBar } from "../../components/Shop";
import { SocialLinks } from "../../components/SocialLinks";
import { apiPost, apiSend, errorText } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { tr, useLang, type LangChoice } from "../../lib/i18n";
import { isNative } from "../../lib/native";
import { placeIcon, placeName, usePlaces } from "../../lib/places";
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

function Chevron() {
  return (
    <span className="acct-row__chev" aria-hidden="true">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="m14.5 6-6 6 6 6" />
      </svg>
    </span>
  );
}

/** One row of a section: a gold icon, the text, then an optional value and an arrow. */
function Row({ icon, to, onClick, children, sub, value, tone }: { icon: AccountIconName; to?: string; onClick?: () => void; children: ReactNode; sub?: ReactNode; value?: ReactNode; tone?: "danger" }) {
  const body = (
    <>
      <AccountIcon name={icon} />
      <span className="acct-row__text">
        {children}
        {sub && <small>{sub}</small>}
      </span>
      {value && <span className="acct-row__value">{value}</span>}
      {(to || onClick) && tone !== "danger" && icon !== "signOut" && <Chevron />}
    </>
  );
  const className = `acct-row ${tone === "danger" ? "acct-row--danger" : ""}`;
  if (to) {
    return (
      <Link to={to} className={className}>
        {body}
      </Link>
    );
  }
  return (
    <button type="button" className={className} onClick={onClick}>
      {body}
    </button>
  );
}

function Section({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="acct-sec">
      {title && <h2 className="acct-sec__title">{title}</h2>}
      {children}
    </section>
  );
}

/** The "حسابي / Account" tab: who you are, your card, places, settings and help. */
export function AccountPage() {
  const { session, loading, me, refreshMe, signOut } = useAuth();
  const navigate = useNavigate();
  const signedIn = !!session;
  const places = usePlaces(signedIn);
  const [theme, setTheme] = useState<ThemeChoice>(getThemeChoice);
  const { choice: langChoice, setChoice: setLangChoice } = useLang();
  const [nameOpen, setNameOpen] = useState(false);
  const [name, setName] = useState("");
  const [nameBusy, setNameBusy] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const user = me?.user ?? null;
  const card = me?.card ?? null;
  const displayName = user?.displayName ?? "";

  async function saveName() {
    setNameBusy(true);
    setNameError(null);
    try {
      await apiSend("PUT", "/api/me/profile", { displayName: name });
      await refreshMe();
      setNameOpen(false);
    } catch (err) {
      setNameError(errorText(err));
    } finally {
      setNameBusy(false);
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

  const home = places?.find((p) => p.kind === "home");
  const work = places?.find((p) => p.kind === "work");
  const others = places?.filter((p) => p.kind === "other") ?? [];
  const canAdd = (places?.length ?? 0) < MAX_PLACES;

  return (
    <CustomerLayout dock={<TabBar />} onRefresh={signedIn ? refreshMe : undefined}>
      <h1 className="page-title">{tr("حسابي", "Account")}</h1>

      <section className="acct-hero">
        <div className="acct-hero__avatar" aria-hidden="true">
          {signedIn && displayName ? Array.from(displayName.trim())[0] : <AccountIcon name="staff" className="acct-hero__guest" />}
        </div>
        {signedIn ? (
          <>
            <div className="acct-hero__name">
              <span>{displayName || "…"}</span>
              {user && (
                <button
                  type="button"
                  className="acct-hero__edit"
                  aria-label={tr("تعديل الاسم", "Edit name")}
                  onClick={() => {
                    setName(displayName);
                    setNameError(null);
                    setNameOpen(true);
                  }}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M4 20h4L19 9l-4-4L4 16v4Zm9-13 4 4" />
                  </svg>
                </button>
              )}
            </div>
            {user && (
              <p className="acct-hero__meta" dir="ltr">
                {user.email}
              </p>
            )}
          </>
        ) : (
          !loading && (
            <>
              <p className="acct-hero__name">{tr("أهلًا بك في هولو", "Welcome to HOLLOW")}</p>
              <p className="acct-hero__meta">{tr("سجّل واجمع 5 أكواب، والسادس مجاني", "Sign up, collect 5 cups, the 6th is free")}</p>
              <div className="acct-hero__actions">
                <Link to="/register" className="btn btn--primary">
                  {tr("إنشاء حساب", "Sign up")}
                </Link>
                <Link to="/login" className="btn btn--ghost">
                  {tr("تسجيل الدخول", "Sign in")}
                </Link>
              </div>
            </>
          )
        )}
      </section>

      {signedIn && (
        <Section title={tr("عام", "General")}>
          {user && user.role !== "customer" && !isNative ? (
            <Row icon="staff" to="/staff">
              {tr("لوحة الموظفين", "Staff board")}
            </Row>
          ) : (
            <Row icon="card" to="/wallet" value={card ? <span dir="ltr">{`${Math.min(card.stampCount, MAX_STAMPS)} / ${MAX_STAMPS}`}</span> : undefined}>
              {tr("بطاقتي", "My card")}
            </Row>
          )}
          <Row icon="orders" to="/orders">
            {tr("طلباتي", "Orders")}
          </Row>
          {isNative && (
            <Row icon="bell" to="/account/notifications">
              {tr("الإشعارات", "Notifications")}
            </Row>
          )}
        </Section>
      )}

      {signedIn && (
        <Section title={tr("عناويني", "My places")}>
          {home ? (
            <Row icon="home" to={`/account/places/${home.id}`} sub={home.address}>
              {placeName(home)}
            </Row>
          ) : (
            canAdd && (
              <Row icon="home" to="/account/places/new?kind=home" sub={tr("اضغط لإضافته", "Tap to add")}>
                {tr("البيت", "Home")}
              </Row>
            )
          )}
          {work ? (
            <Row icon="work" to={`/account/places/${work.id}`} sub={work.address}>
              {placeName(work)}
            </Row>
          ) : (
            canAdd && (
              <Row icon="work" to="/account/places/new?kind=work" sub={tr("اضغط لإضافته", "Tap to add")}>
                {tr("الدوام", "Work")}
              </Row>
            )
          )}
          {others.map((p) => (
            <Row key={p.id} icon={placeIcon(p.kind)} to={`/account/places/${p.id}`} sub={p.address}>
              {placeName(p)}
            </Row>
          ))}
          {canAdd && (
            <Row icon="plus" to="/account/places/new?kind=other">
              {tr("إضافة عنوان", "Add a place")}
            </Row>
          )}
        </Section>
      )}

      <Section title={tr("الإعدادات", "Settings")}>
        {isNative && (
          <div className="acct-row acct-row--control">
            <AccountIcon name="moon" />
            <span className="acct-row__text">{tr("المظهر", "Appearance")}</span>
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
        <div className="acct-row acct-row--control">
          <AccountIcon name="globe" />
          <span className="acct-row__text">{tr("اللغة", "Language")}</span>
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
      </Section>

      <Section title={tr("المساعدة", "Help")}>
        <Row icon="help" to="/support">
          {tr("الدعم والمساعدة", "Help & support")}
        </Row>
        <Row icon="shield" to="/privacy">
          {tr("سياسة الخصوصية", "Privacy policy")}
        </Row>
      </Section>

      {signedIn && (
        <Section>
          <Row icon="signOut" onClick={() => void signOut()}>
            {tr("تسجيل الخروج", "Sign out")}
          </Row>
          {user?.role === "customer" && (
            <Row icon="trash" tone="danger" onClick={() => setDeleteOpen(true)}>
              {tr("حذف الحساب", "Delete account")}
            </Row>
          )}
        </Section>
      )}
      {deleteError && <Alert tone="error">{deleteError}</Alert>}
      <SocialLinks />

      <Dialog
        open={nameOpen}
        title={tr("تعديل الاسم", "Edit name")}
        onClose={() => setNameOpen(false)}
        actions={
          <>
            <button type="button" className="btn btn--primary" onClick={() => void saveName()} disabled={nameBusy || !name.trim()}>
              {nameBusy ? tr("جارٍ الحفظ…", "Saving…") : tr("حفظ", "Save")}
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => setNameOpen(false)} disabled={nameBusy}>
              {tr("إلغاء", "Cancel")}
            </button>
          </>
        }
      >
        <div className="field">
          <label htmlFor="display-name">{tr("الاسم", "Name")}</label>
          <input id="display-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={DISPLAY_NAME_MAX_LENGTH} autoComplete="name" />
        </div>
        <p className="muted small">{tr("يظهر على بطاقتك وفي طلباتك.", "Shown on your card and your orders.")}</p>
        {nameError && <Alert tone="error">{nameError}</Alert>}
      </Dialog>

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
