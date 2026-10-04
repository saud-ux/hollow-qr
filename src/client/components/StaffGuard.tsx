import type { ReactNode } from "react";
import { Navigate } from "react-router";
import { useAuth } from "../lib/auth";
import { Alert, Spinner } from "./Field";

/** Client-side gate for UX only — every API call is authorized server-side. */
export function StaffGuard({ children, adminOnly = false }: { children: ReactNode; adminOnly?: boolean }) {
  const { session, loading, me, meError, signOut } = useAuth();
  if (loading) return <Spinner />;
  if (!session) return <Navigate to="/staff/login" replace />;
  if (!me && !meError) return <Spinner />;
  if (!me) return <Alert tone="error">تعذّر تحميل الحساب</Alert>;
  const role = me.user.role;
  if (role === "customer" || (adminOnly && role !== "admin")) {
    return (
      <div className="staff-denied">
        <Alert tone="error">ليس لديك صلاحية للوصول إلى هذه الصفحة.</Alert>
        <button type="button" className="btn btn--secondary" onClick={() => void signOut()}>
          تسجيل الخروج
        </button>
      </div>
    );
  }
  return <>{children}</>;
}
