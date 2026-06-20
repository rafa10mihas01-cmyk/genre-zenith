# INT-001 — SPOTIFY_APP_USER_NOT_WHITELISTED

**Aberto em:** 2026-06-20
**Origem:** Auditoria de fechamento da Fase 17-B.6 (revalidate-deliveries)
**Severidade:** Média — bloqueia validação OAuth de 1 playlist managed conhecida; potencialmente outras.
**Categoria:** Configuração externa (Spotify Developer Dashboard). **NÃO é bug de código.**
**Status:** Aberto — fora do escopo das fases de migração CC/OAuth/VPS.

## Sintoma

Worker `revalidate-deliveries` (e potencialmente qualquer worker que use OAuth managed) recebe a exception:

```
SPOTIFY_APP_USER_NOT_WHITELISTED app=<APP_ID> user=<SPOTIFY_USER_ID>:
Check settings on https://developer.spotify.com/dashboard,
the user may not be registered.
```

## Caso confirmado (auditoria 2026-06-20)

| Campo | Valor |
|---|---|
| App ID (interno, tabela `spotify_apps`) | `e9a23b28-a4cf-4386-ba26-7277f870952a` |
| Spotify User ID afetado | `31goz5mop3omjdye64kwlcqfbjga` |
| Playlist managed bloqueada | `0NoXMb7qxkp96eOxlWZCJE` — "BAILE DO PERNA - Funk 2026 🔞 AS MAIS TOCADAS!" |
| `managed_playlists.account_id` | `73de5527-158e-49e0-874d-06036c7caefb` |
| Ocorrências em 24h | 8 exceptions consecutivas |

## Causa raiz

O app Spotify referenciado por `spotify_apps.id = e9a23b28-...` está em **Development Mode** no Spotify Developer Dashboard. Em Development Mode, apenas usuários explicitamente adicionados em **Users and Access** podem autenticar via OAuth nesse app. O usuário `31goz5mop3omjdye64kwlcqfbjga` não está nessa lista.

## Ação necessária (manual, fora do código)

1. Identificar o `client_id` real do app via:
   ```sql
   SELECT id, name, client_id FROM spotify_apps WHERE id = 'e9a23b28-a4cf-4386-ba26-7277f870952a';
   ```
2. Abrir o app correspondente em https://developer.spotify.com/dashboard.
3. Em **Users and Access**, adicionar o email associado ao Spotify ID `31goz5mop3omjdye64kwlcqfbjga`.
4. Alternativa de longo prazo: submeter o app para **Extended Quota Mode** (remove o limite de 25 usuários e a necessidade de whitelist manual).

## Levantamento sugerido antes de fechar

Rodar para descobrir se há outros pares `(app, user)` na mesma situação:

```sql
SELECT
  substring(error from 'app=([0-9a-f-]+)') AS app_id,
  substring(error from 'user=([A-Za-z0-9]+)') AS spotify_user_id,
  count(*) AS occurrences,
  max(created_at) AS last_seen
FROM spotify_call_log
WHERE error LIKE 'SPOTIFY_APP_USER_NOT_WHITELISTED%'
  AND created_at > now() - interval '30 days'
GROUP BY 1, 2
ORDER BY occurrences DESC;
```

## Por que NÃO é hotfix de código

- O lookup `managed_playlists` em `revalidate-deliveries` está correto (confirmado na auditoria de fechamento da 17-B.6).
- O roteamento híbrido §2.3 está funcionando: managed → OAuth, público → Gateway CC.
- O OAuth obtém token com sucesso (HTTP 200 em `accounts.spotify.com/api/token`). A falha é na *chamada subsequente* à API por restrição de allowlist do app.
- Qualquer "fix" no código seria mascarar uma config faltante no Spotify Dashboard.
