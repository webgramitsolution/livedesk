import { X, Copy, Check, Link, Mail, Share2, MessageCircle } from 'lucide-react';
import { useMeetingStore } from '@/store/meetingStore';
import { motion, AnimatePresence } from 'framer-motion';
import { useState } from 'react';
import { buildMeetingLink } from '@/lib/meetingInvite';

export function InviteModal() {
  const { showInvite, toggleInvite, meetingId } = useMeetingStore();
  const [copied, setCopied] = useState<'id' | 'link' | null>(null);

  const meetingLink = buildMeetingLink(meetingId);

  const handleCopy = (text: string, type: 'id' | 'link') => {
    navigator.clipboard.writeText(text);
    setCopied(type);
    setTimeout(() => setCopied(null), 2000);
  };

  const handleNativeShare = async () => {
    const shareText = `Join my meeting directly: ${meetingLink}\nBackup Meeting ID: ${meetingId}`;

    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Join my Zoom Connect meeting',
          text: shareText,
          url: meetingLink,
        });
        return;
      } catch {
        return;
      }
    }

    handleCopy(meetingLink, 'link');
  };

  const handleWhatsAppShare = () => {
    const message = encodeURIComponent(`Join my meeting directly: ${meetingLink}\nBackup Meeting ID: ${meetingId}`);
    const isMobileDevice = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    const url = isMobileDevice
      ? `whatsapp://send?text=${message}`
      : `https://web.whatsapp.com/send?text=${message}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <AnimatePresence>
      {showInvite && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={toggleInvite}
            className="fixed inset-0 bg-foreground/20 backdrop-blur-sm z-50"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[90vw] max-w-md bg-background rounded-2xl border border-border control-bar-elevated z-50 flex flex-col overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between p-5 border-b border-border">
              <div className="flex items-center gap-2">
                <Link className="w-5 h-5 text-primary" />
                <h2 className="font-display font-bold text-foreground text-lg">Invite Participants</h2>
              </div>
              <button
                onClick={toggleInvite}
                className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-muted transition-colors text-muted-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content */}
            <div className="p-5 space-y-4">
              {/* Meeting Link */}
              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 block">Direct Join Link</label>
                <p className="mb-2 text-xs text-muted-foreground">Best for mobile — open the link, sign in, and join directly.</p>
                <div className="flex gap-2">
                  <div className="flex-1 px-4 py-2.5 rounded-xl border border-input bg-secondary/50 text-sm text-foreground truncate">
                    {meetingLink}
                  </div>
                  <motion.button
                    whileTap={{ scale: 0.95 }}
                    onClick={() => handleCopy(meetingLink, 'link')}
                    className={`px-3 rounded-xl border transition-colors flex items-center gap-1.5 text-sm font-medium ${
                      copied === 'link'
                        ? 'border-success bg-success/10 text-success'
                        : 'border-border hover:bg-muted text-foreground'
                    }`}
                  >
                    {copied === 'link' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    {copied === 'link' ? 'Copied' : 'Copy'}
                  </motion.button>
                </div>
              </div>

              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 block">Backup Meeting ID</label>
                <div className="flex gap-2">
                  <div className="flex-1 px-4 py-2.5 rounded-xl border border-input bg-secondary/50 font-mono text-sm text-foreground">
                    {meetingId}
                  </div>
                  <motion.button
                    whileTap={{ scale: 0.95 }}
                    onClick={() => handleCopy(meetingId, 'id')}
                    className={`px-3 rounded-xl border transition-colors flex items-center gap-1.5 text-sm font-medium ${
                      copied === 'id'
                        ? 'border-success bg-success/10 text-success'
                        : 'border-border hover:bg-muted text-foreground'
                    }`}
                  >
                    {copied === 'id' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    {copied === 'id' ? 'Copied' : 'Copy'}
                  </motion.button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <motion.button
                  whileTap={{ scale: 0.98 }}
                  onClick={handleNativeShare}
                  className="w-full py-2.5 rounded-xl border border-border text-foreground font-display font-bold text-sm hover:bg-muted transition-colors flex items-center justify-center gap-2"
                >
                  <Share2 className="w-4 h-4" />
                  Share Link
                </motion.button>
                <motion.button
                  whileTap={{ scale: 0.98 }}
                  onClick={handleWhatsAppShare}
                  className="w-full py-2.5 rounded-xl border border-border text-foreground font-display font-bold text-sm hover:bg-muted transition-colors flex items-center justify-center gap-2"
                >
                  <MessageCircle className="w-4 h-4" />
                  WhatsApp
                </motion.button>
              </div>

              {/* Email invite */}
              <motion.button
                whileTap={{ scale: 0.98 }}
                onClick={() => {
                  window.open(`mailto:?subject=Join my Zoom Connect meeting&body=Direct join link: ${meetingLink}%0A%0ABackup Meeting ID: ${meetingId}%0A%0AOpen the link, sign in, and you will join directly.`);
                }}
                className="w-full py-2.5 rounded-xl border border-border text-foreground font-display font-bold text-sm hover:bg-muted transition-colors flex items-center justify-center gap-2"
              >
                <Mail className="w-4 h-4" />
                Send Email Invite
              </motion.button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
