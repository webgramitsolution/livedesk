import { X, Plus, Shuffle, Users, ArrowRight } from 'lucide-react';
import { useMeetingStore, type Participant } from '@/store/meetingStore';
import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

interface BreakoutRoom {
  id: string;
  name: string;
  participantIds: string[];
}

export function BreakoutRoomsModal() {
  const { showBreakoutRooms, toggleBreakoutRooms, participants, breakoutRooms, setBreakoutRooms, startBreakoutSession, breakoutActive, endBreakoutSession } = useMeetingStore();
  const [localRooms, setLocalRooms] = useState<BreakoutRoom[]>(
    breakoutRooms.length > 0 ? breakoutRooms : [
      { id: '1', name: 'Room 1', participantIds: [] },
      { id: '2', name: 'Room 2', participantIds: [] },
    ]
  );

  const unassigned = participants.filter(
    (p) => !localRooms.some((r) => r.participantIds.includes(p.id))
  );

  const addRoom = () => {
    setLocalRooms([...localRooms, { id: String(Date.now()), name: `Room ${localRooms.length + 1}`, participantIds: [] }]);
  };

  const removeRoom = (roomId: string) => {
    setLocalRooms(localRooms.filter((r) => r.id !== roomId));
  };

  const assignParticipant = (participantId: string, roomId: string) => {
    setLocalRooms(localRooms.map((r) => ({
      ...r,
      participantIds: r.id === roomId
        ? [...r.participantIds, participantId]
        : r.participantIds.filter((id) => id !== participantId),
    })));
  };

  const unassignParticipant = (participantId: string) => {
    setLocalRooms(localRooms.map((r) => ({
      ...r,
      participantIds: r.participantIds.filter((id) => id !== participantId),
    })));
  };

  const shuffleAll = () => {
    const allIds = participants.map((p) => p.id);
    const shuffled = [...allIds].sort(() => Math.random() - 0.5);
    const perRoom = Math.ceil(shuffled.length / localRooms.length);
    setLocalRooms(localRooms.map((r, i) => ({
      ...r,
      participantIds: shuffled.slice(i * perRoom, (i + 1) * perRoom),
    })));
  };

  const handleStart = () => {
    setBreakoutRooms(localRooms);
    startBreakoutSession();
  };

  const getParticipant = (id: string) => participants.find((p) => p.id === id);

  const dialogRef = useRef<HTMLDivElement>(null);

  // Lock body scroll, trap focus, handle Escape while open
  useEffect(() => {
    if (!showBreakoutRooms) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const previouslyFocused = document.activeElement as HTMLElement | null;
    // Move focus into the dialog
    requestAnimationFrame(() => {
      const focusable = dialogRef.current?.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      focusable?.focus();
    });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        toggleBreakoutRooms();
        return;
      }
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const focusables = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => !el.hasAttribute('aria-hidden'));
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKey);
      previouslyFocused?.focus?.();
    };
  }, [showBreakoutRooms]);

  if (typeof document === 'undefined') return null;

  const modal = (
    <AnimatePresence>
      {showBreakoutRooms && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-2 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Breakout Rooms"
        >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={toggleBreakoutRooms}
            className="absolute inset-0 bg-foreground/30 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            ref={dialogRef}
            className="relative flex flex-col overflow-hidden rounded-2xl border border-border bg-background control-bar-elevated w-full h-auto max-w-[min(32rem,calc(100vw-1rem))] max-h-[min(28rem,calc(100dvh-1rem))] sm:max-w-[min(32rem,calc(100vw-2rem))] sm:max-h-[min(28rem,calc(100dvh-2rem))]"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-5 sm:py-4">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-primary" />
                <h2 className="font-display font-bold text-foreground text-lg">Breakout Rooms</h2>
              </div>
              <button
                onClick={toggleBreakoutRooms}
                className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-muted transition-colors text-muted-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-hidden px-4 py-3 sm:px-5 sm:py-4">
              {/* Actions */}
              {!breakoutActive && (
                <div className="mb-3 flex flex-wrap gap-2">
                  <motion.button whileTap={{ scale: 0.95 }} onClick={shuffleAll} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted">
                    <Shuffle className="w-3.5 h-3.5" /> Auto-assign
                  </motion.button>
                  <motion.button whileTap={{ scale: 0.95 }} onClick={addRoom} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted">
                    <Plus className="w-3.5 h-3.5" /> Add Room
                  </motion.button>
                </div>
              )}

              {/* Rooms */}
              <div className="grid h-full gap-3 overflow-x-hidden overflow-y-auto lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] lg:items-start">
                {!breakoutActive && unassigned.length > 0 ? (
                   <div className="rounded-xl bg-secondary/50 p-3 lg:sticky lg:top-0">
                    <p className="text-xs font-medium text-muted-foreground mb-3">Unassigned ({unassigned.length})</p>
                    <div className="flex flex-wrap gap-2">
                      {unassigned.map((p) => (
                        <div key={p.id} className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-background border border-border text-xs font-medium text-foreground">
                          <span className="w-5 h-5 rounded-full bg-muted flex items-center justify-center text-[9px] font-bold text-muted-foreground">{p.avatar}</span>
                          {p.name}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                 <div className="grid gap-3 xl:grid-cols-2 xl:auto-rows-fr">
                  {localRooms.map((room) => (
                <div key={room.id} className="min-h-[15rem] rounded-xl border border-border p-3">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-display font-bold text-sm text-foreground">{room.name}</h3>
                    {!breakoutActive && localRooms.length > 1 && (
                      <button onClick={() => removeRoom(room.id)} className="text-xs text-destructive hover:underline">Remove</button>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    {room.participantIds.map((pid) => {
                      const p = getParticipant(pid);
                      if (!p) return null;
                      return (
                        <div key={pid} className="flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-muted/50 transition-colors">
                          <div className="flex items-center gap-2">
                            <span className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary">{p.avatar}</span>
                            <span className="text-sm text-foreground">{p.name}</span>
                          </div>
                          {!breakoutActive && (
                            <button onClick={() => unassignParticipant(pid)} className="text-xs text-muted-foreground hover:text-destructive">✕</button>
                          )}
                        </div>
                      );
                    })}
                    {!breakoutActive && (
                      <div className="pt-1">
                        {unassigned.length > 0 && (
                          <select
                            onChange={(e) => { if (e.target.value) { assignParticipant(e.target.value, room.id); e.target.value = ''; }}}
                            className="w-full rounded-lg border border-input bg-background px-2 py-2 text-xs text-muted-foreground"
                            defaultValue=""
                          >
                            <option value="" disabled>+ Add participant</option>
                            {unassigned.map((p) => (
                              <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                          </select>
                        )}
                      </div>
                    )}
                    {room.participantIds.length === 0 && (
                      <p className="text-xs text-muted-foreground italic px-2">No participants</p>
                    )}
                  </div>
                </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex gap-3 border-t border-border px-4 py-3 sm:px-5 sm:py-4">
              {breakoutActive ? (
                <motion.button
                  whileTap={{ scale: 0.98 }}
                  onClick={endBreakoutSession}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-destructive py-2.5 text-sm font-display font-bold text-destructive-foreground transition-colors hover:bg-destructive/90"
                >
                  End Breakout Sessions
                </motion.button>
              ) : (
                <motion.button
                  whileTap={{ scale: 0.98 }}
                  onClick={handleStart}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary py-2.5 text-sm font-display font-bold text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  <ArrowRight className="w-4 h-4" /> Start Breakout Sessions
                </motion.button>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );

  return createPortal(modal, document.body);
}
