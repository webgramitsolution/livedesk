import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listScheduledMeetings from "./tools/list-scheduled-meetings";
import createScheduledMeeting from "./tools/create-scheduled-meeting";
import listActiveMeetingParticipants from "./tools/list-active-meetings";

// Read the Supabase project ref from the Vite-inlined env so the entry stays
// import-safe (no runtime env reads at module top level). The fallback keeps
// the issuer well-formed during the throwaway manifest-extract eval.
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "zoom-connect-mcp",
  title: "Zoom Connect",
  version: "0.1.0",
  instructions:
    "Tools for Zoom Connect. Use `list_scheduled_meetings` to see the signed-in user's upcoming meetings, `create_scheduled_meeting` to schedule one, and `list_active_meeting_participants` to see who is currently in a meeting.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listScheduledMeetings, createScheduledMeeting, listActiveMeetingParticipants],
});