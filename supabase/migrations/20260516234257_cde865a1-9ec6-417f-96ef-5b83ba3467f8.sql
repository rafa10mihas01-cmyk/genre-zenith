ALTER TABLE public.recommendation_feedback
  DROP CONSTRAINT IF EXISTS recommendation_feedback_action_check;

ALTER TABLE public.recommendation_feedback
  ADD CONSTRAINT recommendation_feedback_action_check
  CHECK (action = ANY (ARRAY[
    'vista','descartada','util','inutil',
    'visto','descartado','converted_to_deal','removal_requested'
  ]));

CREATE UNIQUE INDEX IF NOT EXISTS recommendation_feedback_user_fit_uniq
  ON public.recommendation_feedback (user_id, fit_id);