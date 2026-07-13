import { useState, useRef, useEffect } from 'react';
import { Send, X, MessageCircle } from 'lucide-react';
import { useMeetingStore } from '@/store/meetingStore';
import { motion, AnimatePresence } from 'framer-motion';
import { useIsMobile } from '@/hooks/use-mobile';

export function ChatPanel() {
  const { rightPanel, toggleRightPanel, chatMessages, sendChatMessage } = useMeetingStore();
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const isOpen = rightPanel === 'chat';
  const isMobile = useIsMobile();

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chatMessages]);

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    sendChatMessage(trimmed);
    setInput('');
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {isMobile && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-foreground/25 backdrop-blur-sm"
              onClick={() => toggleRightPanel('chat')}
            />
          )}
          <motion.aside
            initial={isMobile ? { y: '100%', opacity: 0.6 } : { width: 0, opacity: 0 }}
            animate={isMobile ? { y: 0, opacity: 1 } : { width: 320, opacity: 1 }}
            exit={isMobile ? { y: '100%', opacity: 0.6 } : { width: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
            className={`${
              isMobile
                ? 'fixed inset-0 z-[60] rounded-none border-0'
                : 'h-full shrink-0 border-l'
            } bg-background flex flex-col overflow-hidden`}
            style={isMobile ? undefined : { width: 320 }}
          >
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-border">
            <div className="flex items-center gap-2">
              <MessageCircle className="w-5 h-5 text-primary" />
              <h2 className="font-display font-bold text-foreground text-lg">Chat</h2>
            </div>
            <button
              onClick={() => toggleRightPanel('chat')}
              className="w-11 h-11 sm:w-9 sm:h-9 rounded-full flex items-center justify-center hover:bg-muted active:bg-muted transition-colors text-muted-foreground"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className={`flex-1 overflow-y-auto p-4 space-y-3 ${isMobile ? 'pb-32' : ''}`}>
            {chatMessages.map((msg) => (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className={`flex flex-col ${msg.isOwn ? 'items-end' : 'items-start'}`}
              >
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className={`text-[11px] font-bold ${msg.isOwn ? 'text-primary' : 'text-foreground'}`}>
                    {msg.sender}
                  </span>
                  <span className="text-[10px] text-muted-foreground">{msg.timestamp}</span>
                </div>
                <div
                  className={`max-w-[85%] px-3 py-2 rounded-2xl text-sm leading-relaxed ${
                    msg.isOwn
                      ? 'bg-primary text-primary-foreground rounded-br-md'
                      : 'bg-secondary text-foreground rounded-bl-md'
                  }`}
                >
                  {msg.text}
                </div>
              </motion.div>
            ))}
          </div>

          {/* Input */}
          <div className={`p-3 border-t border-border bg-background ${isMobile ? 'pb-[calc(1rem+env(safe-area-inset-bottom))]' : 'pb-safe'}`}>
            <div className="flex items-center gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                placeholder="Type a message..."
                className="flex-1 px-4 py-2.5 rounded-full border border-input bg-background text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={handleSend}
                disabled={!input.trim()}
                className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:pointer-events-none"
              >
                <Send className="w-4 h-4" />
              </motion.button>
            </div>
          </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
