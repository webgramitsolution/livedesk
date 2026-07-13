import { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { motion } from 'framer-motion';

interface Props {
  title: string;
  onClose: () => void;
  headerActions?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  ariaLabel?: string;
}

/**
 * Reusable mobile full-screen modal shell.
 * - 100vw / 100dvh, no border radius
 * - Sticky header with back button + optional actions
 * - Sticky footer (optional)
 * - Safe-area padding (iOS notch / Android gesture bar)
 * - Slide-in-from-right animation
 * - Body scrolls naturally, no inner scrollbars
 */
export function MobileModalShell({ title, onClose, headerActions, footer, children, ariaLabel }: Props) {
  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', damping: 30, stiffness: 300 }}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel ?? title}
      className="fixed inset-0 z-[100] flex h-[100dvh] w-screen flex-col overflow-hidden bg-background"
      style={{
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
      }}
    >
      {/* Sticky header */}
      <div className="sticky top-0 z-10 flex shrink-0 items-center gap-2 border-b border-border bg-background px-3 py-2">
        <button
          type="button"
          onClick={onClose}
          aria-label="Back"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h2 className="min-w-0 flex-1 truncate font-display text-lg font-bold text-foreground">{title}</h2>
        {headerActions ? <div className="flex shrink-0 items-center gap-1">{headerActions}</div> : null}
      </div>

      {/* Scrollable body */}
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain">{children}</div>

      {/* Sticky footer */}
      {footer ? (
        <div className="sticky bottom-0 z-10 shrink-0 border-t border-border bg-background px-4 py-3">
          {footer}
        </div>
      ) : null}
    </motion.div>
  );
}