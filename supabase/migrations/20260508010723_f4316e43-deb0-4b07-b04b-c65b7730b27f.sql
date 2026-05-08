-- Remove o log duplicado e seus snapshots associados (gap de 42s da "Eu Já Era Trap")
DELETE FROM curator_deal_snapshots
WHERE deal_id='075baf9d-8537-44d9-ad18-e115b9bf86c0'
  AND song_id='ab66ca9a-0fed-4374-a9e6-af1c6eed0f77'
  AND created_at >= '2026-05-08 00:28:00+00'
  AND created_at <  '2026-05-08 00:29:00+00';

DELETE FROM curator_deal_logs
WHERE id='c8ed0f89-29e1-4cc1-ad05-f14b995ebde9';