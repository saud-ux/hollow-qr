import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { Spinner } from "./components/Field";
import { StaffGuard } from "./components/StaffGuard";
import { ForgotPasswordPage } from "./pages/customer/ForgotPasswordPage";
import { LoginPage } from "./pages/customer/LoginPage";
import { QrLandingPage } from "./pages/customer/QrLandingPage";
import { RegisterPage } from "./pages/customer/RegisterPage";
import { ResetPasswordPage } from "./pages/customer/ResetPasswordPage";
import { WalletPage } from "./pages/customer/WalletPage";
import { CartPage } from "./pages/order/CartPage";
import { MenuPage } from "./pages/order/MenuPage";
import { OrderPage } from "./pages/order/OrderPage";
import { OrdersPage } from "./pages/order/OrdersPage";

// Staff screens (QR scanner etc.) are code-split so customers never download them.
const AdminPage = lazy(() => import("./pages/staff/AdminPage").then((m) => ({ default: m.AdminPage })));
const CustomerPage = lazy(() => import("./pages/staff/CustomerPage").then((m) => ({ default: m.CustomerPage })));
const StaffHomePage = lazy(() => import("./pages/staff/StaffHomePage").then((m) => ({ default: m.StaffHomePage })));
const StaffLoginPage = lazy(() => import("./pages/staff/StaffLoginPage").then((m) => ({ default: m.StaffLoginPage })));

export function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<Spinner />}>
        <Routes>
        <Route path="/" element={<RegisterPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/wallet" element={<WalletPage />} />
        <Route path="/menu" element={<MenuPage />} />
        <Route path="/cart" element={<CartPage />} />
        <Route path="/orders" element={<OrdersPage />} />
        <Route path="/orders/:id" element={<OrderPage />} />
        <Route path="/c/:token" element={<QrLandingPage />} />
        <Route path="/staff/login" element={<StaffLoginPage />} />
        <Route
          path="/staff"
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
          path="/staff/admin"
          element={
            <StaffGuard adminOnly>
              <AdminPage />
            </StaffGuard>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
