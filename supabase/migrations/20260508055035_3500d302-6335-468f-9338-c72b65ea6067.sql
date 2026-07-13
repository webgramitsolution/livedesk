CREATE TABLE public.meeting_join_requests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  meeting_code TEXT NOT NULL,
  requester_user_id UUID NOT NULL,
  requester_session_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ
);

CREATE INDEX idx_join_requests_meeting ON public.meeting_join_requests (meeting_code, status);
CREATE INDEX idx_join_requests_requester ON public.meeting_join_requests (requester_user_id);

ALTER TABLE public.meeting_join_requests ENABLE ROW LEVEL SECURITY;

-- Requester can create their own request
CREATE POLICY "Requesters can insert own join request"
ON public.meeting_join_requests
FOR INSERT TO authenticated
WITH CHECK (auth.uid() = requester_user_id);

-- Requester can view own request; meeting members can view all requests for that meeting
CREATE POLICY "Requesters and members can view join requests"
ON public.meeting_join_requests
FOR SELECT TO authenticated
USING (
  auth.uid() = requester_user_id
  OR public.is_meeting_member(meeting_code)
);

-- Requester can cancel (delete) own pending request
CREATE POLICY "Requesters can delete own join request"
ON public.meeting_join_requests
FOR DELETE TO authenticated
USING (auth.uid() = requester_user_id);

-- Meeting members (host) can update status to approve/deny
CREATE POLICY "Meeting members can update join requests"
ON public.meeting_join_requests
FOR UPDATE TO authenticated
USING (public.is_meeting_member(meeting_code))
WITH CHECK (public.is_meeting_member(meeting_code));

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.meeting_join_requests;