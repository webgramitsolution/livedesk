import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { lovable } from '@/integrations/lovable/index';
import { motion } from 'framer-motion';
import { Mail, Lock, Eye, EyeOff, Shield, Video } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { getPendingMeetingCode } from '@/lib/meetingInvite';

export default function Auth() {
  const pendingMeetingCode = getPendingMeetingCode();
  const [mode, setMode] = useState<'login' | 'signup' | 'forgot'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const rawRedirect = searchParams.get('redirect') || '/';
  // Prevent redirect loops: if redirect points back to /auth, go to /
  const redirectPath = rawRedirect.startsWith('/auth') ? '/' : rawRedirect;
  const resolvedRedirectPath = pendingMeetingCode && redirectPath === '/'
    ? `/?meeting=${encodeURIComponent(pendingMeetingCode)}`
    : redirectPath;

  useEffect(() => {
    const { data: subscription } = supabase.auth.onAuthStateChange((_, session) => {
      if (session) navigate(resolvedRedirectPath);
    });
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) navigate(resolvedRedirectPath);
    });
    return () => subscription.subscription.unsubscribe();
  }, [navigate, resolvedRedirectPath]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    if (mode === 'forgot') {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) toast.error(error.message);
      else toast.success('Check your email for a password reset link');
      setLoading(false);
      return;
    }

    if (mode === 'login') {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) toast.error(error.message);
      else toast.success('Welcome back!');
    } else {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${window.location.origin}${resolvedRedirectPath}` },
      });
      if (error) toast.error(error.message);
      else toast.success('Check your email to confirm your account');
    }
    setLoading(false);
  };

  const handleGoogleSignIn = async () => {
    const { error } = await lovable.auth.signInWithOAuth('google', {
      redirect_uri: `${window.location.origin}${resolvedRedirectPath}`,
    });
    if (error) toast.error(error instanceof Error ? error.message : 'Google sign-in failed');
  };

  return (
    <div className="h-screen flex items-center justify-center bg-background p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm space-y-6"
      >
        <div className="text-center">
          <div className="flex items-center gap-2 justify-center mb-3">
            <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
              <Video className="w-5 h-5 text-primary-foreground" />
            </div>
            <h1 className="font-display font-bold text-2xl text-foreground">Zoom Connect</h1>
          </div>
          <p className="text-muted-foreground text-sm">
            {mode === 'login' && 'Sign in to your account'}
            {mode === 'signup' && 'Create a new account'}
            {mode === 'forgot' && 'Reset your password'}
          </p>
        </div>

        {pendingMeetingCode && (
          <div className="rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3 text-left">
            <p className="font-display text-sm font-bold text-foreground">Invite link detected</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Sign in once and you&apos;ll join directly on mobile or desktop. Meeting ID is only a backup.
            </p>
            <p className="mt-2 font-mono text-xs text-primary">{pendingMeetingCode}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="relative">
            <Mail className="absolute left-3 top-3 w-4 h-4 text-muted-foreground" />
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email address"
              className="pl-10"
              required
            />
          </div>
          {mode !== 'forgot' && (
            <div className="relative">
              <Lock className="absolute left-3 top-3 w-4 h-4 text-muted-foreground" />
              <Input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                className="pl-10 pr-10"
                required
                minLength={6}
              />
              <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-3 text-muted-foreground">
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          )}

          {mode === 'login' && (
            <button type="button" onClick={() => setMode('forgot')} className="text-xs text-primary hover:underline w-full text-right">
              Forgot password?
            </button>
          )}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'Please wait...' : mode === 'login' ? 'Sign In' : mode === 'signup' ? 'Sign Up' : 'Send Reset Link'}
          </Button>
        </form>

        {mode !== 'forgot' && (
          <>
            <div className="relative flex items-center gap-4">
              <div className="flex-1 h-px bg-border" />
              <span className="text-xs text-muted-foreground">or</span>
              <div className="flex-1 h-px bg-border" />
            </div>

            <Button
              variant="outline"
              className="w-full gap-2"
              onClick={handleGoogleSignIn}
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
              Continue with Google
            </Button>
          </>
        )}

        <p className="text-center text-sm text-muted-foreground">
          {mode === 'login' && (
            <>Don't have an account?{' '}
              <button onClick={() => setMode('signup')} className="text-primary font-medium hover:underline">Sign Up</button>
            </>
          )}
          {mode === 'signup' && (
            <>Already have an account?{' '}
              <button onClick={() => setMode('login')} className="text-primary font-medium hover:underline">Sign In</button>
            </>
          )}
          {mode === 'forgot' && (
            <>Remember your password?{' '}
              <button onClick={() => setMode('login')} className="text-primary font-medium hover:underline">Sign In</button>
            </>
          )}
        </p>

        <div className="flex items-center justify-center gap-1 text-xs text-muted-foreground">
          <Shield className="w-3.5 h-3.5 text-success" />
          <span>E2E Encrypted</span>
        </div>
      </motion.div>
    </div>
  );
}
