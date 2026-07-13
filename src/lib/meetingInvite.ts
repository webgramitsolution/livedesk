const PENDING_MEETING_CODE_KEY = 'pending-meeting-code';

export function extractMeetingCodeFromInput(value: string | null | undefined) {
  if (!value) return null;

  let code = value.trim();
  if (!code) return null;

  try {
    const parsed = new URL(code);
    code = parsed.searchParams.get('meeting') || code;
  } catch {
    const match = code.match(/[?&]meeting=([^&]+)/);
    if (match?.[1]) {
      code = match[1];
    }
  }

  try {
    return decodeURIComponent(code);
  } catch {
    return code;
  }
}

export function buildMeetingLink(meetingCode: string) {
  const encodedCode = encodeURIComponent(meetingCode);
  return typeof window === 'undefined'
    ? `/?meeting=${encodedCode}`
    : `${window.location.origin}?meeting=${encodedCode}`;
}

export function storePendingMeetingCode(meetingCode: string) {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(PENDING_MEETING_CODE_KEY, meetingCode);
  window.localStorage.setItem(PENDING_MEETING_CODE_KEY, meetingCode);
}

export function getPendingMeetingCode() {
  if (typeof window === 'undefined') return null;

  const storedCode = window.sessionStorage.getItem(PENDING_MEETING_CODE_KEY)
    || window.localStorage.getItem(PENDING_MEETING_CODE_KEY);

  return extractMeetingCodeFromInput(storedCode);
}

export function clearPendingMeetingCode() {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(PENDING_MEETING_CODE_KEY);
  window.localStorage.removeItem(PENDING_MEETING_CODE_KEY);
}