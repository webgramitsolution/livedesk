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
            role="dialog"
            aria-modal="true"
            aria-label="Breakout Rooms"
            className="relative flex w-[calc(100vw-24px)] max-w-[80rem] flex-col overflow-hidden rounded-2xl border border-border bg-background control-bar-elevated sm:w-[92vw] lg:w-full max-h-[min(34rem,85dvh)]"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-5 sm:py-4">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-primary" />
                <h2 className="font-display font-bold text-foreground text-lg">Breakout Rooms</h2>
              </div>
              <button
                onClick={toggleBreakoutRooms}
                aria-label="Close Breakout Rooms"
                className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-muted transition-colors text-muted-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

             <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 py-3 sm:px-5 sm:py-4">
              {/* Actions */}
              {!breakoutActive && (
                 <div className="mb-4 flex flex-wrap gap-3" role="toolbar" aria-label="Breakout room actions">
                   <motion.button whileTap={{ scale: 0.95 }} onClick={shuffleAll} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-border px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted">
                     <Shuffle className="h-4 w-4 shrink-0" /> <span>Auto-assign</span>
                  </motion.button>
                   <motion.button whileTap={{ scale: 0.95 }} onClick={addRoom} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-border px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted">
                     <Plus className="h-4 w-4 shrink-0" /> <span>Add Room</span>
                  </motion.button>
                </div>
              )}

              {/* Rooms */}
              <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto pr-1" data-testid="breakout-modal-body">
                {!breakoutActive && unassigned.length > 0 ? (
                   <div className="mb-4 rounded-2xl bg-secondary/50 p-3">
                    <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Unassigned ({unassigned.length})</p>
                    <div className="grid max-h-28 grid-cols-[repeat(auto-fit,minmax(min(180px,100%),1fr))] gap-2 overflow-y-auto pr-1">
                      {unassigned.map((p) => (
                        <div key={p.id} className="flex min-w-0 items-center gap-2 rounded-xl border border-border bg-background px-2 py-1.5 text-xs font-medium text-foreground">
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[9px] font-bold text-muted-foreground">{p.avatar}</span>
                          <span className="min-w-0 truncate" title={p.name}>{p.name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                 <div
                   className="grid w-full gap-5"
                   data-testid="breakout-room-grid"
                   style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(260px, 100%), 1fr))' }}
                 >
                  {localRooms.map((room) => (
                <div key={room.id} className="flex min-h-[220px] w-full min-w-0 flex-col rounded-2xl border border-border p-4" data-testid="breakout-room-card">
                  <div className="mb-3 flex min-w-0 items-start justify-between gap-3">
                    <h3 className="min-w-0 flex-1 truncate font-display text-base font-bold leading-6 text-foreground" title={room.name}>{room.name}</h3>
                    {!breakoutActive && localRooms.length > 1 && (
                      <button onClick={() => removeRoom(room.id)} className="shrink-0 whitespace-nowrap rounded-lg px-2 py-1 text-xs font-semibold text-destructive transition-colors hover:bg-destructive/10">Remove</button>
                    )}
                  </div>
                  <div className="flex min-h-0 flex-1 flex-col">
                    <div className="min-h-0 max-h-40 flex-1 space-y-2 overflow-y-auto pr-1" data-testid="breakout-participant-list">
                    {room.participantIds.map((pid) => {
                      const p = getParticipant(pid);
                      if (!p) return null;
                      return (
                        <div key={pid} className="flex min-w-0 items-center justify-between gap-2 rounded-xl px-2 py-1.5 transition-colors hover:bg-muted/50" data-testid="breakout-participant-chip">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">{p.avatar}</span>
                            <span className="min-w-0 truncate text-sm text-foreground" title={p.name}>{p.name}</span>
                          </div>
                          {!breakoutActive && (
                            <button onClick={() => unassignParticipant(pid)} aria-label={`Remove ${p.name} from ${room.name}`} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs text-muted-foreground hover:bg-destructive/10 hover:text-destructive">✕</button>
                          )}
                        </div>
                      );
                    })}
                    {room.participantIds.length === 0 && (
                      <p className="px-2 text-xs italic text-muted-foreground">No participants</p>
                    )}
                    </div>
                    {!breakoutActive && (
                      <div className="mt-3 shrink-0 pt-1">
                        {unassigned.length > 0 && (
                          <select
                            onChange={(e) => { if (e.target.value) { assignParticipant(e.target.value, room.id); e.target.value = ''; }}}
                            className="w-full min-w-0 rounded-xl border border-input bg-background px-3 py-2 text-xs text-muted-foreground"
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
