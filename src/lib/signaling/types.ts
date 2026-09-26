// Pluggable WebRTC signaling transport. Production uses Supabase Realtime
// broadcast; the local BroadcastChannel transport exists only so real WebRTC
// media paths can be exercised by automated browser tests without a backend.

export type SignalingEvent =
  | 'join'
  | 'offer'
  | 'answer'
  | 'ice-candidate'
  | 'leave'
  | 'data'
  | 'remote-control';

export type SignalingStatus = 'connecting' | 'subscribed' | 'closed' | 'error';

export interface SignalingTransport {
  readonly kind: 'supabase' | 'local';
  connect(onStatus: (status: SignalingStatus) => void): void;
  send(event: SignalingEvent, payload: unknown): void;
  on(event: SignalingEvent, handler: (payload: unknown) => void): () => void;
  close(): void;
}
