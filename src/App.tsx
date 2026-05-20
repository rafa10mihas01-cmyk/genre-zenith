import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import AdminRoute from "@/components/AdminRoute";
import AppLayout from "@/components/AppLayout";
import ScrollManager from "@/components/ScrollManager";
import ScreenStateManager from "@/components/ScreenStateManager";
import { LoadingProvider } from "@/contexts/LoadingContext";
import Login from "./pages/Login";
import ResetPassword from "./pages/ResetPassword";
import Privacy from "./pages/Privacy";
import Landing from "./pages/Landing";
import SpotifyCallback from "./pages/SpotifyCallback";
import RootRoute from "./components/RootRoute";
// Cérebro e Criação foram aposentados — rotas legadas agora redirecionam para /inteligencia
import Operacao from "./pages/Operacao";
import Prospecao from "./pages/Prospecao";
import Clientes from "./pages/Clientes";
import ClienteDetalhe from "./pages/ClienteDetalhe";
import Performance from "./pages/Performance";
import PlaylistDeals from "./pages/PlaylistDeals";
import Financeiro from "./pages/Financeiro";
import DealDetail from "./pages/DealDetail";
// Curadores: rota antiga agora redireciona para /deals?tab=library
import CuradorDetail from "./pages/CuradorDetail";
import CompararCuradores from "./pages/CompararCuradores";
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

// Infraestrutura agora vive como aba dentro de /sistema
import Campanhas from "./pages/Campanhas";
import CampanhaDetalhe from "./pages/CampanhaDetalhe";
import CampanhaExecucao from "./pages/CampanhaExecucao";
import PlanoCampanhaPublico from "./pages/PlanoCampanhaPublico";
import Analytics from "./pages/Analytics";
import Valuation from "./pages/Valuation";
import PlaylistDetail from "./pages/PlaylistDetail";
import Benchmarks from "./pages/Benchmarks";
import MatrizPlaylists from "./pages/MatrizPlaylists";
import HeatmapEntregas from "./pages/HeatmapEntregas";

import NotFound from "./pages/NotFound";

