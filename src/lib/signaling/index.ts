import { LocalSignaling } from './localSignaling';
import { SupabaseSignaling } from './supabaseSignaling';
import type { SignalingTransport } from './types';

export type { SignalingEvent, SignalingStatus, SignalingTransport } from './types';

export function isLocalSignalingEnabled(): boolean {
  if (import.meta.env.PROD) return false;
  return import.meta.env.VITE_E2E_LOCAL_SIGNALING === '1';
}

export function createSignaling(meetingId: string): SignalingTransport {
  if (isLocalSignalingEnabled()) return new LocalSignaling(meetingId);
  return new SupabaseSignaling(meetingId);
}

/** ICE configuration from environment, with STUN-only defaults. */
export function buildIceConfiguration(): RTCConfiguration {
  const servers: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];
  const turnUrls = (import.meta.env.VITE_TURN_URLS as string | undefined)?.split(',').map((s) => s.trim()).filter(Boolean) ?? [];
  const username = import.meta.env.VITE_TURN_USERNAME as string | undefined;
  const credential = import.meta.env.VITE_TURN_CREDENTIAL as string | undefined;
  if (turnUrls.length > 0 && username && credential) {
    servers.push({ urls: turnUrls, username, credential });
  }
  return { iceServers: servers };
}
