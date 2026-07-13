ALTER TABLE public.meeting_join_requests
ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

UPDATE public.meeting_join_requests
SET expires_at = COALESCE(expires_at, created_at + interval '5 minutes')
WHERE expires_at IS NULL;

ALTER TABLE public.meeting_join_requests
ALTER COLUMN expires_at SET DEFAULT (now() + interval '5 minutes');

ALTER TABLE public.meeting_join_requests
ALTER COLUMN expires_at SET NOT NULL;

CREATE OR REPLACE FUNCTION public.cleanup_expired_meeting_join_requests(
  _meeting_code text DEFAULT NULL,
  _requester_user_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _deleted_count integer := 0;
BEGIN
  DELETE FROM public.meeting_join_requests
  WHERE status = 'pending'
    AND expires_at <= now()
    AND (_meeting_code IS NULL OR meeting_code = _meeting_code)
    AND (_requester_user_id IS NULL OR requester_user_id = _requester_user_id);

  GET DIAGNOSTICS _deleted_count = ROW_COUNT;
  RETURN _deleted_count;
END;
$$;