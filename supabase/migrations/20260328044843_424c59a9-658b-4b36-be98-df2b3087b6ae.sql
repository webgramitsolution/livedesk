
ALTER TABLE public.scheduled_meetings
ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

DROP POLICY IF EXISTS "Anyone can read scheduled meetings" ON public.scheduled_meetings;
DROP POLICY IF EXISTS "Anyone can insert scheduled meetings" ON public.scheduled_meetings;
DROP POLICY IF EXISTS "Anyone can delete scheduled meetings" ON public.scheduled_meetings;

CREATE POLICY "Users can read own meetings"
ON public.scheduled_meetings FOR SELECT TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own meetings"
ON public.scheduled_meetings FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own meetings"
ON public.scheduled_meetings FOR DELETE TO authenticated
USING (auth.uid() = user_id);
