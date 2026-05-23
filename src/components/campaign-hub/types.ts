import type { CampaignSnapshot } from "@/lib/campaignSnapshot";

export type CampaignHubMode = "internal" | "client";

export type EcoAllocation = {
  id: string;
  managed_playlist_id: string;
  planned_streams: number;
  start_day: number;
  status: string;
  dispatched_at: string | null;
  managed_playlists?: { name: string; cover_url: string | null; followers: number; spotify_url?: string | null } | null;
};

export type CampaignHubCampaign = {
  id: string;
  track_name: string;
  artist: string | null;
  cover_url: string | null;
  status: string;
  deadline: string | null;
  started_at: string;
  simulation_snapshot: CampaignSnapshot | null;
  snapshot_locked_at: string | null;
  eco_dispatched_at: string | null;
  engagement_multiplier?: number | null;
  public_plan_token?: string | null;
  deal_id?: string | null;
  spotify_track_url?: string | null;
  total_delivered?: number | null;
  client_approved_at?: string | null;
};

export type CampaignHubTabId =
  | "overview"
  | "playlists"
  | "proofs"
  | "curve"
  | "upload"
  | "finance"
  | "logs";
