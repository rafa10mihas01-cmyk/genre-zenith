UPDATE public.curator_playlists
SET match_status = 'curator',
    match_reason = 'declarada pelo curador via portal (correção retroativa)'
WHERE id = 'e2df9274-bf05-4a36-a49b-f103e7229337';