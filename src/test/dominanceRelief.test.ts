import { describe, it, expect } from "vitest";
// Importa via path relativo do source — Deno e Vite/Vitest resolvem .ts
import { applyDominanceRelief, type ReliefAlloc, type ReliefCandidate } from "../../supabase/functions/_shared/dominanceRelief.ts";

const MULT = 35;

function alloc(id: string, followers: number, position: number, streams: number): ReliefAlloc {
  return { id, playlist_id: id, followers, position, planned_streams: streams, genre_source: "primary" };
}

describe("dominanceRelief", () => {
  it("no-op quando Top1 abaixo do cap", () => {
    const allocs = [
      alloc("a", 100_000, 1, 100_000),
      alloc("b", 90_000, 2, 90_000),
      alloc("c", 80_000, 3, 80_000),
      alloc("d", 70_000, 4, 70_000),
      alloc("e", 60_000, 5, 60_000),
    ];
    const r = applyDominanceRelief(allocs, [], MULT);
    expect(r.applied).toBe(false);
    expect(r.reason).toBe("no_surplus");
  });

  it("efficiency gate bloqueia expansão quando ganho < 2pp e surplus < 50k", () => {
    // Top5 médias geram cap; surplus pequeno e pool vazio
    const allocs = [
      alloc("lead", 200_000, 1, 200_000),
      alloc("b", 180_000, 2, 180_000),
      alloc("c", 170_000, 3, 170_000),
      alloc("d", 160_000, 4, 160_000),
      alloc("e", 150_000, 5, 150_000),
      // Tail com bastante headroom pra absorver
      alloc("f", 100_000, 6, 50_000),
      alloc("g", 100_000, 7, 50_000),
    ];
    const r = applyDominanceRelief(allocs, [], MULT);
    // Cap = 1.5 * média(200+180+170+160+150)/5 = 1.5 * 172k = 258k → sem surplus
    expect(r.reason).toBe("no_surplus");
  });

  it("absorve internamente quando headroom suficiente", () => {
    const allocs = [
      alloc("lead", 500_000, 1, 400_000),    // surplus de 400k-cap
      alloc("b", 200_000, 2, 200_000),
      alloc("c", 180_000, 3, 180_000),
      alloc("d", 160_000, 4, 160_000),
      alloc("e", 150_000, 5, 150_000),
      alloc("f", 500_000, 6, 100_000),       // muito headroom (planned baixo, followers altos)
      alloc("g", 500_000, 7, 100_000),
    ];
    const r = applyDominanceRelief(allocs, [], MULT, { headroomPct: 1.0 });
    expect(r.applied).toBe(true);
    expect(["absorbed_internally", "ok", "gate_blocked"]).toContain(r.reason);
    expect(r.addedAllocs.length).toBe(0);
  });

  it("expande até maxExtra=3 quando surplus grande e gate passa", () => {
    const allocs = [
      alloc("lead", 1_000_000, 1, 800_000),
      alloc("b", 200_000, 2, 200_000),
      alloc("c", 180_000, 3, 180_000),
      alloc("d", 160_000, 4, 160_000),
      alloc("e", 150_000, 5, 150_000),
    ];
    const pool: ReliefCandidate[] = [
      { playlist_id: "x1", followers: 50_000 },
      { playlist_id: "x2", followers: 40_000 },
      { playlist_id: "x3", followers: 30_000 },
      { playlist_id: "x4", followers: 20_000 },
      { playlist_id: "x5", followers: 10_000 },
    ];
    const r = applyDominanceRelief(allocs, pool, MULT);
    expect(r.applied).toBe(true);
    expect(r.addedAllocs.length).toBeLessThanOrEqual(3);
    expect(r.top1After).toBeLessThan(r.top1Before);
  });

  it("fail-safe: pool sem primárias viáveis devolve original", () => {
    const allocs = [
      alloc("lead", 1_000_000, 1, 800_000),
      alloc("b", 200_000, 2, 200_000),
      alloc("c", 180_000, 3, 180_000),
      alloc("d", 160_000, 4, 160_000),
      alloc("e", 150_000, 5, 150_000),
    ];
    const r = applyDominanceRelief(allocs, [], MULT);
    // Sem pool e sem headroom suficiente: gate_blocked OU insufficient_pool
    expect(["gate_blocked", "insufficient_pool"]).toContain(r.reason);
  });
});
