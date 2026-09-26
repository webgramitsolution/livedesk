import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AppWindow, Monitor, X } from 'lucide-react';
import { getElectronDesktop } from '@/lib/remoteControl/electronBridge';
import { cn } from '@/lib/utils';

interface Source {
  id: string;
  name: string;
  thumbnail: string;
  kind: 'screen' | 'window';
  displayId?: string;
}

/**
 * Desktop-only picker shown when the app calls getDisplayMedia inside
 * Electron (which has no built-in chooser). The main process already filters
 * out the LiveDesk window itself so the meeting cannot capture itself.
 */
export function ElectronSourcePicker() {
  const [sources, setSources] = useState<Source[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [withAudio, setWithAudio] = useState(false);

  useEffect(() => {
    const desktop = getElectronDesktop();
    if (!desktop) return;
    return desktop.screenShare.onSourcesRequested((list) => {
      setSources(list);
      setSelected(list.find((s) => s.kind === 'screen')?.id ?? list[0]?.id ?? null);
    });
  }, []);

  const finish = (sourceId: string | null) => {
    getElectronDesktop()?.screenShare.chooseSource(sourceId, withAudio);
    setSources(null);
    setSelected(null);
  };

  const screens = sources?.filter((s) => s.kind === 'screen') ?? [];
  const windows = sources?.filter((s) => s.kind === 'window') ?? [];

  return (
    <AnimatePresence>
      {sources && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[90] flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Choose what to share"
        >
          <motion.div
            initial={{ scale: 0.96, y: 8 }}
            animate={{ scale: 1, y: 0 }}
            className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <div>
                <h2 className="font-display text-base font-bold text-foreground">Choose what to share</h2>
                <p className="text-xs text-muted-foreground">The LiveDesk window is excluded so the meeting never mirrors itself.</p>
              </div>
              <button type="button" onClick={() => finish(null)} className="rounded-full p-2 text-muted-foreground hover:bg-muted" aria-label="Cancel">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              {[{ title: 'Entire screen', Icon: Monitor, items: screens }, { title: 'Application window', Icon: AppWindow, items: windows }].map(
                ({ title, Icon, items }) =>
                  items.length > 0 && (
                    <section key={title} className="mb-5">
                      <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        <Icon className="h-3.5 w-3.5" /> {title}
                      </h3>
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                        {items.map((s) => (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => setSelected(s.id)}
                            onDoubleClick={() => finish(s.id)}
                            className={cn(
                              'overflow-hidden rounded-xl border text-left transition-colors',
                              selected === s.id ? 'border-primary ring-2 ring-primary/40' : 'border-border hover:border-primary/40',
                            )}
                          >
                            <div className="aspect-video bg-muted">
                              {s.thumbnail ? <img src={s.thumbnail} alt="" className="h-full w-full object-cover" /> : null}
                            </div>
                            <p className="truncate px-2 py-1.5 text-xs font-medium text-foreground">{s.name}</p>
                          </button>
                        ))}
                      </div>
                    </section>
                  ),
              )}
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3">
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input type="checkbox" checked={withAudio} onChange={(e) => setWithAudio(e.target.checked)} />
                Share system audio (Windows, entire screen only)
              </label>
              <div className="flex gap-2">
                <button type="button" onClick={() => finish(null)} className="rounded-xl border border-border px-4 py-2 text-sm text-foreground hover:bg-muted">
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!selected}
                  onClick={() => finish(selected)}
                  className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  Share
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
