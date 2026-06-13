// Catálogo — segunda esteira operacional (paralela a Campanhas).
// Distribui músicas em massa na rede de playlists do ecossistema.
// 3 abas: Músicas · Playlists · Histórico.
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { PageContainer } from "@/components/PageContainer";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { MusicasTab } from "@/components/catalogo/MusicasTab";
import { PlaylistsTab } from "@/components/catalogo/PlaylistsTab";
import { HistoricoTab } from "@/components/catalogo/HistoricoTab";

const VALID_TABS = ["musicas", "playlists", "historico"] as const;
type TabId = (typeof VALID_TABS)[number];

export default function Catalogo() {
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab") ?? "musicas";
  const tab: TabId = (VALID_TABS as readonly string[]).includes(raw) ? (raw as TabId) : "musicas";

  const setTab = (next: string) => {
    const p = new URLSearchParams(params);
    p.set("tab", next);
    setParams(p, { replace: true });
  };

  return (
    <PageContainer>
      <PageHeader
        domain="playlists"
        title="Catálogo"
        subtitle="Distribuir músicas em massa na rede de playlists"
        manualKey="catalogo"
      />

      <Tabs value={tab} onValueChange={setTab} className="space-y-6">
        <TabsList>
          <TabsTrigger value="musicas">Músicas</TabsTrigger>
          <TabsTrigger value="playlists">Playlists</TabsTrigger>
          <TabsTrigger value="historico">Histórico</TabsTrigger>
        </TabsList>

        <TabsContent value="musicas" className="space-y-6">
          <MusicasTab />
        </TabsContent>
        <TabsContent value="playlists" className="space-y-6">
          <PlaylistsTab />
        </TabsContent>
        <TabsContent value="historico" className="space-y-6">
          <HistoricoTab />
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}
