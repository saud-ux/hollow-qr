import { BackButton } from "../../components/BackButton";
import { CustomerLayout } from "../../components/CustomerLayout";
import { NotificationSettings } from "../../components/NotificationSettings";
import { NearbyAlerts } from "../../components/NearbyAlerts";
import { TabBar } from "../../components/Shop";
import { useAuth } from "../../lib/auth";
import { tr } from "../../lib/i18n";

/** Account → Notifications: the push switches (this device, offers, staff alerts). */
export function NotificationsPage() {
  const { me } = useAuth();
  return (
    <CustomerLayout dock={<TabBar />}>
      <BackButton />
      <h1 className="page-title">{tr("الإشعارات", "Notifications")}</h1>
      {me && <NotificationSettings role={me.user.role} />}
      <NearbyAlerts />
    </CustomerLayout>
  );
}
