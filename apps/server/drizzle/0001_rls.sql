-- The application never queries as the table owner. Each request runs
-- `SET LOCAL ROLE belay_app` inside its transaction, so RLS applies even when
-- the connecting user is a superuser (the official postgres image default).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'belay_app') THEN
    CREATE ROLE belay_app NOLOGIN;
  END IF;
END
$$;
--> statement-breakpoint
GRANT belay_app TO CURRENT_USER;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO belay_app;
--> statement-breakpoint
GRANT SELECT ON users TO belay_app;
--> statement-breakpoint
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY users_self ON users TO belay_app
  USING (id = nullif(current_setting('app.user_id', true), '')::uuid);
--> statement-breakpoint
-- sessions: no grant at all. belay_app reaches it only through the functions below.
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE FUNCTION belay_upsert_user(p_id uuid, p_issuer text, p_sub text, p_name text)
RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  INSERT INTO users (id, oidc_issuer, oidc_sub, display_name)
  VALUES (p_id, p_issuer, p_sub, p_name)
  ON CONFLICT (oidc_issuer, oidc_sub)
  DO UPDATE SET display_name = excluded.display_name, updated_at = now()
  RETURNING id;
$$;
--> statement-breakpoint
-- ponytail: expired sessions are purged lazily on each login; a scheduled job if the table grows.
CREATE FUNCTION belay_create_session(p_token_hash text, p_user_id uuid, p_ttl interval)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  DELETE FROM sessions WHERE expires_at <= now();
  INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (p_token_hash, p_user_id, now() + p_ttl);
$$;
--> statement-breakpoint
-- Sliding expiry: every authenticated request pushes the deadline back.
-- ponytail: one UPDATE per request; throttle it if the instance ever serves more than a few dozen people.
CREATE FUNCTION belay_session_user(p_token_hash text, p_ttl interval)
RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE sessions SET expires_at = now() + p_ttl
  WHERE token_hash = p_token_hash AND expires_at > now()
  RETURNING user_id;
$$;
--> statement-breakpoint
CREATE FUNCTION belay_delete_session(p_token_hash text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  DELETE FROM sessions WHERE token_hash = p_token_hash;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION belay_upsert_user, belay_create_session, belay_session_user, belay_delete_session FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION belay_upsert_user, belay_create_session, belay_session_user, belay_delete_session TO belay_app;
