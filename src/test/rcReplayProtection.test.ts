// Deterministic replay-protection test.
//
// The protocol wraps every message in an envelope with (msgId, ts, sig).
// Anti-replay works on two independent layers:
//   1. The seenIds LRU inside validateRCMessage drops any msgId it has
//      already accepted — even if the message is otherwise valid.
//   2. The RC_MAX_SKEW_MS window rejects any envelope whose ts drifts too
//      far from the local clock, so a captured message replayed long after
//      capture time is invalid regardless of the LRU.
//
// This test exercises both, deterministically. No random state, no timing
// races — vi.setSystemTime is the sole clock.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  RC_MAX_SKEW_MS,
  resetRCReplayWindow,
  validateRCMessage,
} from '@/lib/remoteControl/validation';
import { signRC } from '@/lib/remoteControl/protocol';

const MEETING = 'replay-meeting';
const NOW = 1_785_000_000_000;

function build(msg: Record<string, unknown>, ts: number) {
  const sig = signRC({
    kind: msg.kind as string,
    from: msg.from as string,
    msgId: msg.msgId as string,
    ts,
    meetingId: MEETING,
  });
  return { ...msg, ts, sig };
}

describe('remote-control envelope: nonce replay + clock-skew rejection', () => {
  beforeEach(() => {
    resetRCReplayWindow();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
  });
  afterEach(() => vi.useRealTimers());

  it('accepts a fresh signed message exactly once, then rejects every replay by msgId', () => {
    const captured = build(
      { kind: 'request', from: 'viewer-1', name: 'Viewer', to: 'host', msgId: 'nonce-A' },
      NOW,
    );

    // First arrival — accepted.
    expect(validateRCMessage(captured, { meetingId: MEETING })).not.toBeNull();

    // Every subsequent replay of the SAME msgId — dropped by the LRU,
    // regardless of how many attempts.
    for (let i = 0; i < 25; i += 1) {
      expect(validateRCMessage(captured, { meetingId: MEETING })).toBeNull();
    }
  });

  it('rejects a captured message replayed after the clock-skew window even if its msgId is unseen', () => {
    const capturedAt = NOW;
    const captured = build(
      { kind: 'input', from: 'attacker', to: 'host', nonce: 'x', msgId: 'nonce-B',
        event: { type: 'mousemove', x: 0.5, y: 0.5 } },
      capturedAt,
    );

    // Advance the local clock past the skew window before delivering.
    vi.setSystemTime(new Date(capturedAt + RC_MAX_SKEW_MS + 1));

    // Even on FIRST delivery (LRU empty), the envelope is rejected because
    // ts is too far in the past.
    expect(validateRCMessage(captured, { meetingId: MEETING })).toBeNull();

    // Confirm the LRU had nothing to do with it — reset and retry with the
    // same result.
    resetRCReplayWindow();
    expect(validateRCMessage(captured, { meetingId: MEETING })).toBeNull();
  });

  it('rejects a message replayed into a DIFFERENT meeting even at the same ts', () => {
    // Attacker captures a valid message from meeting A and replays it into
    // meeting B. The signature was mixed with meetingId, so it fails
    // verification in B even though ts, msgId, and payload are unchanged.
    const captured = build(
      { kind: 'grant', from: 'presenter-A', to: 'viewer', nonce: 'n', allowKeyboard: true, msgId: 'nonce-C' },
      NOW,
    );

    // Accepted in the original meeting.
    expect(validateRCMessage(captured, { meetingId: MEETING })).not.toBeNull();

    // Reset the LRU so we know rejection is purely due to signature
    // mismatch, not the seen-id cache.
    resetRCReplayWindow();
    expect(validateRCMessage(captured, { meetingId: 'DIFFERENT_MEETING' })).toBeNull();
  });

  it('rejects a tampered payload: same msgId+ts, mutated body → signature no longer verifies', () => {
    const legit = build(
      { kind: 'request', from: 'viewer-1', name: 'Viewer', to: 'host', msgId: 'nonce-D' },
      NOW,
    );
    expect(validateRCMessage(legit, { meetingId: MEETING })).not.toBeNull();

    // Attacker mutates `from` while keeping the original signature.
    const tampered = { ...legit, from: 'attacker' };
    resetRCReplayWindow();
    expect(validateRCMessage(tampered, { meetingId: MEETING })).toBeNull();
  });
});