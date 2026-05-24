'use client';

import { signIn } from 'next-auth/react';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';

function LoginForm() {
  const router = useRouter();
  const search = useSearchParams();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  return (
    <form
        onSubmit={async (event) => {
          event.preventDefault();
          setLoading(true);
          setError(null);
          const result = await signIn('credentials', {
            username,
            password,
            redirect: false
          });
          setLoading(false);
          if (result?.ok) {
            router.push(search.get('callbackUrl') ?? '/');
            router.refresh();
          } else {
            setError('Invalid credentials.');
          }
        }}
        className="login-card relative z-10 w-full max-w-md"
        dir="ltr"
      >
        <div className="relative z-10 flex items-center gap-3">
          <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-white/10 p-1 ring-1 ring-white/15">
            <Image src="/favicon.svg" alt="Smart Nigraan" fill sizes="48px" className="object-contain" priority />
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.32em] text-amber-200/80">Smart Nigraan</p>
            <h1>Campaign Staff Login</h1>
          </div>
        </div>
        <p className="relative z-10 mt-2 text-sm text-slate-200/80">Authorized access only.</p>

        <label className="relative z-10 mt-5 block text-sm font-semibold">Username</label>
        <input
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          className="relative z-10 mt-1 w-full rounded-xl px-3 py-2 outline-none"
          autoComplete="username"
          required
        />

        <label className="relative z-10 mt-4 block text-sm font-semibold">Password</label>
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="relative z-10 mt-1 w-full rounded-xl px-3 py-2 outline-none"
          autoComplete="current-password"
          required
        />

        {error ? <p className="relative z-10 mt-3 text-sm font-semibold text-rose-300">{error}</p> : null}

        <button
          type="submit"
          disabled={loading}
          className="relative z-10 mt-6 w-full rounded-xl bg-amber-400 px-4 py-3 font-bold text-slate-900 shadow-lg shadow-amber-500/20 transition hover:bg-amber-300 disabled:opacity-60"
        >
          {loading ? 'Signing in…' : 'Sign in'}
        </button>

        <p className="relative z-10 mt-5 text-[11px] uppercase tracking-[0.2em] text-slate-300/60">
          Secure Electoral Intelligence Platform
        </p>
      </form>
  );
}

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Suspense fallback={<div className="panel p-6">Loading…</div>}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
