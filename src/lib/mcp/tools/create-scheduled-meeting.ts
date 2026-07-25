import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";

function supabaseForUser(ctx: ToolContext) {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function generateMeetingCode() {
  const part = () => Math.random().toString(36).slice(2, 6);
  return `${part()}-${part()}-${part()}`;
}

export default defineTool({
  name: "create_scheduled_meeting",
  title: "Schedule a meeting",
  description: "Create a new scheduled Zoom Connect meeting for the signed-in user.",
  inputSchema: {
    title: z.string().trim().min(1).describe("Meeting title."),
    meeting_date: z.string().describe("Meeting date in YYYY-MM-DD format."),
    meeting_time: z.string().describe("Meeting time in HH:MM (24h) format."),
    duration: z.string().optional().describe("Duration label, e.g. '30 min', '1 hour'."),
    recurrence: z.string().optional().describe("Recurrence rule label, e.g. 'weekly'."),
    invitees: z.array(z.string()).optional().describe("Invitee emails."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  handler: async (input, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const { data, error } = await supabaseForUser(ctx)
      .from("scheduled_meetings")
      .insert({
        user_id: ctx.getUserId(),
        title: input.title,
        meeting_code: generateMeetingCode(),
        meeting_date: input.meeting_date,
        meeting_time: input.meeting_time,
        duration: input.duration ?? "30 min",
        recurrence: input.recurrence ?? null,
        invitees: input.invitees ?? null,
      })
      .select()
      .single();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: `Scheduled meeting created with code ${data.meeting_code}.` }],
      structuredContent: { meeting: data },
    };
  },
});