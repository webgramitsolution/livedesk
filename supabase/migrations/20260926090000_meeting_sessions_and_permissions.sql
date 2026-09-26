-- LiveDesk meeting session model: host authority, per-participant permissions,
-- remote-control sessions. All rows are ephemeral: they are deleted when the
-- meeting ends (see end_meeting) so no meeting archive is built.

-- ---------------------------------------------------------------------------
-- meetings: one row per live meeting. The host is the user who created it
-- (first participant to claim it). Global toggles live here.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.meetings (
  meeting_code TEXT PRIMARY KEY,
  host_user_id UUID NOT NULL,
  host_session_id TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),
  annotation_enabled BOOLEAN NOT NULL DEFAULT true,
  remote_control_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_meetings_host ON public.meetings (host_user_id);
CREATE INDEX IF NOT EXISTS idx_meetings_status_ended ON public.meetings (status, ended_at);

ALTER TABLE public.meetings ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- meeting_participant_permissions: explicit permission state per participant
-- session. Missing row means defaults (see private.default_permission()).
-- Only the host writes (through RPCs); members read.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.meeting_participant_permissions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  meeting_code TEXT NOT NULL REFERENCES public.meetings (meeting_code) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  user_id UUID,
  can_speak BOOLEAN NOT NULL DEFAULT true,
  can_use_camera BOOLEAN NOT NULL DEFAULT true,
  can_share_screen BOOLEAN NOT NULL DEFAULT true,
  can_annotate BOOLEAN NOT NULL DEFAULT false,
  can_request_remote_control BOOLEAN NOT NULL DEFAULT true,
  remote_control_granted BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (meeting_code, session_id)
);

CREATE INDEX IF NOT EXISTS idx_participant_permissions_meeting ON public.meeting_participant_permissions (meeting_code);

ALTER TABLE public.meeting_participant_permissions ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- remote_control_sessions: every grant of OS-level control is recorded with a
-- token. The presenter only executes input carrying an active token it issued.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.remote_control_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  meeting_code TEXT NOT NULL REFERENCES public.meetings (meeting_code) ON DELETE CASCADE,
  presenter_session_id TEXT NOT NULL,
  presenter_user_id UUID NOT NULL,
  controller_session_id TEXT NOT NULL,
  controller_user_id UUID,
  token TEXT NOT NULL UNIQUE,
  mode TEXT NOT NULL CHECK (mode IN ('mouse', 'mouse+keyboard')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'expired')),
  granted_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '2 hours'),
  revoked_at TIMESTAMPTZ,
  revoke_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_rc_sessions_meeting_status ON public.remote_control_sessions (meeting_code, status);
CREATE INDEX IF NOT EXISTS idx_rc_sessions_controller ON public.remote_control_sessions (controller_session_id, status);

ALTER TABLE public.remote_control_sessions ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_meetings_updated_at ON public.meetings;
CREATE TRIGGER trg_meetings_updated_at
BEFORE UPDATE ON public.meetings
FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();

DROP TRIGGER IF EXISTS trg_participant_permissions_updated_at ON public.meeting_participant_permissions;
CREATE TRIGGER trg_participant_permissions_updated_at
BEFORE UPDATE ON public.meeting_participant_permissions
FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.is_meeting_host(_meeting_code TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.meetings
    WHERE meeting_code = _meeting_code
      AND host_user_id = auth.uid()
      AND status = 'active'
  )
