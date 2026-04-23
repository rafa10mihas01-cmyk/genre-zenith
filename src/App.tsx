import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import AdminRoute from "@/components/AdminRoute";
import AppLayout from "@/components/AppLayout";
import ScrollToTop from "@/components/ScrollToTop";
import Login from "./pages/Login";
import Home from "./pages/Home";
import Cerebro from "./pages/Cerebro";
import Criacao from "./pages/Criacao";
import Operacao from "./pages/Operacao";
import Performance from "./pages/Performance";
import Settings from "./pages/Settings";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const Protected = ({ children }: { children: React.ReactNode }) => (
  <ProtectedRoute>
    <AppLayout>{children}</AppLayout>
  </ProtectedRoute>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner theme="dark" position="top-right" />
      <BrowserRouter>
        <ScrollToTop />
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            {/* 5 módulos do sistema. Toda página dentro de <Protected> herda o layout global. */}
            <Route path="/" element={<Protected><Home /></Protected>} />
            <Route path="/cerebro" element={<Protected><Cerebro /></Protected>} />
            <Route path="/cerebro/:slug" element={<Protected><Cerebro /></Protected>} />
            <Route path="/criacao" element={<Protected><Criacao /></Protected>} />
            <Route path="/operacao" element={<Protected><Operacao /></Protected>} />
            <Route path="/performance" element={<Protected><Performance /></Protected>} />
            <Route path="/settings" element={<Protected><AdminRoute><Settings /></AdminRoute></Protected>} />
            <Route path="/configuracoes" element={<Protected><AdminRoute><Settings /></AdminRoute></Protected>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
