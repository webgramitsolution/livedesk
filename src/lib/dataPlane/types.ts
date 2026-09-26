// Data plane message model. Everything that is not audio/video (annotation,
// remote-control input, permissions, chat, transcript segments, session state)
// travels as a DataEnvelope over a per-peer RTCDataChannel, with the Supabase
// Realtime broadcast channel as the fallback path while a channel is not open.

export type DataTopic =
  | 'annotation'
  | 'rc'
  | 'perm'
  | 'chat'
  | 'stt'
  | 'state'
  | 'sys';

export interface DataEnvelope<T = unknown> {
  v: 1;
  /** Unique message id, used for de-duplication when a message arrives via both paths. */
  id: string;
  topic: DataTopic;
  /** Sender session id. */
  from: string;
  /** Optional target session id. Absent means broadcast to the whole meeting. */
  to?: string;
  ts: number;
  payload: T;
}

export type DataPath = 'datachannel' | 'fallback' | 'local';

export interface DataMessageContext {
  from: string;
  to?: string;
  id: string;
  ts: number;
  via: DataPath;
}

export type DataHandler<T = unknown> = (payload: T, ctx: DataMessageContext) => void;

export type PeerChannelState = 'connecting' | 'open' | 'closed';

export interface PeerChannelEvent {
  peerId: string;
  state: PeerChannelState;
}

export function newMessageId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