$$;
REVOKE ALL ON FUNCTION private.is_meeting_host(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.is_meeting_host(TEXT) TO authenticated, service_role;

-- The caller owns this presence session (used for presenter-side grants).
CREATE OR REPLACE FUNCTION private.owns_session(_meeting_code TEXT, _session_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.meeting_presence
    WHERE meeting_code = _meeting_code
      AND session_id = _session_id
      AND user_id = auth.uid()
  )
$$;
REVOKE ALL ON FUNCTION private.owns_session(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.owns_session(TEXT, TEXT) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RLS policies (reads). All writes go through the SECURITY DEFINER RPCs below.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "members_can_read_meeting" ON public.meetings;
CREATE POLICY "members_can_read_meeting"
ON public.meetings FOR SELECT TO authenticated
USING (host_user_id = auth.uid() OR private.is_meeting_member(meeting_code));

DROP POLICY IF EXISTS "members_can_read_permissions" ON public.meeting_participant_permissions;
CREATE POLICY "members_can_read_permissions"
ON public.meeting_participant_permissions FOR SELECT TO authenticated
USING (private.is_meeting_member(meeting_code));

DROP POLICY IF EXISTS "parties_can_read_rc_sessions" ON public.remote_control_sessions;
CREATE POLICY "parties_can_read_rc_sessions"
ON public.remote_control_sessions FOR SELECT TO authenticated
USING (
  presenter_user_id = auth.uid()
  OR controller_user_id = auth.uid()
  OR private.is_meeting_host(meeting_code)
);

-- ---------------------------------------------------------------------------
-- RPC: claim_meeting_host. Creates the meeting row if it does not exist and
-- returns it. The first caller becomes the host; later callers only read.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_meeting_host(_meeting_code TEXT, _session_id TEXT)
RETURNS public.meetings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  uid UUID := auth.uid();
  row public.meetings;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF _meeting_code IS NULL OR length(_meeting_code) < 4 OR length(_meeting_code) > 64 THEN
    RAISE EXCEPTION 'invalid meeting code' USING ERRCODE = '22023';
  END IF;

  -- Re-claim of an ended meeting starts a fresh session with the same code.
  DELETE FROM public.meetings
  WHERE meeting_code = _meeting_code AND status = 'ended';

  INSERT INTO public.meetings (meeting_code, host_user_id, host_session_id)
  VALUES (_meeting_code, uid, _session_id)
  ON CONFLICT (meeting_code) DO NOTHING;

  SELECT * INTO row FROM public.meetings WHERE meeting_code = _meeting_code;

  -- Host reconnecting with a new session id keeps host authority.
  IF row.host_user_id = uid AND row.host_session_id IS DISTINCT FROM _session_id THEN
    UPDATE public.meetings SET host_session_id = _session_id WHERE meeting_code = _meeting_code
    RETURNING * INTO row;
  END IF;

  RETURN row;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_meeting_host(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_meeting_host(TEXT, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- RPC: set_participant_permission (host only). Upserts a permission row from a
-- JSON patch with whitelisted keys.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_participant_permission(_meeting_code TEXT, _session_id TEXT, _patch JSONB)
RETURNS public.meeting_participant_permissions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  row public.meeting_participant_permissions;
  target_user UUID;
BEGIN
  IF NOT private.is_meeting_host(_meeting_code) THEN
    RAISE EXCEPTION 'only the host can change permissions' USING ERRCODE = '42501';
  END IF;

  SELECT user_id INTO target_user FROM public.meeting_presence
  WHERE meeting_code = _meeting_code AND session_id = _session_id
  LIMIT 1;

  INSERT INTO public.meeting_participant_permissions (meeting_code, session_id, user_id)
  VALUES (_meeting_code, _session_id, target_user)
  ON CONFLICT (meeting_code, session_id) DO NOTHING;

  UPDATE public.meeting_participant_permissions p SET
    can_speak = COALESCE((_patch->>'can_speak')::BOOLEAN, p.can_speak),
    can_use_camera = COALESCE((_patch->>'can_use_camera')::BOOLEAN, p.can_use_camera),
    can_share_screen = COALESCE((_patch->>'can_share_screen')::BOOLEAN, p.can_share_screen),
    can_annotate = COALESCE((_patch->>'can_annotate')::BOOLEAN, p.can_annotate),
    can_request_remote_control = COALESCE((_patch->>'can_request_remote_control')::BOOLEAN, p.can_request_remote_control),
    user_id = COALESCE(p.user_id, target_user)
  WHERE p.meeting_code = _meeting_code AND p.session_id = _session_id
  RETURNING * INTO row;

  -- Removing the right to request control also ends any active grant.
  IF (_patch->>'can_request_remote_control')::BOOLEAN IS FALSE THEN
    PERFORM public.revoke_remote_control(_meeting_code, _session_id, 'Host disabled remote control for this participant');
  END IF;

  RETURN row;
END;
$$;
REVOKE ALL ON FUNCTION public.set_participant_permission(TEXT, TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_participant_permission(TEXT, TEXT, JSONB) TO authenticated;

-- ---------------------------------------------------------------------------
-- RPC: set_all_participant_permissions (host only). Applies a patch to every
-- current participant except the host.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_all_participant_permissions(_meeting_code TEXT, _patch JSONB)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  r RECORD;
  n INTEGER := 0;
  host_uid UUID;
BEGIN
  IF NOT private.is_meeting_host(_meeting_code) THEN
    RAISE EXCEPTION 'only the host can change permissions' USING ERRCODE = '42501';
  END IF;
  SELECT host_user_id INTO host_uid FROM public.meetings WHERE meeting_code = _meeting_code;
  FOR r IN SELECT session_id FROM public.meeting_presence WHERE meeting_code = _meeting_code AND user_id <> host_uid LOOP
    PERFORM public.set_participant_permission(_meeting_code, r.session_id, _patch);
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.set_all_participant_permissions(TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_all_participant_permissions(TEXT, JSONB) TO authenticated;

-- ---------------------------------------------------------------------------
-- RPC: set_meeting_controls (host only). Global toggles.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_meeting_controls(_meeting_code TEXT, _patch JSONB)
RETURNS public.meetings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  row public.meetings;
BEGIN
  IF NOT private.is_meeting_host(_meeting_code) THEN
    RAISE EXCEPTION 'only the host can change meeting controls' USING ERRCODE = '42501';
  END IF;
  UPDATE public.meetings m SET
    annotation_enabled = COALESCE((_patch->>'annotation_enabled')::BOOLEAN, m.annotation_enabled),
    remote_control_enabled = COALESCE((_patch->>'remote_control_enabled')::BOOLEAN, m.remote_control_enabled)
  WHERE m.meeting_code = _meeting_code
  RETURNING * INTO row;

  IF (_patch->>'remote_control_enabled')::BOOLEAN IS FALSE THEN
    UPDATE public.remote_control_sessions
    SET status = 'revoked', revoked_at = now(), revoke_reason = 'Host disabled remote control'
    WHERE meeting_code = _meeting_code AND status = 'active';
    UPDATE public.meeting_participant_permissions
    SET remote_control_granted = false
    WHERE meeting_code = _meeting_code AND remote_control_granted;
  END IF;
  RETURN row;
END;
$$;
REVOKE ALL ON FUNCTION public.set_meeting_controls(TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_meeting_controls(TEXT, JSONB) TO authenticated;

-- ---------------------------------------------------------------------------
-- RPC: grant_remote_control. The presenter (owner of _presenter_session_id)
-- issues a control token to a controller. Server checks: meeting active,
-- remote control globally enabled, controller allowed to request control,
-- caller owns the presenter session (or is the host).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.grant_remote_control(
  _meeting_code TEXT,
  _presenter_session_id TEXT,
  _controller_session_id TEXT,
  _mode TEXT
)
RETURNS public.remote_control_sessions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  uid UUID := auth.uid();
  m public.meetings;
  controller_uid UUID;
  allowed BOOLEAN;
  row public.remote_control_sessions;
  new_token TEXT;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO m FROM public.meetings WHERE meeting_code = _meeting_code AND status = 'active';
  IF m IS NULL THEN
    RAISE EXCEPTION 'meeting is not active' USING ERRCODE = '22023';
  END IF;
  IF NOT m.remote_control_enabled THEN
    RAISE EXCEPTION 'remote control is disabled for this meeting' USING ERRCODE = '42501';
  END IF;
  IF NOT (private.owns_session(_meeting_code, _presenter_session_id) OR m.host_user_id = uid) THEN
    RAISE EXCEPTION 'only the presenter or host can grant control' USING ERRCODE = '42501';
  END IF;
  IF _mode NOT IN ('mouse', 'mouse+keyboard') THEN
    RAISE EXCEPTION 'invalid mode' USING ERRCODE = '22023';
  END IF;
  IF _presenter_session_id = _controller_session_id THEN
    RAISE EXCEPTION 'cannot grant control to the presenter' USING ERRCODE = '22023';
  END IF;

  SELECT user_id INTO controller_uid FROM public.meeting_presence
  WHERE meeting_code = _meeting_code AND session_id = _controller_session_id LIMIT 1;
  IF controller_uid IS NULL THEN
    RAISE EXCEPTION 'controller is not in the meeting' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(p.can_request_remote_control, true) INTO allowed
  FROM (SELECT 1) AS one
  LEFT JOIN public.meeting_participant_permissions p
    ON p.meeting_code = _meeting_code AND p.session_id = _controller_session_id;
  IF NOT COALESCE(allowed, true) THEN
    RAISE EXCEPTION 'participant is not allowed to request remote control' USING ERRCODE = '42501';
  END IF;

  -- One controller per presenter at a time.
  UPDATE public.remote_control_sessions
  SET status = 'revoked', revoked_at = now(), revoke_reason = 'Replaced by a new grant'
  WHERE meeting_code = _meeting_code AND presenter_session_id = _presenter_session_id AND status = 'active';

  new_token := encode(gen_random_bytes(24), 'hex');
  INSERT INTO public.remote_control_sessions (
    meeting_code, presenter_session_id, presenter_user_id, controller_session_id, controller_user_id, token, mode, granted_by
  ) VALUES (
    _meeting_code, _presenter_session_id, uid, _controller_session_id, controller_uid, new_token, _mode, uid
  ) RETURNING * INTO row;

  INSERT INTO public.meeting_participant_permissions (meeting_code, session_id, user_id, remote_control_granted)
  VALUES (_meeting_code, _controller_session_id, controller_uid, true)
  ON CONFLICT (meeting_code, session_id) DO UPDATE SET remote_control_granted = true;

  RETURN row;
END;
$$;
REVOKE ALL ON FUNCTION public.grant_remote_control(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grant_remote_control(TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- RPC: revoke_remote_control. Host, presenter, or the controller itself may end
-- every active session for a controller session id.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.revoke_remote_control(_meeting_code TEXT, _controller_session_id TEXT, _reason TEXT DEFAULT NULL)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  uid UUID := auth.uid();
  n INTEGER := 0;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  UPDATE public.remote_control_sessions s
  SET status = 'revoked', revoked_at = now(), revoke_reason = COALESCE(_reason, 'Revoked')
  WHERE s.meeting_code = _meeting_code
    AND s.controller_session_id = _controller_session_id
    AND s.status = 'active'
    AND (s.presenter_user_id = uid OR s.controller_user_id = uid OR private.is_meeting_host(_meeting_code));
  GET DIAGNOSTICS n = ROW_COUNT;

  UPDATE public.meeting_participant_permissions
  SET remote_control_granted = false
  WHERE meeting_code = _meeting_code AND session_id = _controller_session_id AND remote_control_granted;

  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.revoke_remote_control(TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_remote_control(TEXT, TEXT, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- RPC: verify_remote_control_token. Presenter-side check that a token it
-- received input for is still active. Returns the active row or NULL.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.verify_remote_control_token(_meeting_code TEXT, _token TEXT)
RETURNS public.remote_control_sessions
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT s.* FROM public.remote_control_sessions s
  WHERE s.meeting_code = _meeting_code
    AND s.token = _token
    AND s.status = 'active'
    AND s.expires_at > now()
    AND (s.presenter_user_id = auth.uid() OR s.controller_user_id = auth.uid())
  LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.verify_remote_control_token(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_remote_control_token(TEXT, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- RPC: remove_participant (host only). Deletes presence + permissions and
-- revokes control. The removed client observes its presence row vanish.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.remove_participant(_meeting_code TEXT, _session_id TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT private.is_meeting_host(_meeting_code) THEN
    RAISE EXCEPTION 'only the host can remove participants' USING ERRCODE = '42501';
  END IF;
  PERFORM public.revoke_remote_control(_meeting_code, _session_id, 'Participant removed by host');
  UPDATE public.remote_control_sessions
  SET status = 'revoked', revoked_at = now(), revoke_reason = 'Presenter removed by host'
  WHERE meeting_code = _meeting_code AND presenter_session_id = _session_id AND status = 'active';
  DELETE FROM public.meeting_participant_permissions WHERE meeting_code = _meeting_code AND session_id = _session_id;
  DELETE FROM public.meeting_presence WHERE meeting_code = _meeting_code AND session_id = _session_id;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.remove_participant(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_participant(TEXT, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- RPC: end_meeting (host only). Marks the meeting ended and clears all
-- temporary session state. Clients observe status = 'ended' and leave.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.end_meeting(_meeting_code TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT private.is_meeting_host(_meeting_code) THEN
    RAISE EXCEPTION 'only the host can end the meeting' USING ERRCODE = '42501';
  END IF;
  UPDATE public.remote_control_sessions
  SET status = 'revoked', revoked_at = now(), revoke_reason = 'Meeting ended'
  WHERE meeting_code = _meeting_code AND status = 'active';
  DELETE FROM public.meeting_participant_permissions WHERE meeting_code = _meeting_code;
  DELETE FROM public.meeting_join_requests WHERE meeting_code = _meeting_code;
  UPDATE public.meetings SET status = 'ended', ended_at = now() WHERE meeting_code = _meeting_code;
  DELETE FROM public.meeting_presence WHERE meeting_code = _meeting_code;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.end_meeting(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.end_meeting(TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- Participant leaving: revoke any control session they hold or grant. Runs as
-- a trigger on presence delete so a crash/close also revokes.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.on_presence_deleted()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE public.remote_control_sessions
  SET status = 'revoked', revoked_at = now(), revoke_reason = 'Participant left'
  WHERE meeting_code = OLD.meeting_code
    AND status = 'active'
    AND (controller_session_id = OLD.session_id OR presenter_session_id = OLD.session_id);
  DELETE FROM public.meeting_participant_permissions
  WHERE meeting_code = OLD.meeting_code AND session_id = OLD.session_id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_presence_deleted ON public.meeting_presence;
CREATE TRIGGER trg_presence_deleted
AFTER DELETE ON public.meeting_presence
FOR EACH ROW EXECUTE FUNCTION private.on_presence_deleted();

-- Ended meetings are removed after a grace period (no archive is kept).
CREATE OR REPLACE FUNCTION public.cleanup_ended_meetings()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE n INTEGER := 0;
BEGIN
  DELETE FROM public.meetings WHERE status = 'ended' AND ended_at < now() - interval '1 hour';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.cleanup_ended_meetings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cleanup_ended_meetings() TO authenticated, service_role;

-- Only the host may admit or deny join requests from now on.
DROP POLICY IF EXISTS "Meeting members can update join requests" ON public.meeting_join_requests;
CREATE POLICY "Host can update join requests"
ON public.meeting_join_requests FOR UPDATE TO authenticated
USING (private.is_meeting_host(meeting_code))
WITH CHECK (private.is_meeting_host(meeting_code));

-- Realtime: clients subscribe to changes on these tables.
ALTER PUBLICATION supabase_realtime ADD TABLE public.meetings;
ALTER PUBLICATION supabase_realtime ADD TABLE public.meeting_participant_permissions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.remote_control_sessions;
