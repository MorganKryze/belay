-- Absolute session cap: on top of the sliding expiry, a session ends at the latest p_max after it
-- was created, however active. The deadline slides up to created_at + p_max, never past it, and
-- max_age (seconds left) caps the cookie's Max-Age at the same instant.
DROP FUNCTION belay_session_user(text, interval);
--> statement-breakpoint
CREATE FUNCTION belay_session_user(p_token_hash text, p_ttl interval, p_max interval)
RETURNS TABLE (user_id uuid, max_age integer)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE sessions SET expires_at = least(now() + p_ttl, created_at + p_max)
  WHERE token_hash = p_token_hash AND expires_at > now() AND created_at > now() - p_max
  RETURNING user_id, ceil(extract(epoch FROM expires_at - now()))::integer;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION belay_session_user(text, interval, interval) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION belay_session_user(text, interval, interval) TO belay_app;
