import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const LANGUAGE_NAMES: Record<string, string> = {
  hi: 'Hindi', en: 'English', ta: 'Tamil', te: 'Telugu', bn: 'Bengali', mr: 'Marathi',
  gu: 'Gujarati', kn: 'Kannada', ml: 'Malayalam', pa: 'Punjabi', ar: 'Arabic', fr: 'French',
  es: 'Spanish', de: 'German', pt: 'Portuguese', ja: 'Japanese', zh: 'Chinese', ko: 'Korean',
};

const MAX_TEXT_LENGTH = 2000;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
  const authClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
  const { data: claims, error: authErr } = await authClient.auth.getClaims(authHeader.replace('Bearer ', ''));
  if (authErr || !claims?.claims?.sub) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  if (!LOVABLE_API_KEY) {
    return new Response(JSON.stringify({ error: 'Translation provider not configured' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const { text, targetLanguage, sourceLanguage } = await req.json();
    if (typeof text !== 'string' || !text.trim() || typeof targetLanguage !== 'string' || !LANGUAGE_NAMES[targetLanguage]) {
      return new Response(JSON.stringify({ error: 'text and a supported targetLanguage are required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const input = text.slice(0, MAX_TEXT_LENGTH);
    const targetName = LANGUAGE_NAMES[targetLanguage];
    const sourceName = typeof sourceLanguage === 'string' && LANGUAGE_NAMES[sourceLanguage] ? LANGUAGE_NAMES[sourceLanguage] : null;

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: [
          {
            role: 'system',
            content: `You are a real-time speech translation engine for a live meeting. Translate the user's utterance ${sourceName ? `from ${sourceName} ` : ''}to ${targetName}. Preserve meaning, tone and names. If the text is already in ${targetName}, return it unchanged. Return ONLY the translated text with no quotes, explanations or formatting.`,
          },
          { role: 'user', content: input },
        ],
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: 'Rate limited, please try again later.' }), {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: 'Translation credits exhausted.' }), {
          status: 402,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const t = await response.text();
      console.error('AI gateway error:', response.status, t);
      throw new Error(`AI gateway error [${response.status}]`);
    }

    const data = await response.json();
    const translatedText = data.choices?.[0]?.message?.content?.trim() || input;

    return new Response(JSON.stringify({ translatedText, detectedSourceLanguage: sourceLanguage ?? null }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Translation error:', error);
    return new Response(JSON.stringify({ error: 'Translation failed' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
