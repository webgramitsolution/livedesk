
CREATE TABLE public.scheduled_meetings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  meeting_date DATE NOT NULL,
  meeting_time TEXT NOT NULL,
  duration TEXT NOT NULL DEFAULT '30 min',
  meeting_code TEXT NOT NULL,
  invitees TEXT[] DEFAULT '{}',
  recurrence TEXT DEFAULT 'none',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.scheduled_meetings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read scheduled meetings"
ON public.scheduled_meetings FOR SELECT TO anon, authenticated
USING (true);

CREATE POLICY "Anyone can insert scheduled meetings"
ON public.scheduled_meetings FOR INSERT TO anon, authenticated
WITH CHECK (true);

CREATE POLICY "Anyone can delete scheduled meetings"
ON public.scheduled_meetings FOR DELETE TO anon, authenticated
USING (true);
