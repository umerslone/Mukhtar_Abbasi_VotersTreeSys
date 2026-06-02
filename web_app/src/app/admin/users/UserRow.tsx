'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  updateUserRole,
  toggleUserActive,
  resetUserPassword,
  deleteUser,
} from './actions';
import type { Role } from '@/lib/permissions';

interface UserRow {
  id: string;
  username: string;
  role: Role;
  active: boolean;
  last_login_at: Date | null;
  created_at: Date;
  isSelf: boolean;
}

export function UserRow({ user }: { user: UserRow }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [resetValue, setResetValue] = useState('');

  function call(fn: () => Promise<void>) {
    setError(null);
    startTransition(async () => {
      try {
        await fn();
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Operation failed.');
      }
    });
  }

  return (
    <tr className="border-b border-slate-200 last:border-b-0">
      <td className="px-3 py-3 text-sm font-semibold text-slate-900">
        {user.username}
        {user.isSelf && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-800">you</span>}
      </td>
      <td className="px-3 py-3">
        <select
          className="rounded-md border border-slate-300 px-2 py-1 text-sm"
          defaultValue={user.role}
          disabled={isPending || user.isSelf}
          onChange={(e) => call(() => updateUserRole(user.id, e.target.value as Role))}
        >
          <option value="VIEWER">VIEWER</option>
          <option value="EDITOR">EDITOR</option>
          <option value="ADMIN">ADMIN</option>
        </select>
      </td>
      <td className="px-3 py-3">
        <button
          type="button"
          disabled={isPending || user.isSelf}
          onClick={() => call(() => toggleUserActive(user.id))}
          className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider ${
            user.active
              ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
              : 'bg-slate-200 text-slate-600 hover:bg-slate-300'
          } disabled:cursor-not-allowed disabled:opacity-50`}
        >
          {user.active ? 'Active' : 'Disabled'}
        </button>
      </td>
      <td className="px-3 py-3 text-xs text-slate-500">
        {user.last_login_at ? new Date(user.last_login_at).toLocaleString() : '—'}
      </td>
      <td className="px-3 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="password"
            placeholder="New password"
            className="w-40 rounded-md border border-slate-300 px-2 py-1 text-sm"
            value={resetValue}
            onChange={(e) => setResetValue(e.target.value)}
          />
          <button
            type="button"
            disabled={isPending || resetValue.length < 8}
            onClick={() =>
              call(async () => {
                await resetUserPassword(user.id, resetValue);
                setResetValue('');
              })
            }
            className="rounded-md border border-slate-300 px-3 py-1 text-xs font-semibold hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Reset
          </button>
          {!user.isSelf && (
            <button
              type="button"
              disabled={isPending}
              onClick={() => {
                if (!confirm(`Delete user "${user.username}"? This cannot be undone.`)) return;
                call(() => deleteUser(user.id));
              }}
              className="rounded-md border border-red-300 px-3 py-1 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Delete
            </button>
          )}
        </div>
        {error && <div className="mt-1 text-xs text-red-700">{error}</div>}
      </td>
    </tr>
  );
}
