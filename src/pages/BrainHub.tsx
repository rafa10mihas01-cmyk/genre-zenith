import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Brain as BrainIcon, ChevronRight, Music, Radio, Flame, Tag, Activity, ScrollText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatNumber, timeAgo } from "@/lib/format";
import { PageContainer } from "@/components/cc/PageContainer";
import Brain from "./Brain";
import Genres from "./Genres";
import Collect from "./Collect";
import Logs from "./Logs";

const TAB_ICONS: Record<string, typeof BrainIcon> = {
  overview: BrainIcon,
  genres: Tag,
  collect: Activity,
  logs: ScrollText,
};

export default function BrainHub() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "overview";

  function setTab(v: string) {
    const next = new URLSearchParams(params);
    next.set("tab", v);
    setParams(next, { replace: true });
  }

  return (
    <PageContainer size="6xl" className="space-y-6">
      <div className="space-y-1">
        <div className="nx-eyebrow"><span className="nx-eyebrow-dot" /> Cérebro</div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Inteligência</h1>
        <p className="text-muted-foreground text-sm">Visão geral, gêneros, coleta e logs do pipeline.</p>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="space-y-6">
        <TabsList className="bg-muted/60">
          <TabsTrigger value="overview" className="gap-2"><BrainIcon className="h-3.5 w-3.5" /> Visão geral</TabsTrigger>
          <TabsTrigger value="genres" className="gap-2"><Tag className="h-3.5 w-3.5" /> Gêneros</TabsTrigger>
          <TabsTrigger value="collect" className="gap-2"><Activity className="h-3.5 w-3.5" /> Coletor</TabsTrigger>
          <TabsTrigger value="logs" className="gap-2"><ScrollText className="h-3.5 w-3.5" /> Logs</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="m-0">
          <Brain />
        </TabsContent>
        <TabsContent value="genres" className="m-0">
          <Genres />
        </TabsContent>
        <TabsContent value="collect" className="m-0">
          <Collect />
        </TabsContent>
        <TabsContent value="logs" className="m-0">
          <Logs />
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}
