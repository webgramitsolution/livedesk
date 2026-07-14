
DROP POLICY IF EXISTS "meeting_members_can_read_realtime" ON realtime.messages;
CREATE POLICY "meeting_members_can_read_realtime"
ON realtime.messages FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.meeting_presence mp
    WHERE mp.user_id = auth.uid()
      AND realtime.topic() IN (
        'webrtc-' || mp.meeting_code,
        'meeting-presence-' || mp.meeting_code,
        'join-requests-' || mp.meeting_code
      )
  )
);

DROP POLICY IF EXISTS "meeting_members_can_write_realtime" ON realtime.messages;
CREATE POLICY "meeting_members_can_write_realtime"
ON realtime.messages FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.meeting_presence mp
    WHERE mp.user_id = auth.uid()
      AND realtime.topic() IN (
        'webrtc-' || mp.meeting_code,
        'meeting-presence-' || mp.meeting_code,
        'join-requests-' || mp.meeting_code
      )
  )
);
