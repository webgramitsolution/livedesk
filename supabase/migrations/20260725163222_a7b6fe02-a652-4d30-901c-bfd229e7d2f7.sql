
-- Fix: joining a meeting via a shared link was blocked after the recent security migration.
-- Presence INSERT required a pre-approved join request, and realtime channel access required
-- the presence row to already exist. That combination made 2nd+ joiners invisible and prevented
-- WebRTC signaling.

-- Presence: any authenticated user can insert their own row for any meeting_code.
DROP POLICY IF EXISTS "Users can insert own meeting presence" ON public.meeting_presence;
CREATE POLICY "Users can insert own meeting presence"
ON public.meeting_presence FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

-- Realtime: allow any authenticated user to read/write on meeting-scoped channels.
-- Knowing the meeting code is the join credential; presence-first checks caused a
-- chicken-and-egg deadlock for WebRTC signaling.
DROP POLICY IF EXISTS "meeting_members_can_read_realtime" ON realtime.messages;
DROP POLICY IF EXISTS "meeting_members_can_write_realtime" ON realtime.messages;

CREATE POLICY "authenticated_can_read_meeting_channels"
ON realtime.messages FOR SELECT TO authenticated
USING (
  realtime.topic() LIKE 'webrtc-%'
  OR realtime.topic() LIKE 'meeting-presence-%'
  OR realtime.topic() LIKE 'join-requests-%'
);

CREATE POLICY "authenticated_can_write_meeting_channels"
ON realtime.messages FOR INSERT TO authenticated
WITH CHECK (
  realtime.topic() LIKE 'webrtc-%'
  OR realtime.topic() LIKE 'meeting-presence-%'
  OR realtime.topic() LIKE 'join-requests-%'
);
