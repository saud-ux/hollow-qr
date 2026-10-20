import { useRef, useState } from "react";
import { errorText } from "../lib/api";
import { useAuth } from "../lib/auth";
import { tr } from "../lib/i18n";
import { Dialog } from "./Dialog";
import { Alert } from "./Field";

export function SignOutDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { signOut } = useAuth();
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    if (pending.current) return;
    setError(null);
    onClose();
  }

  async function confirm() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      await signOut();
      onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      title={tr("تسجيل الخروج؟", "Sign out?")}
      onClose={close}
      actions={<>
        <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void confirm()}>
          {busy ? tr("جارٍ تسجيل الخروج…", "Signing out…") : tr("نعم، تسجيل الخروج", "Yes, sign out")}
        </button>
        <button type="button" className="btn btn--ghost" disabled={busy} onClick={close} autoFocus>
          {tr("البقاء", "Stay signed in")}
        </button>
      </>}
    >
      <p>{tr("هل أنت متأكد أنك تريد تسجيل الخروج من حسابك؟", "Are you sure you want to sign out of your account?")}</p>
      {error && <Alert tone="error">{error}</Alert>}
    </Dialog>
  );
}
