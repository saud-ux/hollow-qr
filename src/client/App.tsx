import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router";
import { Spinner } from "./components/Field";
import { useAuth } from "./lib/auth";
import { roleHomePath } from "./lib/role-route";
import { NativeBridge } from "./components/NativeBridge";
import { WebBridge } from "./components/WebBridge";
import { RouteTransitions } from "./components/RouteTransitions";
import { StaffGuard } from "./components/StaffGuard";
import { NearbyIntro } from "./components/NearbyIntro";
import { Toaster } from "./components/Toast";
import { LangProvider } from "./lib/i18n";
import { isNative } from "./lib/native";
import { ForgotPasswordPage } from "./pages/customer/ForgotPasswordPage";
import { LoginPage } from "./pages/customer/LoginPage";
import { QrLandingPage } from "./pages/customer/QrLandingPage";
import { RegisterPage } from "./pages/customer/RegisterPage";
import { ResetPasswordPage } from "./pages/customer/ResetPasswordPage";
import { EmailCallbackPage } from "./pages/customer/EmailCallbackPage";
import { AccountPage } from "./pages/customer/AccountPage";
import { NotificationsPage } from "./pages/customer/NotificationsPage";
import { PlacePage } from "./pages/customer/PlacePage";
import { CarsPage } from "./pages/customer/CarsPage";
import { WalletPage } from "./pages/customer/WalletPage";
import { CartPage } from "./pages/order/CartPage";
import { MenuPage } from "./pages/order/MenuPage";
import { OrderPage } from "./pages/order/OrderPage";
import { OrdersPage } from "./pages/order/OrdersPage";
import { PrivacyPage, SupportPage } from "./pages/info/InfoPages";

// Staff screens (QR scanner etc.) are code-split so customers never download them.
const AdminMenuPage = lazy(() => import("./pages/staff/AdminMenuPage").then((m) => ({ default: m.AdminMenuPage })));
const StaffOrdersPage = lazy(() => import("./pages/staff/StaffOrdersPage").then((m) => ({ default: m.StaffOrdersPage })));
const AdminPage = lazy(() => import("./pages/staff/AdminPage").then((m) => ({ default: m.AdminPage })));
const AdminTeamPage = lazy(() => import("./pages/staff/AdminPage").then((m) => ({ default: m.AdminTeamPage })));
const AdminDiscountPage = lazy(() => import("./pages/staff/AdminDiscount").then((m) => ({ default: m.AdminDiscountPage })));
const AdminOrdersPage = lazy(() => import("./pages/staff/AdminOrders").then((m) => ({ default: m.AdminOrdersPage })));
const AdminEngagePage = lazy(() => import("./pages/staff/AdminPage").then((m) => ({ default: m.AdminEngagePage })));
const AdminSettingsPage = lazy(() => import("./pages/staff/AdminMenuPage").then((m) => ({ default: m.AdminSettingsPage })));
const StockPage = lazy(() => import("./pages/staff/StockPage").then((m) => ({ default: m.StockPage })));
const CustomerPage = lazy(() => import("./pages/staff/CustomerPage").then((m) => ({ default: m.CustomerPage })));
const StaffHomePage = lazy(() => import("./pages/staff/StaffHomePage").then((m) => ({ default: m.StaffHomePage })));
const StaffLoginPage = lazy(() => import("./pages/staff/StaffLoginPage").then((m) => ({ default: m.StaffLoginPage })));

export function App() {
  return (
    <BrowserRouter>
      <LangProvider>
        <NativeBridge />
        <WebBridge />
        <Toaster />
        <NearbyIntro />
        <Suspense fallback={<Spinner />}>
          <AppRoutes />
        </Suspense>
      </LangProvider>
    </BrowserRouter>
  );
}

/**
 * The customer screens, the same in the iOS app and on the website: both open
 * on the menu, and pages move with the app's transitions.
 */
