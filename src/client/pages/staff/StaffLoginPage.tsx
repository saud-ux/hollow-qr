import { Navigate, useNavigate } from "react-router";
import { Wordmark } from "../../components/Brand";
import { useAuth } from "../../lib/auth";
import { LoginForm } from "../customer/LoginPage";

export function StaffLoginPage() {
  const { session, me } = useAuth();
  const navigate = useNavigate();
  if (session && me && me.user.role !== "customer") return <Navigate to="/staff" replace />;
  return (
    <div className="staff-login">
      <Wordmark variant="cream" className="staff-login__logo" />
      <h1>دخول الموظفين</h1>
      <LoginForm submitLabel="دخول" onSuccess={() => void navigate("/staff", { replace: true })} />
      {session && me?.user.role === "customer" && <p className="staff-login__note">هذا الحساب ليس حساب موظف.</p>}
    </div>
  );
}
