import { supabase } from '@/integrations/supabase/client';
import type { SignalingEvent, SignalingStatus, SignalingTransport } from './types';

export class SupabaseSignaling implements SignalingTransport {
  readonly kind = 'supabase' as const;
  private channel: ReturnType<typeof supabase.channel> | null = null;
  private handlers = new Map<SignalingEvent, Set<(payload: unknown) => void>>();
  private ready = false;

  constructor(private meetingId: string) {}

  connect(onStatus: (status: SignalingStatus) => void) {
    const channel = supabase.channel(`webrtc-${this.meetingId}`, {
      config: { broadcast: { self: false } },
    });
    this.channel = channel;
    const events: SignalingEvent[] = ['join', 'offer', 'answer', 'ice-candidate', 'leave', 'data', 'remote-control'];
    events.forEach((event) => {
      channel.on('broadcast', { event }, ({ payload }) => this.dispatch(event, payload));
    });
    onStatus('connecting');
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        this.ready = true;
        onStatus('subscribed');
      } else if (status === 'CLOSED') {
        this.ready = false;
        onStatus('closed');
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        this.ready = false;
        onStatus('error');
      }
    });
  }

  send(event: SignalingEvent, payload: unknown) {
    if (!this.channel) return;
    void this.channel.send({ type: 'broadcast', event, payload });
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
    if (this.channel) supabase.removeChannel(this.channel);
    this.channel = null;
    this.ready = false;
    this.handlers.clear();
  }

  isReady() {
    return this.ready;
  }

  private dispatch(event: SignalingEvent, payload: unknown) {
    this.handlers.get(event)?.forEach((h) => {
      try {
        h(payload);
      } catch (err) {
        console.warn('[signaling] handler failed', event, err);
      }
    });
  }
}
