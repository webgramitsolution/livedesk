import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { lovable } from '@/integrations/lovable/index';
import { motion } from 'framer-motion';
import { Mail, Lock, Eye, EyeOff, Shield, Video, Monitor, MousePointerClick, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { getPendingMeetingCode } from '@/lib/meetingInvite';

type Mode = 'login' | 'signup' | 'forgot';

/** Map provider errors to user-facing copy; never expose backend internals. */
function friendlyAuthError(err: { message?: string; status?: number } | null, mode: Mode): string {
  const message = (err?.message ?? '').toLowerCase();
  if (!message && !err) return 'Something went wrong. Please try again.';
  if (message.includes('fetch') || message.includes('network') || message.includes('failed to fetch')) {
    return 'Connection failed. Please check your internet connection and try again.';
  }
  if (message.includes('invalid login') || message.includes('invalid credentials') || message.includes('invalid email or password')) {
    return 'Unable to sign in. Check your email and password and try again.';
  }
  if (message.includes('email not confirmed')) return 'Please confirm your email address first. Check your inbox for the confirmation link.';
  if (message.includes('already registered') || message.includes('already exists')) return 'An account with this email already exists. Try signing in instead.';
  if (message.includes('password') && message.includes('at least')) return 'Password must be at least 6 characters.';
  if (message.includes('rate limit') || err?.status === 429) return 'Too many attempts. Please wait a moment and try again.';
  if (message.includes('valid email')) return 'Enter a valid email address.';
  return mode === 'login' ? 'Unable to sign in. Please try again.' : 'The request could not be completed. Please try again.';
}

export default function Auth() {
  const pendingMeetingCode = getPendingMeetingCode();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const rawRedirect = searchParams.get('redirect') || '/app';
  // Prevent redirect loops: if redirect points back to /auth, go to the workspace.
  const redirectPath = rawRedirect.startsWith('/auth') || rawRedirect === '/' ? '/app' : rawRedirect;
  // Meeting context is preserved through login so the user lands in the join flow.
  const resolvedRedirectPath = pendingMeetingCode && redirectPath === '/app'
    ? `/app?meeting=${encodeURIComponent(pendingMeetingCode)}`
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
    setError(null);
    try {
      if (mode === 'forgot') {
        const { error: err } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset-password` });
        if (err) setError(friendlyAuthError(err, mode));
        else toast.success('Check your email for a password reset link');
        return;
      }
      if (mode === 'login') {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) setError(friendlyAuthError(err, mode));
        else toast.success('Welcome back!');
      } else {
        const { error: err } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: `${window.location.origin}${resolvedRedirectPath}` } });
        if (err) setError(friendlyAuthError(err, mode));
        else toast.success('Check your email to confirm your account');
      }
    } catch (err) {
      setError(friendlyAuthError(err as { message?: string }, mode));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError(null);
    try {
      const { error: err } = await lovable.auth.signInWithOAuth('google', { redirect_uri: `${window.location.origin}${resolvedRedirectPath}` });
      if (err) setError('Google sign-in could not be started. Please try again.');
    } catch {
      setError('Google sign-in could not be started. Please try again.');
    }
  };

  const heading = mode === 'login' ? 'Welcome back' : mode === 'signup' ? 'Create your account' : 'Reset your password';
  const subheading = mode === 'login' ? 'Sign in to continue to LiveDesk.' : mode === 'signup' ? 'Start meeting, sharing and supporting in minutes.' : 'We will email you a link to set a new password.';

  return (
    <div className="min-h-dvh bg-background lg:grid lg:grid-cols-2">
      {/* Product visual (desktop only) */}
      <aside className="relative hidden overflow-hidden bg-[#070b1a] p-10 text-white lg:flex lg:flex-col lg:justify-between" aria-hidden="true">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_60%_at_70%_20%,rgba(99,102,241,0.35),transparent_60%),radial-gradient(40%_40%_at_10%_80%,rgba(168,85,247,0.25),transparent_60%)]" />
        <Link to="/" className="relative flex items-center gap-2 font-display text-lg font-bold"><img src="/logo.png" alt="" className="h-8 w-8 rounded-lg" /> LiveDesk</Link>
        <div className="relative">
          <h2 className="font-display text-4xl font-bold leading-tight">Meet.<br />Collaborate.<br />Control.</h2>
          <ul className="mt-8 space-y-3 text-white/75">
            <li className="flex items-center gap-3"><Video className="h-5 w-5 text-sky-300" /> Live meetings with crystal-clear voice</li>
            <li className="flex items-center gap-3"><Monitor className="h-5 w-5 text-emerald-300" /> Screen sharing with collaborative annotation</li>
            <li className="flex items-center gap-3"><MousePointerClick className="h-5 w-5 text-orange-300" /> Secure, permission-based remote support</li>
          </ul>
        </div>
        <p className="relative text-xs text-white/40">Meetings are temporary sessions. Nothing is archived unless you record locally.</p>
      </aside>

      {/* Authentication card */}
      <main className="flex items-center justify-center p-4 sm:p-8">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-sm space-y-6">
          <div className="text-center lg:text-left">
            <Link to="/" className="mb-4 inline-flex items-center gap-2 lg:hidden">
              <img src="/logo.png" alt="LiveDesk" className="h-9 w-9 rounded-xl" />
              <span className="font-display text-xl font-bold text-foreground">LiveDesk</span>
            </Link>
            <h1 className="font-display text-2xl font-bold text-foreground">{heading}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{subheading}</p>
          </div>

          {pendingMeetingCode && (
            <div className="rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3 text-left">
              <p className="font-display text-sm font-bold text-foreground">Invite link detected</p>
              <p className="mt-1 text-xs text-muted-foreground">Sign in once and you will continue straight to the meeting.</p>
              <p className="mt-2 font-mono text-xs text-primary">{pendingMeetingCode}</p>
            </div>
          )}

          {error && (
            <div role="alert" className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive" data-testid="auth-error">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div>
              <label htmlFor="email" className="mb-1 block text-xs font-semibold text-foreground">Work email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <Input id="email" name="email" type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Enter your email" className="pl-10" required />
              </div>
            </div>
            {mode !== 'forgot' && (
              <div>
                <label htmlFor="password" className="mb-1 block text-xs font-semibold text-foreground">Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  <Input
                    id="password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyUp={(e) => setCapsLock(typeof e.getModifierState === 'function' && e.getModifierState('CapsLock'))}
                    placeholder="Enter your password"
                    className="pl-10 pr-10"
                    required
                    minLength={6}
                  />
                  <button type="button" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? 'Hide password' : 'Show password'} className="absolute right-3 top-3 text-muted-foreground">
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {capsLock && <p className="mt-1 text-xs text-amber-600">Caps Lock is on.</p>}
              </div>
            )}

            {mode === 'login' && (
              <button type="button" onClick={() => { setMode('forgot'); setError(null); }} className="w-full text-right text-xs text-primary hover:underline">
                Forgot password?
              </button>
            )}

            <Button type="submit" className="w-full" disabled={loading} data-testid="auth-submit">
              {loading ? (mode === 'login' ? 'Signing in...' : 'Please wait...') : mode === 'login' ? 'Sign In' : mode === 'signup' ? 'Create account' : 'Send reset link'}
            </Button>
          </form>

          {mode !== 'forgot' && (
            <>
              <div className="relative flex items-center gap-4">
                <div className="h-px flex-1 bg-border" />
                <span className="text-xs text-muted-foreground">OR</span>
                <div className="h-px flex-1 bg-border" />
              </div>
              <Button variant="outline" className="w-full gap-2" onClick={handleGoogleSignIn} type="button">
                <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
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
            {mode === 'login' && (<>Don&apos;t have an account?{' '}<button onClick={() => { setMode('signup'); setError(null); }} className="font-medium text-primary hover:underline">Create account</button></>)}
            {mode === 'signup' && (<>Already have an account?{' '}<button onClick={() => { setMode('login'); setError(null); }} className="font-medium text-primary hover:underline">Sign In</button></>)}
            {mode === 'forgot' && (<>Remember your password?{' '}<button onClick={() => { setMode('login'); setError(null); }} className="font-medium text-primary hover:underline">Sign In</button></>)}
          </p>

          <div className="flex items-center justify-center gap-1 text-xs text-muted-foreground">
            <Shield className="h-3.5 w-3.5 text-success" />
            <span>Signing in does not grant access to any meeting; each meeting is authorised separately.</span>
          </div>
        </motion.div>
      </main>
    </div>
  );
}
