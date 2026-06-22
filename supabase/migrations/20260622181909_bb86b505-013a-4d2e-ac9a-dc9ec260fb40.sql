
-- Reativar NexEngine 09
UPDATE public.spotify_apps
   SET status = 'active', updated_at = now()
 WHERE id = '3a05802d-e192-4501-adfc-c9ff69070411';

-- NexEngine 05 (821cb0cc...) recebe 2 do 06
UPDATE public.spotify_user_tokens
   SET app_id = '821cb0cc-001b-4d2f-a0c0-66cafe055e72', updated_at = now()
 WHERE id IN (
   'b95f70cf-7ba1-42bb-a5fd-ce58b585dfe6', -- contasladosul
   '57338e2b-ee63-4ad4-bef6-c13e50abe89f'  -- contasladosul312
 );

-- NexEngine 09 (3a05802d...) recebe 3 do 06
UPDATE public.spotify_user_tokens
   SET app_id = '3a05802d-e192-4501-adfc-c9ff69070411', updated_at = now()
 WHERE id IN (
   '11a4a94f-8bd6-4edf-b123-534fb732f58d', -- equipeostentasoadofunk
   '87eaf74b-485d-4dd7-ace8-09cccaa45ebc', -- lucas2007batista
   '4c490112-e3d9-4e7f-943b-6b891289f00c'  -- marketing.ladosulmusic
 );

-- NexEngine 10 (a7ed22bc...) recebe 4 do 08
UPDATE public.spotify_user_tokens
   SET app_id = 'a7ed22bc-c150-47d0-b523-355d58346c59', updated_at = now()
 WHERE id IN (
   'c1e43bf8-22af-4887-8712-26766ccf56e5', -- distribuicao@kondzilla
   '73de5527-158e-49e0-874d-06036c7caefb', -- oficialtropadoscria
   '8a9e9c46-1cf5-46c3-b42e-bc27f65845d3', -- playlistladosul
   'b287489c-f99a-428d-8964-ba996a57596f'  -- playlistladosul4
 );
