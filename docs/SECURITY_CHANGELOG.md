# Security change log

Record of security findings selected for remediation, the fix applied, how it was
validated, and when. Sensitive values (keys, tokens, secrets, user data, meeting
codes) are never recorded here — only the nature of the change.

Automated validation for the entries below lives in
`src/test/security-regression.test.ts` (run with `bunx vitest run src/test/security-regression.test.ts`).

## 2026-09-25

Selected findings: 6. Fixed: 6. Unrelated findings touched: 0.

| # | Finding ID | Area | Fix applied | Validation | Validated at (UTC) |
|---|------------|------|-------------|------------|--------------------|
| 1 | `lov_finding_879cb7571feb39d5` | Public AI endpoint — live transcription token issuer (`supabase/functions/elevenlabs-scribe-token`) | Added a required bearer-token check and server-side claim verification before any provider call, so only signed-in users can mint a transcription token. | Automated: asserts the function rejects requests without a verified session and performs the auth check before reading the provider credential. | 2026-09-25T05:55Z |
| 2 | `lov_finding_a1e6a4d000b55021` | Public AI endpoint — translation (`supabase/functions/translate-text`) | Same required bearer-token check and claim verification ahead of the AI gateway call, preventing anonymous use of paid capacity. | Automated: asserts unauthenticated requests are refused and the auth gate precedes the gateway request. | 2026-09-25T05:55Z |
| 3 | `lov_finding_199f328f4a344ef8` | Guessable meeting identifier — instant meeting creation (`src/components/meeting/LobbyScreen.tsx`) | Replaced the predictable pseudo-random numeric code with a cryptographically secure random code drawn from a 32-symbol alphabet. | Automated: asserts no `Math.random` in code generation, a CSPRNG source is used, and generated codes match the expected shape with high uniqueness across many samples. | 2026-09-25T05:55Z |
| 4 | `lov_finding_64bacab0a868fc4f` | Guessable meeting identifier — scheduled meetings (`src/components/meeting/MeetingScheduler.tsx`) | Same cryptographically secure code generation for scheduled meeting codes. | Automated: same generator assertions as above. | 2026-09-25T05:55Z |
| 5 | `lov_finding_651326b92567458d` | Guessable meeting identifier — agent tool (`src/lib/mcp/tools/create-scheduled-meeting.ts`) | Same cryptographically secure code generation for meetings created through the agent integration. | Automated: same generator assertions as above. | 2026-09-25T05:55Z |
| 6 | `lov_finding_9435a83dbd3bc7bc` | Guessable meeting identifier — deployed agent endpoint (`supabase/functions/mcp`) | Same cryptographically secure code generation in the deployed agent function bundle. | Automated: same generator assertions as above. | 2026-09-25T05:55Z |

### Explicitly out of scope

Findings not in the selected set were left untouched. The regression suite asserts
this by checking that unrelated surfaces keep their existing behaviour:

- Meeting presence and join-request access rules — unchanged.
- Realtime channel authorisation helpers — unchanged.
- Remote-control signing, nonce and replay protection — unchanged.
- Remaining open finding count at time of fix: 1 (not selected, not modified).

### New surfaces added after the fixes

| Date (UTC) | Surface | Security posture |
|------------|---------|------------------|
| 2026-09-25 | `supabase/functions/analyze-webrtc-diagnostics` (AI connection analysis) | Requires a verified session before any AI call; diagnostics payloads are redacted server-side (tokens, keys, emails, phone numbers, IP/ICE candidate data) and size-capped before leaving the function. |
