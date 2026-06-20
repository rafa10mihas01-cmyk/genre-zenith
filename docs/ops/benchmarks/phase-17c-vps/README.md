# Fase 17-C — Pacote de execução do benchmark VPS

Pacote único, reproduzível, **somente leitura por padrão**, para ser executado
diretamente na VPS conforme o protocolo aprovado em
`docs/ops/phase-17c-vps-benchmark-protocol.md`.

## Conteúdo

- `run-benchmark.mjs` — script único de execução (Node 18+, sem dependências).
- `.env.example` — variáveis necessárias.
- `README.md` — este arquivo.

## Garantias

- **Nenhuma modificação em playlists de produção.** Os endpoints de escrita só
  são exercitados se você passar `--include-writes` E configurar
  `BENCH_SANDBOX_*_PLAYLIST_ID` apontando para playlists dedicadas.
- **Amostra oficial fixa** (Fase 17-C §3): 5 playlists, embutidas no script.
- **Sem dependências externas.** Apenas `fetch` nativo do Node 18+.
- **Nenhuma alteração de banco, worker ou configuração do projeto.** O script
  apenas faz chamadas HTTP e escreve arquivos locais no diretório `--out`.

## Pré-requisitos na VPS

- Node.js 18 ou superior (`node -v`).
- Acesso de saída à internet (Spotify API e/ou base da VPS).
- Credenciais conforme `.env.example`.
- (Opcional) Playlists sandbox criadas para T3.

## Execução

```bash
# 1) copiar o pacote para a VPS (ex: scp -r docs/ops/benchmarks/phase-17c-vps user@vps:~)
cd phase-17c-vps
cp .env.example .env && $EDITOR .env
set -a; . ./.env; set +a

# 2) corrida completa (T0, espera 15 min, T1, paginação, carga 1/5/10 RPS, escritas negativas)
node run-benchmark.mjs --out ./out

# Opções
node run-benchmark.mjs --out ./out --skip vps          # pular um componente
node run-benchmark.mjs --out ./out --include-writes    # habilita T3 contra sandbox
```

Duração aproximada por componente habilitado: ~35–40 min
(T0 ~6 min + espera T1 15 min + T1 ~6 min + paginação + 3×60s de carga + cooldowns).

## Artefatos gerados

No diretório `--out`:

| Arquivo | Conteúdo |
|---|---|
| `benchmark_results.json` | Registros brutos de cada chamada (timestamp, status, latência, erro, preview do body). |
| `benchmark_summary.csv`  | Agregação por `(componente, endpoint)`: n, sucesso%, p50/p95/p99, erros. |
| `benchmark_log.txt`      | Log linear com timestamp UTC de cada passo. |
| `benchmark_report.txt`   | Resumo factual: total de testes, sucesso%, latência média, P95, erros, endpoints, observações. |

## Entrega

Após a execução, compactar o diretório `out/` e devolver para análise:

```bash
tar -czf benchmark-17c-vps-$(date -u +%Y%m%dT%H%M%SZ).tgz -C ./out .
```

A análise será feita exclusivamente sobre esses arquivos, e a matriz
arquitetural da Fase 17-C será preenchida com base nos resultados medidos.

## Importante

- Não modificar este script para incluir endpoints fora do protocolo.
- Não rodar contra playlists de produção em modo escrita.
- Em caso de erro de ambiente (token expirado, VPS inacessível), abortar e
  registrar o estado — não improvisar.
