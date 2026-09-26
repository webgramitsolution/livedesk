import { useEffect } from 'react';
import { getDataBus } from '@/lib/dataPlane';
import { useMeetingStore, type RoomChatMessage, type RoomStateMessage } from '@/store/meetingStore';

/**
 * Applies inbound chat, hand-raise and reaction messages from the data plane
 * to the store. Outbound messages are published by the store actions.
 */
export function RoomSync() {
  const screen = useMeetingStore((s) => s.screen);

  useEffect(() => {
    if (screen !== 'meeting') return;
    const bus = getDataBus();
    const unsubscribeChat = bus.subscribe<RoomChatMessage>('chat', (message, ctx) => {
      if (!message || message.kind !== 'chat' || typeof message.text !== 'string' || typeof message.id !== 'string') return;
      if (message.text.length === 0 || message.text.length > 4000) return;
      useMeetingStore.getState().receiveChatMessage(message, ctx.from);
    });
    const unsubscribeState = bus.subscribe<RoomStateMessage>('state', (message, ctx) => {
      if (!message || typeof message !== 'object') return;
      const store = useMeetingStore.getState();
      if (message.type === 'hand' && typeof message.raised === 'boolean') {
        store.setRemoteHandRaised(ctx.from, message.raised);
      } else if (message.type === 'reaction' && typeof message.emoji === 'string' && message.emoji.length <= 8) {
        store.sendReaction(message.emoji, ctx.from);
      }
    });
    // Late joiners learn our raised hand when the channel opens.
    const unsubscribeLink = bus.onPeerChannel((e) => {
      if (e.state !== 'open') return;
      const me = useMeetingStore.getState().participants.find((p) => p.id === '1');
      if (me?.handRaised) {
        try {
          bus.publish('state', { type: 'hand', raised: true } satisfies RoomStateMessage, { to: e.peerId });
        } catch {
          /* ignore */
        }
      }
    });
    return () => {
      unsubscribeChat();
      unsubscribeState();
      unsubscribeLink();
    };
  }, [screen]);

  return null;
}
