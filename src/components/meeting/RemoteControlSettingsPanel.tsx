import { useState } from 'react';
import { X, Sliders, RotateCcw } from 'lucide-react';
import { DEFAULT_RC_TUNING, useRCTuning, type RCTuning } from '@/lib/remoteControl/settings';

interface Props {
  meetingId: string;
  onClose: () => void;
}

const rows: Array<{
  key: keyof RCTuning;
  label: string;
  hint: string;
  min: number;
  max: number;
  step: number;
  suffix: string;
}> = [
  { key: 'mousemoveMinMs', label: 'Mouse move throttle', hint: 'Lower = smoother, more bandwidth', min: 4, max: 100, step: 2, suffix: 'ms' },
  { key: 'wheelMinMs', label: 'Scroll throttle', hint: 'Applies to wheel events while controlling', min: 4, max: 100, step: 2, suffix: 'ms' },
  { key: 'cursorSendMinMs', label: 'Cursor broadcast rate', hint: 'How often your cursor position is sent', min: 8, max: 200, step: 2, suffix: 'ms' },
  { key: 'cursorSmoothingMs', label: 'Cursor smoothing', hint: 'Higher hides jitter during network spikes', min: 0, max: 400, step: 10, suffix: 'ms' },
];

export function RemoteControlSettingsPanel({ meetingId, onClose }: Props) {
  const [tuning, setTuning] = useRCTuning(meetingId);
  const [draft, setDraft] = useState<RCTuning>(tuning);

  const update = (key: keyof RCTuning, value: number) => {
    const next = { ...draft, [key]: value };
    setDraft(next);
    setTuning(next);
  };
  const reset = () => {
    setDraft(DEFAULT_RC_TUNING);
    setTuning(DEFAULT_RC_TUNING);
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-background shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Sliders className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold">Remote control tuning</h2>
          </div>
          <button onClick={onClose} className="rounded-full p-1 hover:bg-muted" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-4 p-4">
          {rows.map((row) => (
            <div key={row.key} className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <label className="font-medium">{row.label}</label>
                <span className="tabular-nums text-muted-foreground">
                  {draft[row.key]} {row.suffix}
                </span>
              </div>
              <input
                type="range"
                min={row.min}
                max={row.max}
                step={row.step}
                value={draft[row.key]}
                onChange={(e) => update(row.key, Number(e.target.value))}
                className="w-full accent-primary"
              />
              <p className="text-[10px] text-muted-foreground">{row.hint}</p>
            </div>
          ))}
          <button
            onClick={reset}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs hover:bg-muted"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Reset defaults
          </button>
        </div>
      </div>
    </div>
  );
}
