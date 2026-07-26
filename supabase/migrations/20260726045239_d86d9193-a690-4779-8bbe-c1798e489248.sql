-- Helper: extract the meeting_code from a realtime topic like "webrtc-ABC123".
CREATE OR REPLACE FUNCTION private.meeting_code_from_topic(_topic text, _prefix text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = private, public
AS $$
  SELECT CASE
    WHEN _topic LIKE _prefix || '%' THEN substring(_topic FROM length(_prefix) + 1)
    ELSE NULL
  END
$$;

REVOKE ALL ON FUNCTION private.meeting_code_from_topic(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.meeting_code_from_topic(text, text) TO authenticated, service_role;

-- Helper: is the current auth.uid() authorized on this realtime topic?
CREATE OR REPLACE FUNCTION private.can_access_meeting_topic(_topic text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = private, public
AS $$
DECLARE
  code text;
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RETURN false;
  END IF;

  -- WebRTC signaling: members only
  code := private.meeting_code_from_topic(_topic, 'webrtc-');
  IF code IS NOT NULL THEN
    RETURN private.is_meeting_member(code);
  END IF;

  -- Presence sync: members only
  code := private.meeting_code_from_topic(_topic, 'meeting-presence-');
  IF code IS NOT NULL THEN
    RETURN private.is_meeting_member(code);
  END IF;

  -- Join-requests: members OR a user with an active pending request for this meeting
  code := private.meeting_code_from_topic(_topic, 'join-requests-');
  IF code IS NOT NULL THEN
    IF private.is_meeting_member(code) THEN
      RETURN true;
    END IF;
    RETURN EXISTS (
      SELECT 1
      FROM public.meeting_join_requests r
      WHERE r.meeting_code = code
        AND r.requester_user_id = uid
        AND r.expires_at > now()
    );
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION private.can_access_meeting_topic(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.can_access_meeting_topic(text) TO authenticated, service_role;

-- Replace the permissive LIKE-prefix policies with membership-scoped ones.
DROP POLICY IF EXISTS authenticated_can_read_meeting_channels ON realtime.messages;
DROP POLICY IF EXISTS authenticated_can_write_meeting_channels ON realtime.messages;

CREATE POLICY "meeting_members_can_read_channels"
ON realtime.messages
FOR SELECT
TO authenticated
USING (private.can_access_meeting_topic(realtime.topic()));

CREATE POLICY "meeting_members_can_write_channels"
ON realtime.messages
FOR INSERT
TO authenticated
WITH CHECK (private.can_access_meeting_topic(realtime.topic()));