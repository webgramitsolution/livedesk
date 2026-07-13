import { X, Copy, Check, Link as LinkIcon, Mail, MessageCircle, Send, ArrowLeft, QrCode, Smartphone } from 'lucide-react';
import { useMeetingStore } from '@/store/meetingStore';
import { motion, AnimatePresence } from 'framer-motion';
import { useState } from 'react';
import { buildMeetingLink } from '@/lib/meetingInvite';
import { usePanelOverlayMode } from '@/hooks/use-mobile';

export function InviteModal() {
  const { showInvite, toggleInvite, meetingId } = useMeetingStore();
  const [copied, setCopied] = useState<'id' | 'link' | null>(null);
  const mode = usePanelOverlayMode();

  const meetingLink = buildMeetingLink(meetingId);
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&margin=0&data=${encodeURIComponent(meetingLink)}`;

  const handleCopy = (text: string, type: 'id' | 'link') => {
    navigator.clipboard.writeText(text);
    setCopied(type);
    setTimeout(() => setCopied(null), 2000);
  };

  const handleWhatsAppShare = () => {
    const message = encodeURIComponent(`Join my meeting directly: ${meetingLink}\nBackup Meeting ID: ${meetingId}`);
    const isMobileDevice = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    const url = isMobileDevice
      ? `whatsapp://send?text=${message}`
      : `https://web.whatsapp.com/send?text=${message}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleTelegramShare = () => {
    const text = encodeURIComponent(`Join my meeting: ${meetingLink}`);
    window.open(`https://t.me/share/url?url=${encodeURIComponent(meetingLink)}&text=${text}`, '_blank', 'noopener,noreferrer');
  };

  const handleEmailShare = () => {
    window.open(
      `mailto:?subject=Join my Zoom Connect meeting&body=Direct join link: ${meetingLink}%0A%0ABackup Meeting ID: ${meetingId}`
    );
  };

  const handleSmsShare = () => {
    const body = encodeURIComponent(`Join my meeting: ${meetingLink}`);
    window.open(`sms:?&body=${body}`);
  };

  const shareOptions = [
    { icon: MessageCircle, label: 'WhatsApp', bg: 'bg-emerald-500', onClick: handleWhatsAppShare },
    { icon: Send, label: 'Telegram', bg: 'bg-sky-500', onClick: handleTelegramShare },
    { icon: Mail, label: 'Email', bg: 'bg-rose-500', onClick: handleEmailShare },
    { icon: LinkIcon, label: 'Copy Link', bg: 'bg-primary', onClick: () => handleCopy(meetingLink, 'link') },
    { icon: Smartphone, label: 'SMS', bg: 'bg-violet-500', onClick: handleSmsShare },
  ];

  // Shared body content
  const Body = (
    <div className="flex-1 overflow-y-auto">
      <div className="px-5 py-5 space-y-5">
        {/* Direct Join Link */}
        <section>
          <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 block">Direct Join Link</label>
          <div className="flex gap-2">
            <div className="flex-1 min-w-0 px-4 h-12 flex items-center rounded-xl border border-input bg-secondary/50 text-sm text-foreground truncate">
              {meetingLink}
            </div>
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={() => handleCopy(meetingLink, 'link')}
              className={`h-12 min-w-[64px] px-4 rounded-xl border transition-colors flex items-center justify-center gap-1.5 text-sm font-semibold ${
                copied === 'link' ? 'border-success bg-success/10 text-success' : 'border-border hover:bg-muted text-foreground'
              }`}
            >
              {copied === 'link' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copied === 'link' ? 'Copied' : 'Copy'}
            </motion.button>
          </div>
        </section>

        {/* Meeting ID */}
        <section>
          <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 block">Meeting ID</label>
          <div className="flex gap-2">
            <div className="flex-1 min-w-0 px-4 h-12 flex items-center rounded-xl border border-input bg-secondary/50 font-mono text-sm text-foreground">
              {meetingId}
            </div>
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={() => handleCopy(meetingId, 'id')}
              className={`h-12 min-w-[64px] px-4 rounded-xl border transition-colors flex items-center justify-center gap-1.5 text-sm font-semibold ${
                copied === 'id' ? 'border-success bg-success/10 text-success' : 'border-border hover:bg-muted text-foreground'
              }`}
            >
              {copied === 'id' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copied === 'id' ? 'Copied' : 'Copy'}
            </motion.button>
          </div>
        </section>

        {/* QR code */}
        <section>
          <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
            <QrCode className="w-3.5 h-3.5" /> Scan to join
          </label>
          <div className="flex items-center justify-center rounded-2xl border border-border bg-secondary/30 p-5">
            <img
              src={qrSrc}
              alt={`QR code for ${meetingLink}`}
              className="w-44 h-44 rounded-lg bg-white p-2"
              loading="lazy"
            />
          </div>
        </section>

        {/* Share via */}
        <section>
          <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3 block">Share via</label>
          <div className="grid grid-cols-4 gap-3 sm:grid-cols-5">
            {shareOptions.map((opt) => (
              <motion.button
                key={opt.label}
                whileTap={{ scale: 0.94 }}
                onClick={opt.onClick}
                className="flex flex-col items-center gap-2 rounded-2xl p-2 hover:bg-muted transition-colors"
              >
                <span className={`flex h-12 w-12 items-center justify-center rounded-2xl text-white ${opt.bg}`}>
                  <opt.icon className="w-5 h-5" />
                </span>
                <span className="text-[11px] font-medium text-foreground leading-tight text-center">{opt.label}</span>
              </motion.button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );

  return (
    <AnimatePresence>
      {showInvite && (
        <>
          {/* Backdrop (desktop + tablet only) */}
          {mode !== 'mobile' && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={toggleInvite}
              className="fixed inset-0 bg-foreground/30 backdrop-blur-sm z-50"
            />
          )}

          {mode === 'mobile' ? (
            /* MOBILE: full-screen page */
            <motion.div
              key="invite-mobile"
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              className="fixed inset-0 z-[60] bg-background flex flex-col"
              style={{
                paddingTop: 'env(safe-area-inset-top)',
                paddingBottom: 'env(safe-area-inset-bottom)',
              }}
              role="dialog"
              aria-label="Invite participants"
            >
              {/* Sticky header */}
              <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-background/95 px-3 py-3 backdrop-blur-sm">
                <button
                  onClick={toggleInvite}
                  className="w-11 h-11 rounded-full flex items-center justify-center hover:bg-muted transition-colors text-foreground"
                  aria-label="Back"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <div className="flex flex-col leading-tight">
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Invite Participants</span>
                  <h2 className="font-display font-bold text-foreground text-lg">Share Meeting</h2>
                </div>
              </div>

              {Body}

              {/* Sticky bottom action */}
              <div
                className="sticky bottom-0 border-t border-border bg-background/95 px-4 py-3 backdrop-blur-sm"
                style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
              >
                <button
                  onClick={toggleInvite}
                  className="w-full h-12 rounded-2xl bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 transition-colors"
                >
                  Close
                </button>
              </div>
            </motion.div>
          ) : mode === 'tablet' ? (
            /* TABLET: right side sheet */
            <motion.div
              key="invite-tablet"
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 280 }}
              className="fixed inset-y-0 right-0 z-[60] w-[90vw] max-w-[440px] bg-background border-l border-border shadow-2xl flex flex-col"
              role="dialog"
              aria-label="Invite participants"
            >
              <div className="flex items-center justify-between border-b border-border px-5 py-4">
                <div className="flex items-center gap-2">
                  <LinkIcon className="w-5 h-5 text-primary" />
                  <h2 className="font-display font-bold text-foreground text-lg">Invite Participants</h2>
                </div>
                <button
                  onClick={toggleInvite}
                  className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-muted transition-colors text-muted-foreground"
                  aria-label="Close"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              {Body}
            </motion.div>
          ) : (
            /* DESKTOP: centered dialog */
            <motion.div
              key="invite-desktop"
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[90vw] max-w-md max-h-[85vh] bg-background rounded-2xl border border-border control-bar-elevated z-[60] flex flex-col overflow-hidden"
              role="dialog"
              aria-label="Invite participants"
            >
              <div className="flex items-center justify-between border-b border-border px-5 py-4">
                <div className="flex items-center gap-2">
                  <LinkIcon className="w-5 h-5 text-primary" />
                  <h2 className="font-display font-bold text-foreground text-lg">Invite Participants</h2>
                </div>
                <button
                  onClick={toggleInvite}
                  className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-muted transition-colors text-muted-foreground"
                  aria-label="Close"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              {Body}
            </motion.div>
          )}
        </>
      )}
    </AnimatePresence>
  );
}