function CustomerRoutes() {
  return (
    <RouteTransitions
      render={(location) => (
        <Routes location={location}>
          <Route path="/" element={<RoleHomeRedirect customerHome />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/auth/callback" element={<EmailCallbackPage />} />
          <Route path="/wallet" element={<WalletPage />} />
          <Route path="/account" element={<AccountPage />} />
          <Route path="/account/notifications" element={<NotificationsPage />} />
          <Route path="/account/places/:id" element={<PlacePage />} />
          <Route path="/account/cars" element={<CarsPage />} />
          <Route path="/menu" element={<MenuPage />} />
          <Route path="/cart" element={<CartPage />} />
          <Route path="/orders" element={<OrdersPage />} />
          <Route path="/orders/:id" element={<OrderPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/support" element={<SupportPage />} />
          {!isNative && <Route path="/c/:token" element={<QrLandingPage />} />}
          <Route path="*" element={<Navigate to="/menu" replace />} />
        </Routes>
      )}
    />
  );
}

/** Staff screens work inside the iOS app as well as on the website. */
function AppRoutes() {
  const { pathname } = useLocation();
  return pathname === "/staff" || pathname.startsWith("/staff/") ? <StaffRoutes /> : <CustomerRoutes />;
}

/**
 * Use the verified API role, never an email address, for landing destinations.
 *
 * `customerHome` marks the app's home ("/"): inside the iOS app every role —
 * staff and admin included — opens on the customer menu and reaches their board
 * from the account screen, so the app behaves like a normal customer app. On the
 * website, and when entering the staff area ("/staff"), landing stays role-based.
 */
function RoleHomeRedirect({ guestPath = "/menu", customerHome = false }: { guestPath?: string; customerHome?: boolean }) {
  const { session, loading, me, meError, refreshMe } = useAuth();
  if (loading || (session && !me && !meError)) return <Spinner />;
  if (session && !me) {
    return (
      <div className="boot-error" role="alert">
        <p>تعذّر التحقق من صلاحية الحساب. تأكد من اتصالك ثم حاول مرة ثانية.</p>
        <button type="button" className="btn btn--primary" onClick={() => void refreshMe()}>أعد المحاولة</button>
      </div>
    );
  }
  if (!(session && me)) return <Navigate to={guestPath} replace />;
  const dest = customerHome && isNative ? "/menu" : roleHomePath(me.user.role);
  return <Navigate to={dest} replace />;
}

function StaffRoutes() {
  return (
    <Routes>
      <Route path="/staff/login" element={<StaffLoginPage />} />
      <Route path="/staff" element={<RoleHomeRedirect guestPath="/staff/login" />} />
      <Route
        path="/staff/orders"
        element={
          <StaffGuard>
            <StaffOrdersPage />
          </StaffGuard>
        }
      />
      <Route
        path="/staff/customers"
        element={
          <StaffGuard>
            <StaffHomePage />
          </StaffGuard>
        }
      />
      <Route
        path="/staff/customers/:id"
        element={
          <StaffGuard>
            <CustomerPage />
          </StaffGuard>
        }
      />
      <Route
        path="/staff/stock"
        element={
          <StaffGuard>
            <StockPage />
          </StaffGuard>
        }
      />
      <Route
        path="/staff/admin"
        element={
          <StaffGuard adminOnly>
            <AdminPage />
          </StaffGuard>
        }
      />
      <Route
        path="/staff/admin/orders"
        element={
          <StaffGuard adminOnly>
            <AdminOrdersPage />
          </StaffGuard>
        }
      />
      <Route
        path="/staff/admin/discount"
        element={
          <StaffGuard adminOnly>
            <AdminDiscountPage />
          </StaffGuard>
        }
      />
      <Route
        path="/staff/admin/menu"
        element={
          <StaffGuard adminOnly>
            <AdminMenuPage />
          </StaffGuard>
        }
      />
      <Route
        path="/staff/admin/settings"
        element={
          <StaffGuard adminOnly>
            <AdminSettingsPage />
          </StaffGuard>
        }
      />
      <Route
        path="/staff/admin/engage"
        element={
          <StaffGuard adminOnly>
            <AdminEngagePage />
          </StaffGuard>
        }
      />
      <Route
        path="/staff/admin/team"
        element={
          <StaffGuard adminOnly>
            <AdminTeamPage />
          </StaffGuard>
        }
      />
      <Route path="*" element={<Navigate to="/staff/orders" replace />} />
    </Routes>
  );
}
