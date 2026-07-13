import { X, FileText, Copy, Check } from 'lucide-react';
import { useMeetingStore } from '@/store/meetingStore';
import { motion, AnimatePresence } from 'framer-motion';
import { useState } from 'react';

export function MeetingSummaryModal() {
  const { showSummary, summaryPoints, dismissSummary } = useMeetingStore();
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    const text = summaryPoints.map((p, i) => `${i + 1}. ${p}`).join('\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <AnimatePresence>
      {showSummary && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={dismissSummary}
            className="fixed inset-0 bg-foreground/20 backdrop-blur-sm z-50"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[90vw] max-w-lg bg-background rounded-2xl border border-border control-bar-elevated z-50 flex flex-col overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between p-5 border-b border-border">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-primary" />
                <h2 className="font-display font-bold text-foreground text-lg">Meeting Summary</h2>
              </div>
              <button
                onClick={dismissSummary}
                className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-muted transition-colors text-muted-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-5 space-y-3">
              <p className="text-sm text-muted-foreground mb-4">
                Key points from your meeting discussion:
              </p>
              {summaryPoints.map((point, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.1 }}
                  className="flex gap-3 p-3 rounded-xl bg-secondary/50"
                >
                  <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                    {i + 1}
                  </span>
                  <p className="text-sm text-foreground leading-relaxed">{point}</p>
                </motion.div>
              ))}
            </div>

            {/* Footer */}
            <div className="p-5 border-t border-border flex gap-3">
              <motion.button
                whileTap={{ scale: 0.98 }}
                onClick={handleCopy}
                className="flex-1 py-2.5 rounded-xl border border-border text-foreground font-display font-bold text-sm hover:bg-muted transition-colors flex items-center justify-center gap-2"
              >
                {copied ? <Check className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
                {copied ? 'Copied!' : 'Copy Summary'}
              </motion.button>
              <motion.button
                whileTap={{ scale: 0.98 }}
                onClick={dismissSummary}
                className="flex-1 py-2.5 rounded-xl bg-primary text-primary-foreground font-display font-bold text-sm hover:bg-primary/90 transition-colors"
              >
                Done
              </motion.button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
