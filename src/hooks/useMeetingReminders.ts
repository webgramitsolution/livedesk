import { useEffect } from 'react';
import { differenceInMinutes, parseISO } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

const REMINDER_WINDOW_MINUTES = 5;
const CHECK_INTERVAL_MS = 60_000;

interface ScheduledMeetingReminder {
  id: string;
  title: string;
  meeting_date: string;
  meeting_time: string;
  meeting_code: string;
}

const getMeetingStart = (meeting: ScheduledMeetingReminder) => {
  const iso = `${meeting.meeting_date}T${meeting.meeting_time}:00`;
  return new Date(iso);
};

export function useMeetingReminders(enabled: boolean) {
  useEffect(() => {
    if (!enabled || typeof window === 'undefined' || !('Notification' in window)) return;

    let cancelled = false;

    const requestPermission = async () => {
      if (Notification.permission === 'default') {
        try {
          await Notification.requestPermission();
        } catch {
          toast.error('Browser notifications are blocked on this device');
        }
      }
    };

    const checkMeetings = async () => {
      if (cancelled || Notification.permission !== 'granted') return;

      const { data } = await supabase
        .from('scheduled_meetings')
        .select('id,title,meeting_date,meeting_time,meeting_code')
        .order('meeting_date', { ascending: true });

      const meetings = (data ?? []) as ScheduledMeetingReminder[];

      meetings.forEach((meeting) => {
        const start = getMeetingStart(meeting);
        const minutesLeft = differenceInMinutes(start, new Date());
        const reminderKey = `meeting-reminder:${meeting.id}:${minutesLeft}`;

        if (minutesLeft >= 0 && minutesLeft <= REMINDER_WINDOW_MINUTES && !localStorage.getItem(reminderKey)) {
          new Notification(`Upcoming: ${meeting.title}`, {
            body: `Starts in ${minutesLeft === 0 ? 'less than a minute' : `${minutesLeft} minute${minutesLeft === 1 ? '' : 's'}`}. Meeting code: ${meeting.meeting_code}`,
            tag: `meeting-${meeting.id}`,
          });
          localStorage.setItem(reminderKey, 'sent');
          toast.success(`Reminder sent for ${meeting.title}`);
        }
      });
    };

    requestPermission().then(checkMeetings);
    const intervalId = window.setInterval(checkMeetings, CHECK_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [enabled]);
}
