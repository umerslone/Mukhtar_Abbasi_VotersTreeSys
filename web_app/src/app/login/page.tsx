'use client';

import { signIn } from 'next-auth/react';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

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
        className="panel w-full max-w-md p-6"
        dir="ltr"
      >
        <h1 className="text-2xl font-black text-slate-900">Campaign Staff Login</h1>
        <p className="mt-1 text-sm text-slate-500">Authorized access only.</p>

        <label className="mt-5 block text-sm font-semibold text-slate-700">Username</label>
        <input
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-slate-900"
          autoComplete="username"
          required
        />

        <label className="mt-4 block text-sm font-semibold text-slate-700">Password</label>
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-slate-900"
          autoComplete="current-password"
          required
        />

        {error ? <p className="mt-3 text-sm font-semibold text-rose-600">{error}</p> : null}

        <button
          type="submit"
          disabled={loading}
          className="mt-6 w-full rounded-xl bg-slate-900 px-4 py-3 font-semibold text-white disabled:opacity-60"
        >
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
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
