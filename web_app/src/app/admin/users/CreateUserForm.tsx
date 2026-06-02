'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createUser } from './actions';
import type { Role } from '@/lib/permissions';

export function CreateUserForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function onSubmit(formData: FormData) {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      try {
        await createUser(formData);
        setSuccess(`Created user "${formData.get('username')}".`);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not create user.');
      }
    });
  }

  return (
    <form
      action={onSubmit}
      className="card"
      style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr)) auto', gap: '0.75rem', alignItems: 'end' }}
    >
      <label className="field">
        <span className="field__label">Username</span>
        <input name="username" required minLength={3} maxLength={40} className="ds-input" placeholder="e.g. ali.ahmed" />
      </label>
      <label className="field">
        <span className="field__label">Password</span>
        <input name="password" type="password" required minLength={8} className="ds-input" placeholder="min 8 chars" />
      </label>
      <label className="field">
        <span className="field__label">Role</span>
        <select name="role" defaultValue={'VIEWER' as Role} className="ds-input">
          <option value="VIEWER">VIEWER (read only)</option>
          <option value="EDITOR">EDITOR (can edit voters)</option>
          <option value="ADMIN">ADMIN (full access)</option>
        </select>
      </label>
      <button type="submit" className="btn btn--primary" disabled={isPending}>
        {isPending ? 'Creating…' : 'Add user'}
      </button>
      {error && <div style={{ gridColumn: '1 / -1', color: '#b91c1c' }}>{error}</div>}
      {success && <div style={{ gridColumn: '1 / -1', color: '#15803d' }}>{success}</div>}
    </form>
  );
}
