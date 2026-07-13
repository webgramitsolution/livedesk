CREATE TABLE IF NOT EXISTS public.meeting_presence (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  meeting_code TEXT NOT NULL,
  user_id UUID NOT NULL,
  session_id TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  is_mic_on BOOLEAN NOT NULL DEFAULT true,
  is_camera_on BOOLEAN NOT NULL DEFAULT true,
  joined_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_meeting_presence_meeting_code ON public.meeting_presence(meeting_code);
CREATE INDEX IF NOT EXISTS idx_meeting_presence_user_id ON public.meeting_presence(user_id);
CREATE INDEX IF NOT EXISTS idx_meeting_presence_updated_at ON public.meeting_presence(updated_at DESC);

ALTER TABLE public.meeting_presence ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_meeting_member(_meeting_code TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.meeting_presence
    WHERE meeting_code = _meeting_code
      AND user_id = auth.uid()
  )
$$;

CREATE OR REPLACE FUNCTION public.set_meeting_presence_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_meeting_presence_updated_at ON public.meeting_presence;
CREATE TRIGGER trg_meeting_presence_updated_at
BEFORE UPDATE ON public.meeting_presence
FOR EACH ROW
EXECUTE FUNCTION public.set_meeting_presence_updated_at();

DROP POLICY IF EXISTS "Users can insert own meeting presence" ON public.meeting_presence;
CREATE POLICY "Users can insert own meeting presence"
ON public.meeting_presence
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own meeting presence" ON public.meeting_presence;
CREATE POLICY "Users can update own meeting presence"
ON public.meeting_presence
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own meeting presence" ON public.meeting_presence;
CREATE POLICY "Users can delete own meeting presence"
ON public.meeting_presence
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Meeting members can view same meeting presence" ON public.meeting_presence;
CREATE POLICY "Meeting members can view same meeting presence"
ON public.meeting_presence
FOR SELECT
TO authenticated
USING (auth.uid() = user_id OR public.is_meeting_member(meeting_code));

ALTER PUBLICATION supabase_realtime ADD TABLE public.meeting_presence;