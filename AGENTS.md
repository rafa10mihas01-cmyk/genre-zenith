# Architecture rules

- When Spotify Web API metadata lookup is quota-blocked, user-driven track resolution may use public oEmbed metadata without writing incomplete data into the canonical Spotify cache; this keeps manual/Campaign sends available without weakening Catalog authorization.
- Playlist write queues must consult only Spotify circuit breakers with `context = 'operation'`; enrichment breakers never pause Campaign or manual writes.