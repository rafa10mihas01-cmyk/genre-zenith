#!/usr/bin/env node
// Auditor de dependências — escaneia DB + código pra um conjunto de "alvos" (tabela, coluna, função, trigger).
// Uso: node scripts/audit-dependencies.mjs <targets.json> [--out report.md]
//
// targets.json formato:
// {
//   "phase": "1.A — Baseline de playlist",
//   "targets": [
//     {"kind":"table","name":"curator_deal_baseline_playlists"},
//     {"kind":"column","table":"curator_deal_snapshots","name":"is_baseline"},
//     {"kind":"function","name":"is_playlist_in_deal_baseline"},
//     {"kind":"trigger","name":"trg_sync_baseline_on_deal_insert"}
//   ]
// }

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { argv } from "node:process";

const targetsFile = argv[2];
const outFlag = argv.indexOf("--out");
const outFile = outFlag >= 0 ? argv[outFlag + 1] : null;
if (!targetsFile) {
  console.error("usage: audit-dependencies.mjs <targets.json> [--out report.md]");
  process.exit(1);
}
const { phase, targets } = JSON.parse(readFileSync(targetsFile, "utf8"));

const psql = (sql) =>
  execSync(`psql -At -F '|' -c ${JSON.stringify(sql)}`, { encoding: "utf8" })
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => l.split("|"));

const grep = (pattern, paths) => {
  try {
    return execSync(
      `rg -n --no-heading -F ${JSON.stringify(pattern)} ${paths.join(" ")} -g '!*.md' -g '!node_modules' -g '!types.ts' 2>/dev/null || true`,
      { encoding: "utf8" }
    )
      .trim()
      .split("\n")
      .filter(Boolean);
  } catch {
    return [];
  }
};

const codePaths = ["src", "supabase/functions"];

function auditDb(t) {
  const out = { triggers: [], functions: [], views: [], policies: [], fks: [] };
  if (t.kind === "table") {
    out.functions = psql(
      `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND pg_get_functiondef(p.oid) ~* '\\m${t.name}\\M'`
    ).flat();
    out.views = psql(
      `SELECT table_name FROM information_schema.views WHERE table_schema='public' AND view_definition ~* '\\m${t.name}\\M'`
    ).flat();
    out.triggers = psql(
      `SELECT event_object_table||'.'||trigger_name FROM information_schema.triggers WHERE trigger_schema='public' AND action_statement ~* '\\m${t.name}\\M'`
    ).flat();
    out.fks = psql(
      `SELECT conrelid::regclass::text||'.'||conname FROM pg_constraint WHERE contype='f' AND confrelid='public.${t.name}'::regclass`
    ).flat();
    out.policies = psql(
      `SELECT schemaname||'.'||tablename||'.'||policyname FROM pg_policies WHERE qual ~* '\\m${t.name}\\M' OR with_check ~* '\\m${t.name}\\M'`
    ).flat();
  } else if (t.kind === "column") {
    const fq = `${t.table}.${t.name}`;
    out.functions = psql(
      `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND pg_get_functiondef(p.oid) ~* '\\m${t.name}\\M' AND pg_get_functiondef(p.oid) ~* '\\m${t.table}\\M'`
    ).flat();
    out.views = psql(
      `SELECT table_name FROM information_schema.views WHERE table_schema='public' AND view_definition ~* '\\m${t.name}\\M' AND view_definition ~* '\\m${t.table}\\M'`
    ).flat();
    out.triggers = psql(
      `SELECT event_object_table||'.'||trigger_name FROM information_schema.triggers WHERE trigger_schema='public' AND event_object_table='${t.table}'`
    ).flat();
  } else if (t.kind === "function") {
    out.functions = psql(
      `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname<>'${t.name}' AND pg_get_functiondef(p.oid) ~* '\\m${t.name}\\M'`
    ).flat();
    out.triggers = psql(
      `SELECT event_object_table||'.'||trigger_name FROM information_schema.triggers WHERE trigger_schema='public' AND action_statement ~* '\\m${t.name}\\M'`
    ).flat();
    out.policies = psql(
      `SELECT schemaname||'.'||tablename||'.'||policyname FROM pg_policies WHERE qual ~* '\\m${t.name}\\M' OR with_check ~* '\\m${t.name}\\M'`
    ).flat();
  } else if (t.kind === "trigger") {
    out.triggers = psql(
      `SELECT event_object_table||'.'||trigger_name FROM information_schema.triggers WHERE trigger_schema='public' AND trigger_name='${t.name}'`
    ).flat();
  }
  return out;
}

function auditCode(t) {
  const pattern =
    t.kind === "column"
      ? t.name // matches both bare column and `table.column`
      : t.name;
  return grep(pattern, codePaths);
}

function fmtTarget(t) {
  if (t.kind === "column") return `\`${t.table}.${t.name}\` (coluna)`;
  if (t.kind === "table") return `\`${t.name}\` (tabela)`;
  if (t.kind === "function") return `\`${t.name}()\` (função SQL)`;
  if (t.kind === "trigger") return `\`${t.name}\` (trigger)`;
  return JSON.stringify(t);
}

const lines = [
  `# Dependency Audit — ${phase}`,
  `Gerado: ${new Date().toISOString()}`,
  "",
];

let totalDeps = 0;

for (const t of targets) {
  const db = auditDb(t);
  const code = auditCode(t);
  const dbCount =
    db.triggers.length + db.functions.length + db.views.length + db.policies.length + db.fks.length;
  const codeCount = code.length;
  const total = dbCount + codeCount;
  totalDeps += total;

  lines.push(`## ${fmtTarget(t)} — ${total === 0 ? "✅ ZERO dependências" : `🔴 ${total} dependências`}`);
  lines.push("");
  if (db.triggers.length)
    lines.push(`- **Triggers (${db.triggers.length}):** ${db.triggers.join(", ")}`);
  if (db.functions.length)
    lines.push(`- **Funções SQL (${db.functions.length}):** ${db.functions.join(", ")}`);
  if (db.views.length) lines.push(`- **Views (${db.views.length}):** ${db.views.join(", ")}`);
  if (db.policies.length)
    lines.push(`- **Políticas RLS (${db.policies.length}):** ${db.policies.join(", ")}`);
  if (db.fks.length) lines.push(`- **FKs (${db.fks.length}):** ${db.fks.join(", ")}`);
  if (codeCount) {
    lines.push(`- **Código (${codeCount} ocorrências):**`);
    for (const c of code.slice(0, 50)) lines.push(`  - \`${c}\``);
    if (codeCount > 50) lines.push(`  - …e mais ${codeCount - 50}`);
  }
  lines.push("");
}

lines.push("---");
lines.push(`**TOTAL DE DEPENDÊNCIAS: ${totalDeps}**`);
lines.push(totalDeps === 0 ? "✅ Pronto para DROP." : "🔴 DROP bloqueado — resolver acima primeiro.");

const out = lines.join("\n");
if (outFile) {
  writeFileSync(outFile, out);
  console.log(`Relatório salvo em ${outFile}`);
} else {
  console.log(out);
}
process.exit(totalDeps === 0 ? 0 : 2);
