import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { CustomerLayout } from "../../components/CustomerLayout";
import { Alert } from "../../components/Field";
import { useAuth } from "../../lib/auth";
import { capturedEmailCallback, forgetEmailCallback } from "../../lib/email-callback";
import { emailAppUrl } from "../../../shared/email-links";
import { tr } from "../../lib/i18n";

export function EmailCallbackPage() {
  const [link] = useState(capturedEmailCallback);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const { completeEmailLink, loading } = useAuth();
  const navigate = useNavigate();
  useEffect(() => () => forgetEmailCallback(), []);

  async function continueOnWeb() {
    if (!link || link.kind !== "session") return;
    setBusy(true);
    setFailed(false);
    try {
      await completeEmailLink(link);
      forgetEmailCallback();
      void navigate(link.path, { replace: true });
    } catch {
      setFailed(true);
    } finally { setBusy(false); }
  }

  const valid = link?.kind === "session";
  return (
    <CustomerLayout>
      <section className="card form center">
        <h1>{tr("كمّل مع هولو", "Continue with HOLLOW")}</h1>
        {valid && !failed ? (
          <>
            <p>{link.type === "recovery" ? tr("افتح التطبيق لتعيين كلمة مرور جديدة، أو كمّل من الموقع.", "Open the app to set a new password, or continue on the website.") : tr("افتح التطبيق لتأكيد حسابك، أو كمّل من الموقع.", "Open the app to confirm your account, or continue on the website.")}</p>
            <a className="btn btn--primary btn--block" href={emailAppUrl(link)} referrerPolicy="no-referrer">{tr("فتح في التطبيق", "Open in the app")}</a>
            <button type="button" className="btn btn--secondary btn--block" onClick={() => void continueOnWeb()} disabled={busy || loading}>
              {busy ? tr("لحظة…", "One moment…") : tr("المتابعة بالموقع", "Continue on the website")}
            </button>
          </>
        ) : (
          <>
            <Alert tone="error">{tr("الرابط غير صالح أو منتهي الصلاحية. اطلب رابطًا جديدًا.", "This link is invalid or expired. Request a new link.")}</Alert>
            <Link className="btn btn--primary btn--block" to={link?.path === "/reset-password" ? "/forgot-password" : "/login"}>{tr("متابعة", "Continue")}</Link>
          </>
        )}
      </section>
    </CustomerLayout>
  );
}
