import { Suspense } from "react";
import { lazyWithReload as lazy } from "@/lib/lazyWithReload";
import { QueryClient, QueryClientProvider, keepPreviousData } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes, useParams } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import AdminRoute from "@/components/AdminRoute";
import AppLayout from "@/components/AppLayout";
import ScrollManager from "@/components/ScrollManager";
import ScreenStateManager from "@/components/ScreenStateManager";
import { LoadingProvider, useBootGate } from "@/contexts/LoadingContext";
import { SplashLoader } from "@/components/SplashLoader";
import { RouteSuspenseFallback } from "@/components/RouteSuspenseFallback";
import RootRoute from "./components/RootRoute";

// ---------------------------------------------------------------------------
// Code-splitting — Fase de performance:
// Antes, App.tsx importava ~50 páginas eagerly. Resultado: o portal público
// /p/plano/:token (cliente final, sem login) baixava o app admin inteiro
// antes de pintar qualquer pixel — tela preta de 3-8s no 4G.
// Agora cada rota é um chunk separado via React.lazy. O Suspense fallback
// mostra um skeleton escuro (bg-background) imediato — sem flash em branco.
// ---------------------------------------------------------------------------
const Login = lazy(() => import("./pages/Login"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const Privacy = lazy(() => import("./pages/Privacy"));
const Landing = lazy(() => import("./pages/Landing"));
const SpotifyCallback = lazy(() => import("./pages/SpotifyCallback"));
const SpotifyInvite = lazy(() => import("./pages/SpotifyInvite"));
const Operacao = lazy(() => import("./pages/Operacao"));
const Prospecao = lazy(() => import("./pages/Prospecao"));
const Clientes = lazy(() => import("./pages/Clientes"));
const ClienteDetalhe = lazy(() => import("./pages/ClienteDetalhe"));
const Performance = lazy(() => import("./pages/Performance"));
const PlaylistDeals = lazy(() => import("./pages/PlaylistDeals"));
const Financeiro = lazy(() => import("./pages/Financeiro"));
const DealDetail = lazy(() => import("./pages/DealDetail"));
const CuradorDetail = lazy(() => import("./pages/CuradorDetail"));
const CompararCuradores = lazy(() => import("./pages/CompararCuradores"));
const CuratorPage = lazy(() => import("./pages/CuratorPage"));
const LegacyCampaignRedirect = lazy(() => import("./pages/LegacyCampaignRedirect"));
const CuradoriaPreview = lazy(() => import("./pages/CuradoriaPreview"));
const Sistema = lazy(() => import("./pages/Sistema"));
const Settings = lazy(() => import("./pages/Settings"));
const JoinInvite = lazy(() => import("./pages/comunidade/JoinInvite"));
const Onboarding = lazy(() => import("./pages/comunidade/Onboarding"));
const ComunidadeDashboard = lazy(() => import("./pages/comunidade/Dashboard"));
const ComunidadeCampanhas = lazy(() => import("./pages/comunidade/Campanhas"));
const ComunidadePontos = lazy(() => import("./pages/comunidade/Pontos"));
const ComunidadeConta = lazy(() => import("./pages/comunidade/Conta"));
const ComunidadeAdmin = lazy(() => import("./pages/ComunidadeAdmin"));
const Campanhas = lazy(() => import("./pages/Campanhas"));
const CampanhaDetalhe = lazy(() => import("./pages/CampanhaDetalhe"));
const CampanhaExecucao = lazy(() => import("./pages/CampanhaExecucao"));
const Catalogo = lazy(() => import("./pages/Catalogo"));
const CatalogoMusicaPreview = lazy(() => import("./pages/CatalogoMusicaPreview"));
const CatalogoMusicaDetalhe = lazy(() => import("./pages/CatalogoMusicaDetalhe"));

const PlanoCampanhaPublico = lazy(() => import("./pages/PlanoCampanhaPublico"));
const MapaCampanhaPublico = lazy(() => import("./pages/MapaCampanhaPublico"));
const Analytics = lazy(() => import("./pages/Analytics"));
const Valuation = lazy(() => import("./pages/Valuation"));
const PlaylistDetail = lazy(() => import("./pages/PlaylistDetail"));
const Benchmarks = lazy(() => import("./pages/Benchmarks"));
const NotFound = lazy(() => import("./pages/NotFound"));
const CampaignInventory = lazy(() => import("./pages/CampaignInventory"));

// Defaults globais de cache: navegação "instantânea" sem reload visual.
// Dia 1 perf: refetchOnWindowFocus DESLIGADO globalmente (cada troca de aba
// disparava dezenas de queries inúteis). Hooks que precisam de refetch ao
// voltar (notificações, financeiro) ativam localmente.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60_000,           // antes 2min — cache mais longo evita refetch ao voltar
      gcTime: 30 * 60_000,             // mantém cache por sessão inteira
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      refetchOnMount: false,           // se cache fresco, não pisca
      retry: 1,
      placeholderData: keepPreviousData, // troca de parâmetro mantém dado anterior
    },
  },
});

