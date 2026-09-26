import { describe, expect, it, beforeEach } from 'vitest';
import { DataBus } from '@/lib/dataPlane/bus';
import type { DataEnvelope } from '@/lib/dataPlane/types';

class FakeChannel {
  readyState: RTCDataChannelState = 'connecting';
  binaryType = 'arraybuffer';
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  send(text: string) {
    if (this.readyState !== 'open') throw new Error('not open');
    this.sent.push(text);
  }
  open() {
    this.readyState = 'open';
    this.onopen?.();
  }
  close() {
    this.readyState = 'closed';
    this.onclose?.();
  }
  receive(text: string) {
    this.onmessage?.({ data: text });
  }
}

const asChannel = (c: FakeChannel) => c as unknown as RTCDataChannel;

describe('DataBus', () => {
  let bus: DataBus;
  beforeEach(() => {
    bus = new DataBus();
    bus.setLocalId('me');
  });

  it('sends on open channels and uses fallback while a peer channel is not open', () => {
    const a = new FakeChannel();
    const b = new FakeChannel();
    const fallback: DataEnvelope[] = [];
    bus.setFallback((env) => fallback.push(env));
    bus.attachPeer('a', asChannel(a));
    bus.attachPeer('b', asChannel(b));
    a.open();

    bus.publish('chat', { text: 'hi' });
    expect(a.sent).toHaveLength(1);
    expect(b.sent).toHaveLength(0);
    // b has no open channel, so the fallback carried the message too.
    expect(fallback).toHaveLength(1);
    expect(fallback[0].topic).toBe('chat');

    b.open();
    bus.publish('chat', { text: 'again' });
    expect(a.sent).toHaveLength(2);
    expect(b.sent).toHaveLength(1);
    expect(fallback).toHaveLength(1);
  });

  it('targets a single peer and falls back when that peer is not reachable', () => {
    const a = new FakeChannel();
    const fallback: DataEnvelope[] = [];
    bus.setFallback((env) => fallback.push(env));
    bus.attachPeer('a', asChannel(a));
    a.open();
    bus.publish('rc', { kind: 'ping' }, { to: 'a' });
    expect(a.sent).toHaveLength(1);
    expect(fallback).toHaveLength(0);
    bus.publish('rc', { kind: 'ping' }, { to: 'zzz' });
    expect(fallback).toHaveLength(1);
    expect(fallback[0].to).toBe('zzz');
  });

  it('de-duplicates the same message arriving via data channel and fallback', () => {
    const a = new FakeChannel();
    bus.attachPeer('a', asChannel(a));
    a.open();
    const received: unknown[] = [];
    bus.subscribe('annotation', (payload) => received.push(payload));
    const env: DataEnvelope = { v: 1, id: 'op-1', topic: 'annotation', from: 'a', ts: Date.now(), payload: { tool: 'circle' } };
    a.receive(JSON.stringify(env));
    bus.ingest(env, 'fallback');
    expect(received).toHaveLength(1);
    expect(bus.getStats().duplicates).toBe(1);
  });

  it('ignores self echoes, messages for other targets, and malformed envelopes', () => {
    const received: unknown[] = [];
    bus.subscribe('chat', (payload) => received.push(payload));
    bus.ingest({ v: 1, id: 'x1', topic: 'chat', from: 'me', ts: 1, payload: {} }, 'fallback');
    bus.ingest({ v: 1, id: 'x2', topic: 'chat', from: 'other', to: 'someone-else', ts: 1, payload: {} }, 'fallback');
    bus.ingest({ v: 2, id: 'x3', topic: 'chat', from: 'other', ts: 1, payload: {} }, 'fallback');
    bus.ingest('garbage', 'fallback');
    expect(received).toHaveLength(0);
    bus.ingest({ v: 1, id: 'x4', topic: 'chat', from: 'other', to: 'me', ts: 1, payload: { ok: true } }, 'fallback');
    expect(received).toEqual([{ ok: true }]);
  });

  it('reports channel state transitions per peer', () => {
    const a = new FakeChannel();
    const events: string[] = [];
    bus.onPeerChannel((e) => events.push(`${e.peerId}:${e.state}`));
    bus.attachPeer('a', asChannel(a));
    a.open();
    a.close();
    bus.detachPeer('a');
    expect(events).toEqual(['a:connecting', 'a:open', 'a:closed']);
    expect(bus.peerState('a')).toBe('closed');
  });
});