// Defaults globais de cache: navegação "instantânea" sem reload visual.
// staleTime 60s = dados considerados frescos por 1min (não refaz fetch ao voltar).
// gcTime 5min  = mantém em memória 5min após desmontar a query.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      retry: 1,
    },
  },
});

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
        <ScreenStateManager />
        <LoadingProvider>
          <AuthProvider>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/privacy" element={<Privacy />} />
              <Route path="/landing" element={<Landing />} />
              <Route path="/spotify/callback" element={<SpotifyCallback />} />
              <Route path="/spotify/callback/:slug" element={<SpotifyCallback />} />
              <Route path="/curador/:token" element={<CuratorPage />} />
              <Route path="/campanha/:token" element={<ClientCampaignPage />} />
              <Route path="/p/plano/:token" element={<PlanoCampanhaPublico />} />
              {/* Comunidade — beta fechado por convite. Membro não usa AppLayout. */}
              <Route path="/comunidade/join/:code" element={<JoinInvite />} />
              <Route path="/comunidade/onboarding" element={<ProtectedRoute><Onboarding /></ProtectedRoute>} />
              <Route path="/comunidade" element={<ProtectedRoute><ComunidadeDashboard /></ProtectedRoute>} />
              <Route path="/comunidade/campanhas" element={<ProtectedRoute><ComunidadeCampanhas /></ProtectedRoute>} />
              <Route path="/comunidade/pontos" element={<ProtectedRoute><ComunidadePontos /></ProtectedRoute>} />
              <Route path="/comunidade/conta" element={<ProtectedRoute><ComunidadeConta /></ProtectedRoute>} />
              {/* "/" decide entre landing pública (visitantes) e Cockpit/Home (logados). */}
              <Route path="/" element={<RootRoute />} />
              {/* Onda 1 de consolidação: rotas duplicadas viram redirect para a canônica. */}
              <Route path="/executivo" element={<Navigate to="/" replace />} />
              {/* Cérebro, Criação e o hub Inteligência foram aposentados — tudo cai em /analytics. */}
              <Route path="/cerebro" element={<Navigate to="/analytics" replace />} />
              <Route path="/cerebro/:slug" element={<Navigate to="/analytics" replace />} />
              <Route path="/criacao" element={<Navigate to="/analytics" replace />} />
              <Route path="/inteligencia" element={<Navigate to="/analytics" replace />} />
              {/* Catálogo é a rota canônica. /operacao e /playlists redirecionam. */}
              <Route path="/catalogo" element={<Protected><Operacao /></Protected>} />
              <Route path="/prospeccao" element={<Protected><Prospecao /></Protected>} />
              <Route path="/operacao" element={<Navigate to="/catalogo" replace />} />
              <Route path="/playlists" element={<Navigate to="/catalogo" replace />} />
              <Route path="/playlists/:id" element={<Protected><PlaylistDetail /></Protected>} />
              <Route path="/performance" element={<Protected><Performance /></Protected>} />
              <Route path="/playlist-deals" element={<Protected><PlaylistDeals /></Protected>} />
              <Route path="/playlist-deals/:dealId" element={<Protected><DealDetail /></Protected>} />
              {/* Aliases da Fase A — nova nomenclatura da sidebar reorganizada. */}
              <Route path="/deals" element={<Protected><PlaylistDeals /></Protected>} />
              <Route path="/deals/comparar" element={<Protected><CompararCuradores /></Protected>} />
              <Route path="/deals/:dealId" element={<Protected><DealDetail /></Protected>} />
              <Route path="/campanhas" element={<Protected><Campanhas /></Protected>} />
              <Route path="/campanhas/:id/execucao" element={<Protected><CampanhaExecucao /></Protected>} />
              
              <Route path="/campanhas/:id" element={<Protected><CampanhaDetalhe /></Protected>} />
              <Route path="/analytics" element={<Protected><Analytics /></Protected>} />
              {/* /analytics/* viraram redirect para as canônicas /performance e /valuation. */}
              <Route path="/analytics/performance" element={<Navigate to="/performance" replace />} />
              <Route path="/analytics/valuation" element={<Navigate to="/valuation" replace />} />
              <Route path="/valuation" element={<Protected><Valuation /></Protected>} />
              {/* Curadores: hub canônico é /curadores (mesma página de Prospecção, CRM único). */}
              <Route path="/curadores" element={<Protected><Prospecao /></Protected>} />
              <Route path="/clientes" element={<Protected><Clientes /></Protected>} />
              <Route path="/financeiro" element={<Protected><Financeiro /></Protected>} />
              <Route path="/clientes/:id" element={<Protected><ClienteDetalhe /></Protected>} />
              <Route path="/curadores/comparar" element={<Navigate to="/deals/comparar" replace />} />
              <Route path="/curadores/:id" element={<Protected><CuradorDetail /></Protected>} />
              <Route path="/curadoria-preview" element={<Protected><CuradoriaPreview /></Protected>} />
              <Route path="/benchmarks" element={<Protected><Benchmarks /></Protected>} />
              <Route path="/matriz" element={<Protected><MatrizPlaylists /></Protected>} />
              <Route path="/heatmap" element={<Protected><HeatmapEntregas /></Protected>} />
              
              <Route path="/sistema" element={<Protected><Sistema /></Protected>} />
              <Route path="/infra" element={<Protected><AdminRoute><Sistema /></AdminRoute></Protected>} />
              <Route path="/comunidade-admin" element={<Protected><AdminRoute><ComunidadeAdmin /></AdminRoute></Protected>} />
              <Route path="/admin/aprendizado" element={<Navigate to="/sistema?tab=aprendizado" replace />} />
              <Route path="/infraestrutura" element={<Navigate to="/sistema?tab=infra" replace />} />
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
