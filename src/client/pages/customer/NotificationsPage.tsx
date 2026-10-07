import { Navigate } from "react-router";
import { BackButton } from "../../components/BackButton";
import { CustomerLayout } from "../../components/CustomerLayout";
import { NotificationSettings } from "../../components/NotificationSettings";
import { TabBar } from "../../components/Shop";
import { useAuth } from "../../lib/auth";
import { tr } from "../../lib/i18n";

/** Account → Notifications (iOS app): the push switches. */
export function NotificationsPage() {
  const { session, loading, me } = useAuth();
  if (!loading && !session) return <Navigate to="/login" replace />;
  return (
    <CustomerLayout dock={<TabBar />}>
      <BackButton />
      <h1 className="page-title">{tr("الإشعارات", "Notifications")}</h1>
      {me && <NotificationSettings role={me.user.role} />}
    </CustomerLayout>
  );
}
