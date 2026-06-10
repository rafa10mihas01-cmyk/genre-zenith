
-- 1. Escolhe o batch "vencedor" por correlation_id (prioridade: processed > complete > pending > error; desempate pelo mais recente)
WITH ranked AS (
  SELECT id, correlation_id,
    ROW_NUMBER() OVER (
      PARTITION BY correlation_id
      ORDER BY
        CASE status WHEN 'processed' THEN 1 WHEN 'complete' THEN 2 WHEN 'pending' THEN 3 WHEN 'error' THEN 4 ELSE 5 END,
        created_at DESC
    ) AS rn
  FROM bot_print_batches
  WHERE correlation_id IS NOT NULL
),
winners AS (SELECT correlation_id, id AS winner_id FROM ranked WHERE rn = 1),
losers AS (
  SELECT r.id AS loser_id, w.winner_id
  FROM ranked r
  JOIN winners w USING (correlation_id)
  WHERE r.rn > 1
)
-- 2. Re-aponta FKs dos perdedores pro vencedor
, up1 AS (
  UPDATE delivery_proofs dp SET bot_correlation_id = dp.bot_correlation_id
  FROM losers l WHERE FALSE RETURNING 1
)
-- (delivery_proofs não referencia bot_print_batches diretamente; pulando)
, up2 AS (
  UPDATE curator_deal_snapshots s SET snapshot_run_id = l.winner_id
  FROM losers l WHERE s.snapshot_run_id = l.loser_id RETURNING 1
)
, up3 AS (
  UPDATE song_snapshots s SET snapshot_run_id = l.winner_id
  FROM losers l WHERE s.snapshot_run_id = l.loser_id RETURNING 1
)
, up4 AS (
  UPDATE campaign_playlist_collections c SET snapshot_run_id = l.winner_id
  FROM losers l WHERE c.snapshot_run_id = l.loser_id RETURNING 1
)
-- 3. Deleta perdedores
, del AS (
  DELETE FROM bot_print_batches WHERE id IN (SELECT loser_id FROM losers) RETURNING 1
)
SELECT
  (SELECT count(*) FROM losers) AS losers_count,
  (SELECT count(*) FROM up2) AS snapshots_repointed,
  (SELECT count(*) FROM up3) AS song_snapshots_repointed,
  (SELECT count(*) FROM up4) AS collections_repointed,
  (SELECT count(*) FROM del) AS deleted;

-- 4. Índice único para impedir duplicados futuros
CREATE UNIQUE INDEX IF NOT EXISTS uniq_bot_print_batches_correlation_id
  ON bot_print_batches(correlation_id)
  WHERE correlation_id IS NOT NULL;
