
DELETE FROM public.label_spreadsheet_rows WHERE upload_id IN ('9c4dd2f2-afe1-42f0-961f-017e2c0cfbc3','49af894a-429d-4280-80d2-1c88b3d843c9','cd07d3a1-49a9-48ce-a113-ef9614201459','0cc42865-aee3-4d77-938b-11b18cb28961');
UPDATE public.campaign_playlist_collections SET upload_id = NULL WHERE upload_id IN ('9c4dd2f2-afe1-42f0-961f-017e2c0cfbc3','49af894a-429d-4280-80d2-1c88b3d843c9','cd07d3a1-49a9-48ce-a113-ef9614201459','0cc42865-aee3-4d77-938b-11b18cb28961');
UPDATE public.label_spreadsheet_uploads SET superseded_by = NULL WHERE superseded_by IN ('9c4dd2f2-afe1-42f0-961f-017e2c0cfbc3','49af894a-429d-4280-80d2-1c88b3d843c9','cd07d3a1-49a9-48ce-a113-ef9614201459','0cc42865-aee3-4d77-938b-11b18cb28961');
DELETE FROM public.label_spreadsheet_uploads WHERE id IN ('9c4dd2f2-afe1-42f0-961f-017e2c0cfbc3','49af894a-429d-4280-80d2-1c88b3d843c9','cd07d3a1-49a9-48ce-a113-ef9614201459','0cc42865-aee3-4d77-938b-11b18cb28961');
