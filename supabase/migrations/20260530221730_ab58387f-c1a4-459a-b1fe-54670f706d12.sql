UPDATE spotify_circuit_breaker
   SET status = 'closed',
       blocked_until = NULL,
       retry_after_sec = 0,
       updated_at = now()
 WHERE app_id = '091a1854-d762-4455-9308-5897f5d8a418';