import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const MAX_PAYLOAD_CHARS = 60_000;

// Remove anything that could carry personal or secret values out of the logs.
const SENSITIVE_KEY = /(token|key|secret|password|jwt|authorization|apikey|email|phone|cookie|candidate|address|ip)/i;

function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[depth-limit]';
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.length > 400 ? `${value.slice(0, 400)}…` : value;
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => sanitize(item, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY.test(k)) {
        out[k] = '[redacted]';
        continue;
      }
      out[k] = sanitize(v, depth + 1);
    }
    return out;
  }
  return undefined;
}

const SYSTEM_PROMPT = `You are a WebRTC reliability analyst for a video meeting product.
You receive a sanitised diagnostics bundle (event log entries, peer connection states, ICE/connection states, transceiver directions, track presence, renegotiation reasons, local media status).

Return a short report with these sections, in plain language a meeting host can act on:
1. Summary — one or two sentences on the overall health.
2. Likely causes — the most probable reasons for missing audio, missing video, or dropped participants, ranked, each with the evidence from the bundle that supports it.
3. Safe next steps — concrete, reversible troubleshooting steps the host or participant can take (permissions, device selection, network, reload, re-share). Never recommend disabling security features, sharing credentials, or editing system files.
4. Confidence — low / medium / high, with why.

If the bundle is too sparse to conclude anything, say so and name exactly which signal is missing. Never invent data that is not in the bundle. Keep the whole report under 350 words. Use markdown headings and bullets.`;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return json({ error: 'Unauthorized' }, 401);
  }
  const authClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: claims, error: authErr } = await authClient.auth.getClaims(
    authHeader.replace('Bearer ', ''),
  );
  if (authErr || !claims?.claims?.sub) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  if (!LOVABLE_API_KEY) {
    return json({ error: 'AI is not configured for this project.' }, 500);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const raw = body as { diagnostics?: unknown; entries?: unknown; note?: unknown } | null;
  if (!raw || typeof raw !== 'object' || (raw.diagnostics == null && raw.entries == null)) {
    return json({ error: 'diagnostics or entries is required' }, 400);
  }

  const bundle = {
    diagnostics: sanitize(raw.diagnostics ?? null),
    entries: sanitize(Array.isArray(raw.entries) ? raw.entries.slice(-250) : []),
    note: typeof raw.note === 'string' ? raw.note.slice(0, 500) : null,
  };

  let serialized = JSON.stringify(bundle);
  if (serialized.length > MAX_PAYLOAD_CHARS) {
    // Drop older events first, keep the structural diagnostics.
    const trimmed = {
      ...bundle,
      entries: Array.isArray(bundle.entries) ? bundle.entries.slice(-80) : [],
      truncated: true,
    };
    serialized = JSON.stringify(trimmed).slice(0, MAX_PAYLOAD_CHARS);
  }

  const initialRunId = req.headers.get('X-Lovable-AIG-Run-ID') ?? undefined;

  let response: Response;
  try {
    response = await fetch('https://ai.gateway.lovable.dev/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Lovable-API-Key': LOVABLE_API_KEY,
        'X-Lovable-AIG-SDK': 'fetch',
        ...(initialRunId ? { 'X-Lovable-AIG-Run-ID': initialRunId } : {}),
      },
      body: JSON.stringify({
        model: 'openai/gpt-6-astra',
        stream: true,
        instructions: SYSTEM_PROMPT,
        input: [
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: `Analyse this WebRTC diagnostics bundle and explain the likely connection failures.\n\n${serialized}`,
              },
            ],
          },
        ],
        reasoning: { effort: 'low', summary: 'auto' },
        include: ['reasoning.encrypted_content'],
        store: false,
        max_completion_tokens: 1600,
      }),
    });
  } catch (error) {
    console.error('AI gateway request failed', error);
    return json({ error: 'Could not reach the analysis service. Try again in a moment.' }, 502);
  }

  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => '');
    console.error('AI gateway error', response.status, detail);
    if (response.status === 429) {
      return json({ error: 'Too many analysis requests right now. Try again shortly.' }, 429);
    }
    if (response.status === 402) {
      return json({ error: 'AI credits are exhausted for this workspace.' }, 402);
    }
    if (response.status === 403) {
      return json({ error: 'The analysis model is not available for this workspace.' }, 403);
    }
    return json({ error: `Analysis failed (${response.status}).` }, 502);
  }

  // Consume the SSE stream server-side and return the final report.
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  let answer = '';
  let reasoning = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffered += decoder.decode(value, { stream: true });
      const lines = buffered.split('\n');
      buffered = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        try {
          const event = JSON.parse(data) as {
            type?: string;
            delta?: string;
            response?: { output_text?: string };
          };
          if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') {
            answer += event.delta;
          } else if (
            event.type === 'response.reasoning_summary_text.delta' &&
            typeof event.delta === 'string'
          ) {
            reasoning += event.delta;
          } else if (event.type === 'response.completed' && event.response?.output_text) {
            if (!answer) answer = event.response.output_text;
          }
        } catch {
          /* ignore malformed chunk */
        }
      }
    }
  } catch (error) {
    console.error('Stream read failed', error);
    if (!answer) {
      return json({ error: 'The analysis stream ended early. Try again.' }, 502);
    }
  }

  const report = answer.trim() || reasoning.trim();
  if (!report) {
    return json({ error: 'The model returned an empty report. Try again.' }, 502);
  }

  return json({
    report,
    reasoning: reasoning.trim() || null,
    analyzedAt: new Date().toISOString(),
  });
});
