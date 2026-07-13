import { Mouse, MousePointerClick, Shield, Mic, MicOff, Video, VideoOff, X, Hand } from 'lucide-react';
import { useMeetingStore } from '@/store/meetingStore';
import { motion, AnimatePresence } from 'framer-motion';
import { useIsMobile } from '@/hooks/use-mobile';

export function ParticipantPanel() {
  const {
    rightPanel, toggleRightPanel, participants, grantMouseControl,
    revokeMouseControl, requestMouseControl, toggleHandRaise,
  } = useMeetingStore();

  const isOpen = rightPanel === 'participants';
  const isMobile = useIsMobile();
  const controllingUser = participants.find((p) => p.hasMouseControl);
  const raisedHands = participants
    .filter((p) => p.handRaised)
    .sort((a, b) => (a.handRaisedAt ?? 0) - (b.handRaisedAt ?? 0));

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
              onClick={() => toggleRightPanel('participants')}
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
              <Mouse className="w-5 h-5 text-primary" />
              <h2 className="font-display font-bold text-foreground text-lg">Participants</h2>
              <span className="text-xs bg-secondary text-muted-foreground px-2 py-0.5 rounded-full font-medium">
                {participants.length}
              </span>
            </div>
            <button
              onClick={() => toggleRightPanel('participants')}
              className="w-11 h-11 sm:w-9 sm:h-9 rounded-full flex items-center justify-center hover:bg-muted active:bg-muted transition-colors text-muted-foreground"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Raised hands queue */}
          {raisedHands.length > 0 && (
            <div className="mx-4 mt-3 p-3 rounded-lg bg-amber-50 border border-amber-200">
              <div className="flex items-center gap-2 mb-2">
                <Hand className="w-4 h-4 text-amber-600" />
                <span className="text-xs font-bold text-amber-700">
                  Raised Hands ({raisedHands.length})
                </span>
              </div>
              <div className="space-y-1.5">
                {raisedHands.map((p, i) => (
                  <div key={p.id} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono text-amber-500 w-4">{i + 1}.</span>
                      <span className="text-xs font-medium text-amber-800">{p.name}</span>
                    </div>
                    <motion.button
                      whileTap={{ scale: 0.95 }}
                      onClick={() => toggleHandRaise(p.id)}
                      className="text-[10px] px-2 py-1 rounded-full text-amber-600 hover:bg-amber-100 transition-colors"
                    >
                      Lower
                    </motion.button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Active control banner */}
          {controllingUser && (
            <div className="mx-4 mt-3 p-3 rounded-lg bg-primary/10 border border-primary/20">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MousePointerClick className="w-4 h-4 text-primary" />
                  <div>
                    <p className="text-xs font-bold text-primary">{controllingUser.name}</p>
                    <p className="text-[10px] text-muted-foreground">Has mouse control</p>
                  </div>
                </div>
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  onClick={revokeMouseControl}
                  className="text-xs px-3 py-1.5 rounded-full bg-destructive text-destructive-foreground font-medium hover:bg-destructive/90 transition-colors"
                >
                  Revoke
                </motion.button>
              </div>
            </div>
          )}

          {/* Participant list */}
          <div className={`flex-1 overflow-y-auto p-4 space-y-2 ${isMobile ? 'pb-[calc(6rem+env(safe-area-inset-bottom))]' : ''}`}>
            {participants.map((p) => (
              <motion.div
                key={p.id}
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                className={`flex items-center gap-3 p-3 rounded-xl transition-colors ${
                  p.hasMouseControl ? 'bg-primary/5 border border-primary/20' : 'hover:bg-muted/50'
                }`}
              >
                <div className={`relative w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
                  p.isSpeaking ? 'ring-2 ring-success' : ''
                } bg-muted`}>
                  <span className="text-xs font-display font-bold text-muted-foreground">
                    {p.avatar}
                  </span>
                  {p.handRaised && (
                    <span className="absolute -top-1 -right-1 text-sm">✋</span>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-medium text-foreground truncate">{p.name}</span>
                    {p.id === '1' && (
                      <span className="text-[9px] bg-primary text-primary-foreground px-1.5 py-0.5 rounded-full font-bold">
                        YOU
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    {p.isMuted ? (
                      <MicOff className="w-3 h-3 text-destructive" />
                    ) : (
                      <Mic className="w-3 h-3 text-success" />
                    )}
                    {p.isCameraOn ? (
                      <Video className="w-3 h-3 text-success" />
                    ) : (
                      <VideoOff className="w-3 h-3 text-muted-foreground" />
                    )}
                    {p.hasMouseControl && (
                      <span className="text-[9px] font-bold text-primary flex items-center gap-0.5">
                        <MousePointerClick className="w-3 h-3" /> CTRL
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  {p.id === '1' && (
                    <motion.button
                      whileTap={{ scale: 0.95 }}
                      onClick={() => toggleHandRaise(p.id)}
                      className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
                        p.handRaised
                          ? 'bg-amber-100 text-amber-600'
                          : 'hover:bg-muted text-muted-foreground'
                      }`}
                      title={p.handRaised ? 'Lower hand' : 'Raise hand'}
                    >
                      <Hand className="w-3.5 h-3.5" />
                    </motion.button>
                  )}
                  {p.id !== '1' && !p.hasMouseControl && (
                    <>
                      {p.mouseControlRequested ? (
                        <motion.button
                          whileTap={{ scale: 0.95 }}
                          onClick={() => grantMouseControl(p.id)}
                          className="text-[11px] px-3 py-1.5 rounded-full bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors"
                        >
                          Grant
                        </motion.button>
                      ) : (
                        <motion.button
                          whileTap={{ scale: 0.95 }}
                          onClick={() => requestMouseControl(p.id)}
                          className="text-[11px] px-3 py-1.5 rounded-full border border-border text-muted-foreground font-medium hover:bg-muted transition-colors"
                        >
                          Request
                        </motion.button>
                      )}
                    </>
                  )}
                </div>
              </motion.div>
            ))}
          </div>

          <div className="p-4 border-t border-border">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Shield className="w-3.5 h-3.5 text-success" />
              <span>Mouse control requires explicit permission via IPC validation</span>
            </div>
          </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
