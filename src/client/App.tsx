import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { Spinner } from "./components/Field";
import { NativeBridge } from "./components/NativeBridge";
import { RouteTransitions } from "./components/RouteTransitions";
import { StaffGuard } from "./components/StaffGuard";
import { Toaster } from "./components/Toast";
import { LangProvider } from "./lib/i18n";
import { isNative } from "./lib/native";
import { ForgotPasswordPage } from "./pages/customer/ForgotPasswordPage";
import { LoginPage } from "./pages/customer/LoginPage";
import { QrLandingPage } from "./pages/customer/QrLandingPage";
import { RegisterPage } from "./pages/customer/RegisterPage";
import { ResetPasswordPage } from "./pages/customer/ResetPasswordPage";
import { AccountPage } from "./pages/customer/AccountPage";
import { NotificationsPage } from "./pages/customer/NotificationsPage";
import { PlacePage } from "./pages/customer/PlacePage";
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
        <Toaster />
        <Suspense fallback={<Spinner />}>
          {isNative ? <NativeRoutes /> : <WebRoutes />}
        </Suspense>
      </LangProvider>
    </BrowserRouter>
  );
}

/** The iOS app is for customers: it opens on the menu and has no staff screens. */
function NativeRoutes() {
  return (
    <RouteTransitions
      render={(location) => (
        <Routes location={location}>
          <Route path="/" element={<Navigate to="/menu" replace />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/wallet" element={<WalletPage />} />
        <Route path="/account" element={<AccountPage />} />
        <Route path="/account/places/:id" element={<PlacePage />} />
          <Route path="/account" element={<AccountPage />} />
          <Route path="/account/notifications" element={<NotificationsPage />} />
          <Route path="/account/places/:id" element={<PlacePage />} />
          <Route path="/menu" element={<MenuPage />} />
          <Route path="/cart" element={<CartPage />} />
          <Route path="/orders" element={<OrdersPage />} />
          <Route path="/orders/:id" element={<OrderPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/support" element={<SupportPage />} />
          <Route path="*" element={<Navigate to="/menu" replace />} />
        </Routes>
      )}
    />
  );
}

function WebRoutes() {
  return (
        <Routes>
        <Route path="/" element={<RegisterPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/support" element={<SupportPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/wallet" element={<WalletPage />} />
        <Route path="/account" element={<AccountPage />} />
        <Route path="/account/places/:id" element={<PlacePage />} />
        <Route path="/menu" element={<MenuPage />} />
        <Route path="/cart" element={<CartPage />} />
        <Route path="/orders" element={<OrdersPage />} />
        <Route path="/orders/:id" element={<OrderPage />} />
        <Route path="/c/:token" element={<QrLandingPage />} />
        <Route path="/staff/login" element={<StaffLoginPage />} />
        <Route path="/staff" element={<Navigate to="/staff/orders" replace />} />
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
        <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
  );
}
