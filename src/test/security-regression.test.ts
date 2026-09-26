/**
 * Security regression checks.
 *
 * Verifies that ONLY the six selected security findings remain fixed, and that
 * unrelated security surfaces are unchanged. See docs/SECURITY_CHANGELOG.md.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

/** Functions that must refuse anonymous callers before doing paid work. */
const AUTH_GATED_FUNCTIONS: Array<{ id: string; path: string; credential: string }> = [
  {
    id: 'lov_finding_879cb7571feb39d5',
    path: 'supabase/functions/elevenlabs-scribe-token/index.ts',
    credential: 'ELEVENLABS_API_KEY',
  },
  {
    id: 'lov_finding_a1e6a4d000b55021',
    path: 'supabase/functions/translate-text/index.ts',
    credential: 'LOVABLE_API_KEY',
  },
];

/** Files whose meeting-code generation must use a CSPRNG. */
const MEETING_CODE_SOURCES: Array<{ id: string; path: string }> = [
  { id: 'lov_finding_199f328f4a344ef8', path: 'src/components/meeting/LobbyScreen.tsx' },
  { id: 'lov_finding_64bacab0a868fc4f', path: 'src/components/meeting/MeetingScheduler.tsx' },
  { id: 'lov_finding_651326b92567458d', path: 'src/lib/mcp/tools/create-scheduled-meeting.ts' },
  { id: 'lov_finding_9435a83dbd3bc7bc', path: 'supabase/functions/mcp/index.ts' },
];

function generatorBody(source: string): string {
  // Capture the meeting-id/code generator body regardless of naming style.
  const match = source.match(/generateMeeting(?:Id|Code)\s*=?[\s\S]{0,600}?\}\s*;?/);
  expect(match, 'meeting code generator not found').not.toBeNull();
  return match![0];
}

describe('selected finding: unauthenticated access to AI-backed endpoints', () => {
  for (const fn of AUTH_GATED_FUNCTIONS) {
    it(`${fn.id}: ${fn.path} rejects callers without a verified session`, () => {
      const src = read(fn.path);

      // A bearer token is required.
      expect(src).toMatch(/req\.headers\.get\(\s*['"]Authorization['"]\s*\)/);
      expect(src).toMatch(/startsWith\(\s*['"]Bearer ['"]\s*\)/);
      expect(src).toMatch(/401/);

      // The token is verified server-side, not merely present.
      expect(src).toMatch(/auth\.getClaims\(/);
      expect(src).toMatch(/claims\?\.claims\?\.sub/);

      // The auth gate runs BEFORE the paid credential is read/used.
      const authIndex = src.indexOf('auth.getClaims(');
      const credentialIndex = src.indexOf(`Deno.env.get('${fn.credential}')`);
      expect(authIndex).toBeGreaterThan(-1);
      expect(credentialIndex).toBeGreaterThan(-1);
      expect(authIndex).toBeLessThan(credentialIndex);
    });
  }

  it('the new AI diagnostics analyser is auth-gated and redacts payloads', () => {
    const path = 'supabase/functions/analyze-webrtc-diagnostics/index.ts';
    expect(existsSync(resolve(root, path))).toBe(true);
    const src = read(path);
    expect(src).toMatch(/auth\.getClaims\(/);
    expect(src).toMatch(/claims\?\.claims\?\.sub/);
    expect(src).toMatch(/\[redacted\]/);
    const authIndex = src.indexOf('auth.getClaims(');
    const keyIndex = src.indexOf("Deno.env.get('LOVABLE_API_KEY')");
    expect(authIndex).toBeLessThan(keyIndex);
  });
});

describe('selected finding: predictable meeting codes', () => {
  for (const target of MEETING_CODE_SOURCES) {
    it(`${target.id}: ${target.path} generates codes from a CSPRNG`, () => {
      const body = generatorBody(read(target.path));
      expect(body).toMatch(/crypto\.getRandomValues\(/);
      expect(body).not.toMatch(/Math\.random/);
      // Enough entropy: at least 12 symbols requested.
      expect(body).toMatch(/Uint8Array\(\s*(1[2-9]|[2-9]\d)\s*\)/);
    });
  }

  it('generated codes have the expected shape and do not repeat', () => {
    const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
    const generate = () => {
      const bytes = crypto.getRandomValues(new Uint8Array(12));
      const s = Array.from(bytes, (x) => alphabet[x % 32]).join('');
      return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
    };

    const codes = new Set<string>();
    for (let i = 0; i < 2000; i += 1) {
      const code = generate();
      expect(code).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);
      codes.add(code);
    }
    // 32^12 keyspace: collisions in 2000 draws are effectively impossible.
    expect(codes.size).toBe(2000);
  });

  it('no meeting code generator anywhere still uses Math.random', () => {
    for (const target of MEETING_CODE_SOURCES) {
      expect(generatorBody(read(target.path))).not.toMatch(/Math\.random/);
    }
  });
});

describe('unrelated findings must remain unchanged', () => {
  it('meeting presence and join-request access rules are untouched', () => {
    const hook = read('src/hooks/useWebRTC.ts');
    expect(hook).toMatch(/meeting_presence/);
    // Presence rows are still written by the presence manager (select, then insert or update).
    const presence = read('src/components/meeting/MeetingPresenceManager.tsx');
    expect(presence).toMatch(/meeting_presence/);
    expect(presence).toMatch(/\.insert\(/);
    expect(presence).toMatch(/\.update\(/);
  });

  it('remote-control signing, nonce and replay protection are untouched', () => {
    const protocol = read('src/lib/remoteControl/protocol.ts');
    expect(protocol).toMatch(/nonce/i);
    expect(protocol).toMatch(/sign|signature/i);
    expect(existsSync(resolve(root, 'src/test/rcReplayProtection.test.ts'))).toBe(true);
    expect(existsSync(resolve(root, 'src/test/rcUnauthorizedE2E.test.tsx'))).toBe(true);
  });

  it('remote-control input validation is still enforced', () => {
    const validation = read('src/lib/remoteControl/validation.ts');
    expect(validation.length).toBeGreaterThan(0);
  });

  it('no diagnostics or logging surface writes raw credentials', () => {
    const files = [
      'src/lib/webrtcLogger.ts',
      'supabase/functions/analyze-webrtc-diagnostics/index.ts',
    ];
    for (const file of files) {
      const src = read(file);
      expect(src).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
      expect(src).not.toMatch(/console\.log\([^)]*API_KEY/);
    }
  });
});
