UPDATE public.curator_deals
SET daily_goal = 35000,
    ends_at = started_at + INTERVAL '26 days',
    target_days = 26
WHERE id = '5eda24d5-b4d1-40aa-bd82-5f343701d0bb';

UPDATE public.curator_deals
SET daily_goal = 15000,
    ends_at = started_at + INTERVAL '30 days',
    target_days = 30
WHERE id = 'b6d1865f-1619-48d3-a704-b496c6ef0a8f';