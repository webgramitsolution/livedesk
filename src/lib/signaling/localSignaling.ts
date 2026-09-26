import type { SignalingEvent, SignalingStatus, SignalingTransport } from './types';

/**
 * BroadcastChannel signaling for automated tests and local two-tab development.
 * Never selected in production: see createSignaling().
 */
export class LocalSignaling implements SignalingTransport {
  readonly kind = 'local' as const;
  private channel: BroadcastChannel | null = null;
  private handlers = new Map<SignalingEvent, Set<(payload: unknown) => void>>();

  constructor(private meetingId: string) {}

  connect(onStatus: (status: SignalingStatus) => void) {
    onStatus('connecting');
    if (typeof BroadcastChannel === 'undefined') {
      onStatus('error');
      return;
    }
    this.channel = new BroadcastChannel(`livedesk-signal-${this.meetingId}`);
    this.channel.onmessage = (msg) => {
      const data = msg.data as { event?: SignalingEvent; payload?: unknown } | null;
      if (!data || typeof data.event !== 'string') return;
      this.handlers.get(data.event)?.forEach((h) => {
        try {
          h(data.payload);
        } catch (err) {
          console.warn('[local-signaling] handler failed', data.event, err);
        }
      });
    };
    // BroadcastChannel is ready synchronously; defer so subscribers attach first.
    setTimeout(() => onStatus('subscribed'), 0);
  }

  send(event: SignalingEvent, payload: unknown) {
    this.channel?.postMessage({ event, payload });
  }

  on(event: SignalingEvent, handler: (payload: unknown) => void) {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler);
    return () => {
      set?.delete(handler);
    };
  }

  close() {
    this.channel?.close();
    this.channel = null;
    this.handlers.clear();
  }
}