// Suspense interno fica DENTRO do AppLayout — quando uma rota lazy carrega,
// sidebar+topbar permanecem montados; só a área de conteúdo mostra fallback.
// Resolve "tela branca entre rotas" / desmonte do shell.
const Protected = ({ children }: { children: React.ReactNode }) => (
  <ProtectedRoute>
    <AppLayout>
      <Suspense fallback={<RouteSuspenseFallback />}>{children}</Suspense>
    </AppLayout>
  </ProtectedRoute>
);

const LegacyDealRedirect = () => {
  const { dealId } = useParams();
  return <Navigate to={`/deals/${dealId ?? ""}`} replace />;
};

// Fallback global de Suspense. Em vez de renderizar skeleton próprio (causa
// "flash de layout" quando o chunk chega), apenas mantém o SplashLoader global
// ligado via useBootGate. Resultado: um único loader, sincronizado de verdade
// com o término do chunk — nada de timer fixo.
const RouteFallback = () => {
  useBootGate(true);
  return null;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner theme="dark" position="top-right" />
      <BrowserRouter>
        <ScrollManager />
        <ScreenStateManager />
        <LoadingProvider>
          {/* Splash global — cobre auth + Suspense + rotas públicas */}
          <SplashLoader />
          <AuthProvider>
            <Suspense fallback={<RouteFallback />}>
              <Routes>
                <Route path="/login" element={<Login />} />
                <Route path="/reset-password" element={<ResetPassword />} />
                <Route path="/privacy" element={<Privacy />} />
                <Route path="/landing" element={<Landing />} />
                <Route path="/spotify/callback" element={<SpotifyCallback />} />
                <Route path="/spotify/callback/:slug" element={<SpotifyCallback />} />
                <Route path="/spotify/invite/:token" element={<SpotifyInvite />} />
                <Route path="/curador/:token" element={<CuratorPage />} />
                <Route path="/campanha/:token" element={<LegacyCampaignRedirect />} />
                <Route path="/p/plano/:token" element={<PlanoCampanhaPublico />} />
                <Route path="/mapa/:token" element={<MapaCampanhaPublico />} />
                <Route path="/comunidade/join/:code" element={<JoinInvite />} />
                <Route path="/comunidade/onboarding" element={<ProtectedRoute><Onboarding /></ProtectedRoute>} />
                <Route path="/comunidade" element={<ProtectedRoute><ComunidadeDashboard /></ProtectedRoute>} />
                <Route path="/comunidade/campanhas" element={<ProtectedRoute><ComunidadeCampanhas /></ProtectedRoute>} />
                <Route path="/comunidade/pontos" element={<ProtectedRoute><ComunidadePontos /></ProtectedRoute>} />
                <Route path="/comunidade/conta" element={<ProtectedRoute><ComunidadeConta /></ProtectedRoute>} />
                <Route path="/" element={<RootRoute />} />
                <Route path="/executivo" element={<Navigate to="/" replace />} />
                <Route path="/cerebro" element={<Navigate to="/analytics" replace />} />
                <Route path="/cerebro/:slug" element={<Navigate to="/analytics" replace />} />
                <Route path="/criacao" element={<Navigate to="/analytics" replace />} />
                <Route path="/inteligencia" element={<Navigate to="/analytics" replace />} />
                <Route path="/catalogo" element={<Protected><Catalogo /></Protected>} />
                <Route path="/catalogo/preview-musica" element={<Protected><CatalogoMusicaPreview /></Protected>} />
                <Route path="/catalogo/musica/:id" element={<Protected><CatalogoMusicaDetalhe /></Protected>} />
                <Route path="/prospeccao" element={<Protected><Prospecao /></Protected>} />
                <Route path="/operacao" element={<Protected><Operacao /></Protected>} />
                <Route path="/playlists" element={<Navigate to="/operacao" replace />} />
                <Route path="/playlists/:id" element={<Protected><PlaylistDetail /></Protected>} />
                <Route path="/performance" element={<Protected><Performance /></Protected>} />
               <Route path="/playlist-deals" element={<Navigate to="/deals" replace />} />
               <Route path="/playlist-deals/:dealId" element={<LegacyDealRedirect />} />
               <Route path="/deals" element={<Protected><PlaylistDeals /></Protected>} />
               <Route path="/deals/comparar" element={<Protected><CompararCuradores /></Protected>} />
               <Route path="/deals/:dealId" element={<Protected><DealDetail /></Protected>} />
                <Route path="/campanhas" element={<Protected><Campanhas /></Protected>} />
                <Route path="/campanhas/:id/execucao" element={<Protected><CampanhaExecucao /></Protected>} />
                <Route path="/campanhas/:id/monitoramento" element={<Navigate to="../execucao" replace />} />
                <Route path="/campanhas/:id" element={<Protected><CampanhaDetalhe /></Protected>} />
                <Route path="/analytics" element={<Protected><Analytics /></Protected>} />
                <Route path="/analytics/performance" element={<Navigate to="/performance" replace />} />
                <Route path="/analytics/valuation" element={<Navigate to="/valuation" replace />} />
                <Route path="/valuation" element={<Protected><Valuation /></Protected>} />
                <Route path="/curadores" element={<Protected><Prospecao /></Protected>} />
                <Route path="/clientes" element={<Protected><Clientes /></Protected>} />
                <Route path="/financeiro" element={<Protected><Financeiro /></Protected>} />
                <Route path="/clientes/:id" element={<Protected><ClienteDetalhe /></Protected>} />
                <Route path="/curadores/comparar" element={<Navigate to="/deals/comparar" replace />} />
                <Route path="/curadores/:id" element={<Protected><CuradorDetail /></Protected>} />
                <Route path="/curadoria-preview" element={<Protected><CuradoriaPreview /></Protected>} />
                <Route path="/benchmarks" element={<Protected><Benchmarks /></Protected>} />
                <Route path="/matriz" element={<Navigate to="/performance?tab=matriz" replace />} />
                <Route path="/heatmap" element={<Navigate to="/analytics" replace />} />
                <Route path="/sistema" element={<Protected><Sistema /></Protected>} />
                <Route path="/infra" element={<Protected><AdminRoute><Sistema /></AdminRoute></Protected>} />
                <Route path="/comunidade-admin" element={<Protected><AdminRoute><ComunidadeAdmin /></AdminRoute></Protected>} />
                <Route path="/admin/aprendizado" element={<Navigate to="/sistema?tab=aprendizado" replace />} />
                <Route path="/infraestrutura" element={<Navigate to="/sistema?tab=infra" replace />} />
                <Route path="/settings" element={<Protected><AdminRoute><Settings /></AdminRoute></Protected>} />
                <Route path="/configuracoes" element={<Protected><AdminRoute><Settings /></AdminRoute></Protected>} />
                <Route path="/campaign-inventory" element={<Protected><AdminRoute><CampaignInventory /></AdminRoute></Protected>} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </AuthProvider>
        </LoadingProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
