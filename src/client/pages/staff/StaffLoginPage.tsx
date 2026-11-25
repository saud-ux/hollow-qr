import { useEffect } from "react";
import { Navigate, useNavigate } from "react-router";
import { keepAudioAlive } from "../../lib/feedback";
import { useStaffManifest } from "../../lib/staffApp";
import { Wordmark } from "../../components/Brand";
import { useAuth } from "../../lib/auth";
import { roleHomePath } from "../../lib/role-route";
import { LoginForm } from "../customer/LoginPage";

export function StaffLoginPage() {
  const { session, me } = useAuth();
  const navigate = useNavigate();
  // Tapping «دخول» also unlocks the new-order sound.
  useEffect(() => keepAudioAlive(), []);
  useStaffManifest();
  if (session && me && me.user.role !== "customer") return <Navigate to={roleHomePath(me.user.role)} replace />;
  return (
    <div className="staff-login">
      <Wordmark variant="cream" className="staff-login__logo" />
      <h1>دخول الموظفين</h1>
      <LoginForm submitLabel="دخول" onSuccess={() => void navigate("/staff", { replace: true })} />
      {session && me?.user.role === "customer" && <p className="staff-login__note">هذا الحساب ليس حساب موظف.</p>}
    </div>
  );
}
