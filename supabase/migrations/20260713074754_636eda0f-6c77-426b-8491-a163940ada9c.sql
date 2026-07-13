
-- Move SECURITY DEFINER helpers out of the public (API-exposed) schema
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

-- Helper: is meeting member (moved from public)
CREATE OR REPLACE FUNCTION private.is_meeting_member(_meeting_code text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.meeting_presence
    WHERE meeting_code = _meeting_code AND user_id = auth.uid()
  )
$$;
REVOKE ALL ON FUNCTION private.is_meeting_member(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.is_meeting_member(text) TO authenticated;

-- Helper: can_join_meeting — first joiner OR has approved join request
CREATE OR REPLACE FUNCTION private.can_join_meeting(_meeting_code text, _user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    NOT EXISTS (SELECT 1 FROM public.meeting_presence WHERE meeting_code = _meeting_code)
    OR EXISTS (
      SELECT 1 FROM public.meeting_join_requests
      WHERE meeting_code = _meeting_code
        AND requester_user_id = _user_id
        AND status = 'approved'
    )
$$;
REVOKE ALL ON FUNCTION private.can_join_meeting(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.can_join_meeting(text, uuid) TO authenticated;

-- Rebuild policies to reference private.is_meeting_member
DROP POLICY IF EXISTS "Meeting members can update join requests" ON public.meeting_join_requests;
DROP POLICY IF EXISTS "Requesters and members can view join requests" ON public.meeting_join_requests;
DROP POLICY IF EXISTS "Meeting members can view same meeting presence" ON public.meeting_presence;

CREATE POLICY "Meeting members can update join requests"
ON public.meeting_join_requests FOR UPDATE TO authenticated
USING (private.is_meeting_member(meeting_code))
WITH CHECK (private.is_meeting_member(meeting_code));

CREATE POLICY "Requesters and members can view join requests"
ON public.meeting_join_requests FOR SELECT TO authenticated
USING ((auth.uid() = requester_user_id) OR private.is_meeting_member(meeting_code));

CREATE POLICY "Meeting members can view same meeting presence"
ON public.meeting_presence FOR SELECT TO authenticated
USING ((auth.uid() = user_id) OR private.is_meeting_member(meeting_code));

-- Drop the now-unused public helper
DROP FUNCTION IF EXISTS public.is_meeting_member(text);

-- Harden presence INSERT to prevent self-granting membership
DROP POLICY IF EXISTS "Users can insert own meeting presence" ON public.meeting_presence;
CREATE POLICY "Users can insert own meeting presence"
ON public.meeting_presence FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND private.can_join_meeting(meeting_code, auth.uid())
);

-- Realtime authorization: restrict channel subscriptions to meeting members
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "meeting_members_can_read_realtime" ON realtime.messages;
CREATE POLICY "meeting_members_can_read_realtime"
ON realtime.messages FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.meeting_presence mp
    WHERE mp.user_id = auth.uid()
      AND realtime.topic() LIKE '%' || mp.meeting_code || '%'
  )
);

DROP POLICY IF EXISTS "meeting_members_can_write_realtime" ON realtime.messages;
CREATE POLICY "meeting_members_can_write_realtime"
ON realtime.messages FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.meeting_presence mp
    WHERE mp.user_id = auth.uid()
      AND realtime.topic() LIKE '%' || mp.meeting_code || '%'
  )
);
