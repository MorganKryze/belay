CREATE TABLE "ended_sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
-- Hand-written below this line: drizzle-kit does not track grants and policies (see 0001_rls).
-- ended_sessions: no grant at all, as sessions; belay_app reaches it only through the functions.
ALTER TABLE ended_sessions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Erases one account and every row tied to it through the cascade each user_id carries, in the
-- caller's transaction. Its live tokens are kept, hashed and with no account, until they would
-- have expired. Owner only: no role is granted it; the functions below and the operator call it.
CREATE FUNCTION belay_erase_account(p_user uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  -- The key a sync of this account holds (api/sync.ts): a running sync ends first, and the next
  -- one starts after the erasure, so it meets a gone account, never a half-deleted one.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user::text, 0));
  -- Then the account's row, so a session opened meanwhile waits and is copied below, or is refused.
  PERFORM 1 FROM users WHERE id = p_user FOR UPDATE;
  DELETE FROM ended_sessions WHERE expires_at <= now();
  INSERT INTO ended_sessions (token_hash, expires_at)
    SELECT token_hash, expires_at FROM sessions WHERE user_id = p_user AND expires_at > now()
    ON CONFLICT (token_hash) DO NOTHING;
  DELETE FROM users WHERE id = p_user;
END
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION belay_erase_account FROM PUBLIC;
--> statement-breakpoint
-- Erases the account of the session this token opened. The app role keeps no DELETE grant: it can
-- erase only the account whose live session token it holds. NULL: no live session.
CREATE FUNCTION belay_delete_account(p_token_hash text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_user uuid;
BEGIN
  SELECT user_id INTO v_user FROM sessions WHERE token_hash = p_token_hash AND expires_at > now();
  IF v_user IS NULL THEN
    RETURN NULL;
  END IF;
  PERFORM belay_erase_account(v_user);
  RETURN v_user;
END
$$;
--> statement-breakpoint
-- Whether this token belonged to an account deleted since, and has not expired yet.
CREATE FUNCTION belay_token_ended(p_token_hash text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM ended_sessions WHERE token_hash = p_token_hash AND expires_at > now());
$$;
--> statement-breakpoint
-- A session is opened only for an account that still exists: a sign-in code issued just before
-- its account was deleted is then refused as a spent one, never a server error.
DROP FUNCTION belay_create_session(text, uuid, interval);
--> statement-breakpoint
CREATE FUNCTION belay_create_session(p_token_hash text, p_user_id uuid, p_ttl interval)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  DELETE FROM sessions WHERE expires_at <= now();
  DELETE FROM ended_sessions WHERE expires_at <= now();
  -- Held until commit: an erasure waits for this session and copies it, or ran first and left
  -- nothing to find.
  PERFORM 1 FROM users WHERE id = p_user_id FOR KEY SHARE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  INSERT INTO sessions (token_hash, user_id, expires_at)
    VALUES (p_token_hash, p_user_id, now() + p_ttl);
  RETURN true;
EXCEPTION WHEN foreign_key_violation THEN
  RETURN false;
END
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION belay_delete_account, belay_token_ended, belay_create_session FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION belay_delete_account, belay_token_ended, belay_create_session TO belay_app;
