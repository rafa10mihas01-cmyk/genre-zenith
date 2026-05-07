import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import AdminRoute from "@/components/AdminRoute";
import AppLayout from "@/components/AppLayout";
import ScrollManager from "@/components/ScrollManager";
import { LoadingProvider } from "@/contexts/LoadingContext";
import Login from "./pages/Login";
import ResetPassword from "./pages/ResetPassword";
import Privacy from "./pages/Privacy";
import Landing from "./pages/Landing";
import SpotifyCallback from "./pages/SpotifyCallback";
import RootRoute from "./components/RootRoute";
import Cerebro from "./pages/Cerebro";
import Criacao from "./pages/Criacao";
import Operacao from "./pages/Operacao";
import Performance from "./pages/Performance";
import PlaylistDeals from "./pages/PlaylistDeals";
import Curadores from "./pages/Curadores";
import CuratorPage from "./pages/CuratorPage";
import ClientCampaignPage from "./pages/ClientCampaignPage";
import CuradoriaPreview from "./pages/CuradoriaPreview";
import Sistema from "./pages/Sistema";
import Settings from "./pages/Settings";
import JoinInvite from "./pages/comunidade/JoinInvite";
import Onboarding from "./pages/comunidade/Onboarding";
import ComunidadeDashboard from "./pages/comunidade/Dashboard";
import ComunidadeCampanhas from "./pages/comunidade/Campanhas";
import ComunidadePontos from "./pages/comunidade/Pontos";
import ComunidadeConta from "./pages/comunidade/Conta";
import ComunidadeAdmin from "./pages/ComunidadeAdmin";
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
        <ScrollManager />
        <LoadingProvider>
          <AuthProvider>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/privacy" element={<Privacy />} />
              <Route path="/landing" element={<Landing />} />
              <Route path="/spotify/callback" element={<SpotifyCallback />} />
              <Route path="/curador/:token" element={<CuratorPage />} />
              <Route path="/campanha/:token" element={<ClientCampaignPage />} />
              {/* Comunidade — beta fechado por convite. Membro não usa AppLayout. */}
              <Route path="/comunidade/join/:code" element={<JoinInvite />} />
              <Route path="/comunidade/onboarding" element={<ProtectedRoute><Onboarding /></ProtectedRoute>} />
              <Route path="/comunidade" element={<ProtectedRoute><ComunidadeDashboard /></ProtectedRoute>} />
              <Route path="/comunidade/campanhas" element={<ProtectedRoute><ComunidadeCampanhas /></ProtectedRoute>} />
              <Route path="/comunidade/pontos" element={<ProtectedRoute><ComunidadePontos /></ProtectedRoute>} />
              <Route path="/comunidade/conta" element={<ProtectedRoute><ComunidadeConta /></ProtectedRoute>} />
              {/* "/" decide entre landing pública (visitantes) e Cockpit/Home (logados). */}
              <Route path="/" element={<RootRoute />} />
              <Route path="/cerebro" element={<Protected><Cerebro /></Protected>} />
              <Route path="/cerebro/:slug" element={<Protected><Cerebro /></Protected>} />
              <Route path="/criacao" element={<Protected><Criacao /></Protected>} />
              <Route path="/operacao" element={<Protected><Operacao /></Protected>} />
              <Route path="/performance" element={<Protected><Performance /></Protected>} />
              <Route path="/playlist-deals" element={<Protected><PlaylistDeals /></Protected>} />
              <Route path="/curadores" element={<Protected><Curadores /></Protected>} />
              <Route path="/curadoria-preview" element={<Protected><CuradoriaPreview /></Protected>} />
              <Route path="/sistema" element={<Protected><Sistema /></Protected>} />
              <Route path="/settings" element={<Protected><AdminRoute><Settings /></AdminRoute></Protected>} />
              <Route path="/configuracoes" element={<Protected><AdminRoute><Settings /></AdminRoute></Protected>} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </AuthProvider>
        </LoadingProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
