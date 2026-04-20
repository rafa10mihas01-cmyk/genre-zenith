import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppLayout from "@/components/AppLayout";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Genres from "./pages/Genres";
import Collect from "./pages/Collect";
import Models from "./pages/Models";
import ModelDetail from "./pages/ModelDetail";
import Placeholder from "./pages/Placeholder";
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
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<Protected><Dashboard /></Protected>} />
            <Route path="/genres" element={<Protected><Genres /></Protected>} />
            <Route path="/collect" element={<Protected><Collect /></Protected>} />
            <Route path="/models" element={<Protected><Models /></Protected>} />
            <Route path="/models/:genreId" element={<Protected><ModelDetail /></Protected>} />
            <Route path="/logs" element={<Protected><Placeholder title="Logs de Coleta" subtitle="Histórico completo com filtros" phase="Fase 4" /></Protected>} />
            <Route path="/settings" element={<Protected><Placeholder title="Configurações" subtitle="API key, delays, teste de conexão" phase="Fase 4" /></Protected>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
