import {
  newMessageId,
  type DataEnvelope,
  type DataHandler,
  type DataPath,
  type DataTopic,
  type PeerChannelEvent,
  type PeerChannelState,
} from './types';

const SEEN_MAX = 5000;
const MAX_MESSAGE_BYTES = 60_000; // keep well under the 64 KiB SCTP fragmentation threshold

export interface FallbackSender {
  (envelope: DataEnvelope): void;
}

/**
 * Meeting-wide pub/sub bus over RTCDataChannels.
 *
 * - One instance per meeting session (see getDataBus / resetDataBus).
 * - publish() fans out to every open channel (or the targeted peer only) and
 *   falls back to the Supabase broadcast sender for peers without an open
 *   channel, so delivery never depends on the channel being ready.
 * - ingest() is the single entry point for inbound envelopes from either path
 *   and de-duplicates by message id.
 */
export class DataBus {
  private localId = '';
  private channels = new Map<string, RTCDataChannel>();
  private channelStates = new Map<string, PeerChannelState>();
  private handlers = new Map<DataTopic, Set<DataHandler>>();
  private channelListeners = new Set<(event: PeerChannelEvent) => void>();
  private fallback: FallbackSender | null = null;
  private seen = new Set<string>();
  private seenOrder: string[] = [];
  private stats = { sentChannel: 0, sentFallback: 0, received: 0, duplicates: 0, dropped: 0 };

  setLocalId(id: string) {
    this.localId = id;
  }

  getLocalId() {
    return this.localId;
  }

  setFallback(sender: FallbackSender | null) {
    this.fallback = sender;
  }

  getStats() {
    return { ...this.stats };
  }

  /** Session ids of peers with an open data channel. */
  openPeers(): string[] {
    return Array.from(this.channels.entries())
      .filter(([, ch]) => ch.readyState === 'open')
      .map(([id]) => id);
  }

  peerState(peerId: string): PeerChannelState {
    return this.channelStates.get(peerId) ?? 'closed';
  }

  onPeerChannel(listener: (event: PeerChannelEvent) => void): () => void {
    this.channelListeners.add(listener);
    return () => {
      this.channelListeners.delete(listener);
    };
  }

