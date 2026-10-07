import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import type { StaffCustomerView } from "../../../shared/types";
import { CustomerLayout } from "../../components/CustomerLayout";
import { Alert, Spinner } from "../../components/Field";
import { apiPost, errorText } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useConfig } from "../../lib/config";
import { tr } from "../../lib/i18n";

/**
 * /c/:token — what opens if someone scans the pass QR with a phone camera.
 * The QR never grants any privileges: staff are forwarded to the customer
 * screen only after their own authenticated session resolves the token;
 * everyone else sees a neutral page with no customer data.
 */
export function QrLandingPage() {
  const { token = "" } = useParams();
  const { me, loading } = useAuth();
  const config = useConfig();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const isStaff = me?.user.role === "staff" || me?.user.role === "admin";

  useEffect(() => {
    if (!isStaff) return;
    apiPost<{ customer: StaffCustomerView }>("/api/staff/resolve", { code: `${config.appUrl}/c/${token}` })
      .then(({ customer }) => void navigate(`/staff/customers/${customer.accountId}`, { replace: true }))
      .catch((err: unknown) => setError(errorText(err)));
  }, [isStaff, token, config.appUrl, navigate]);

  if (loading || (isStaff && !error)) {
    return (
      <CustomerLayout>
        <Spinner />
      </CustomerLayout>
    );
  }
  return (
    <CustomerLayout>
      <section className="card center">
        <h1>{tr("بطاقة HOLLOW Rewards", "HOLLOW Rewards card")}</h1>
        {error ? <Alert tone="error">{error}</Alert> : <p>{tr("اعرض هذا الرمز للموظف عند الدفع لإضافة أكوابك.", "Show this code to staff when you pay to collect your cups.")}</p>}
        <Link to="/wallet" className="btn btn--secondary">
          {tr("بطاقتي", "My card")}
        </Link>
      </section>
    </CustomerLayout>
  );
}