  attachPeer(peerId: string, channel: RTCDataChannel) {
    const existing = this.channels.get(peerId);
    if (existing && existing !== channel) {
      try {
        existing.onopen = null;
        existing.onclose = null;
        existing.onmessage = null;
        existing.onerror = null;
      } catch {
        /* ignore */
      }
    }
    this.channels.set(peerId, channel);
    channel.binaryType = 'arraybuffer';
    const setState = (state: PeerChannelState) => {
      if (this.channelStates.get(peerId) === state && this.channels.get(peerId) === channel) return;
      if (this.channels.get(peerId) !== channel) return;
      this.channelStates.set(peerId, state);
      this.channelListeners.forEach((l) => {
        try {
          l({ peerId, state });
        } catch {
          /* listener errors must not break the bus */
        }
      });
    };
    channel.onopen = () => setState('open');
    channel.onclose = () => setState('closed');
    channel.onerror = () => setState('closed');
    channel.onmessage = (event) => {
      const text = typeof event.data === 'string' ? event.data : null;
      if (!text) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        this.stats.dropped += 1;
        return;
      }
      this.ingest(parsed, 'datachannel');
    };
    setState(channel.readyState === 'open' ? 'open' : 'connecting');
  }

  detachPeer(peerId: string) {
    const channel = this.channels.get(peerId);
    if (channel) {
      channel.onopen = null;
      channel.onclose = null;
      channel.onmessage = null;
      channel.onerror = null;
    }
    this.channels.delete(peerId);
    if (this.channelStates.get(peerId) !== 'closed') {
      this.channelStates.set(peerId, 'closed');
      this.channelListeners.forEach((l) => {
        try {
          l({ peerId, state: 'closed' });
        } catch {
          /* ignore */
        }
      });
    }
    this.channelStates.delete(peerId);
  }

  subscribe<T = unknown>(topic: DataTopic, handler: DataHandler<T>): () => void {
    let set = this.handlers.get(topic);
    if (!set) {
      set = new Set();
      this.handlers.set(topic, set);
    }
    set.add(handler as DataHandler);
    return () => {
      set?.delete(handler as DataHandler);
    };
  }

  /**
   * Publish a payload. Returns the message id. Targeted messages go only to
   * `to`; broadcast messages go to every open channel. Peers without an open
   * channel receive the message through the fallback sender (if configured).
   */
  publish<T>(topic: DataTopic, payload: T, options: { to?: string; id?: string } = {}): string {
    const envelope: DataEnvelope<T> = {
      v: 1,
      id: options.id ?? newMessageId(),
      topic,
      from: this.localId,
      to: options.to,
      ts: Date.now(),
      payload,
    };
    const text = JSON.stringify(envelope);
    if (text.length > MAX_MESSAGE_BYTES) {
      this.stats.dropped += 1;
      throw new Error(`data-plane message too large (${text.length} bytes)`);
    }
    let needsFallback = false;
    if (options.to) {
      if (!this.sendToPeer(options.to, text)) needsFallback = true;
    } else {
      // Broadcast: send on every open channel; if any known peer lacks an open
      // channel we also emit on the fallback so nobody misses the message.
      let openCount = 0;
      this.channels.forEach((ch, peerId) => {
        if (this.sendToPeer(peerId, text)) openCount += 1;
      });
      if (openCount < this.channels.size || this.channels.size === 0) needsFallback = true;
    }
    if (needsFallback && this.fallback) {
      this.stats.sentFallback += 1;
      try {
        this.fallback(envelope);
      } catch {
        /* fallback path errors are non-fatal */
      }
    }
    // Remember our own ids so an echo via fallback never re-enters handlers.
    this.markSeen(envelope.id);
    return envelope.id;
  }

  /** Deliver an inbound envelope from any path. */
  ingest(raw: unknown, via: DataPath) {
    const env = this.validate(raw);
    if (!env) {
      this.stats.dropped += 1;
      return;
    }
    if (env.from === this.localId) return;
    if (env.to && env.to !== this.localId) return;
    if (!this.markSeen(env.id)) {
      this.stats.duplicates += 1;
      return;
    }
    this.stats.received += 1;
    const set = this.handlers.get(env.topic);
    if (!set) return;
    const ctx = { from: env.from, to: env.to, id: env.id, ts: env.ts, via };
    set.forEach((handler) => {
      try {
        handler(env.payload, ctx);
      } catch (err) {
        console.warn('[data-plane] handler failed', env.topic, err);
      }
    });
  }

  /** Deliver a locally generated payload to local subscribers only (no network). */
  emitLocal<T>(topic: DataTopic, payload: T) {
    const set = this.handlers.get(topic);
    if (!set) return;
    const ctx = { from: this.localId, id: newMessageId(), ts: Date.now(), via: 'local' as const };
    set.forEach((handler) => {
      try {
        handler(payload, ctx);
      } catch (err) {
        console.warn('[data-plane] local handler failed', topic, err);
      }
    });
  }

  reset() {
    Array.from(this.channels.keys()).forEach((id) => this.detachPeer(id));
    this.handlers.clear();
    this.channelListeners.clear();
    this.fallback = null;
    this.seen.clear();
    this.seenOrder = [];
    this.stats = { sentChannel: 0, sentFallback: 0, received: 0, duplicates: 0, dropped: 0 };
  }

  private sendToPeer(peerId: string, text: string): boolean {
    const ch = this.channels.get(peerId);
    if (!ch || ch.readyState !== 'open') return false;
    try {
      ch.send(text);
      this.stats.sentChannel += 1;
      return true;
    } catch {
      return false;
    }
  }

  private markSeen(id: string): boolean {
    if (this.seen.has(id)) return false;
    this.seen.add(id);
    this.seenOrder.push(id);
    if (this.seenOrder.length > SEEN_MAX) {
      const drop = this.seenOrder.shift();
      if (drop) this.seen.delete(drop);
    }
    return true;
  }

  private validate(raw: unknown): DataEnvelope | null {
    if (!raw || typeof raw !== 'object') return null;
    const m = raw as Record<string, unknown>;
    if (m.v !== 1) return null;
    if (typeof m.id !== 'string' || m.id.length === 0 || m.id.length > 128) return null;
    if (typeof m.topic !== 'string') return null;
    if (typeof m.from !== 'string' || m.from.length === 0 || m.from.length > 256) return null;
    if (m.to !== undefined && (typeof m.to !== 'string' || m.to.length > 256)) return null;
    if (typeof m.ts !== 'number' || !Number.isFinite(m.ts)) return null;
    if (!('payload' in m)) return null;
    return m as unknown as DataEnvelope;
  }
}

let current: DataBus | null = null;

export function getDataBus(): DataBus {
  if (!current) current = new DataBus();
  return current;
}

export function resetDataBus() {
  current?.reset();
  current = null;
}
