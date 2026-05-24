'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';

const STATUS_OPTIONS = ['all', 'Supporter', 'Non-Supporter', 'Undecided', 'Unsurveyed'];

export function DashboardFilters({ initialQuery, initialStatus }: Readonly<{ initialQuery: string; initialStatus: string }>) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(initialQuery);
  const [status, setStatus] = useState(initialStatus);
  const [, startTransition] = useTransition();

  function pushState(nextQuery: string, nextStatus: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (nextQuery) {
      params.set('q', nextQuery);
    } else {
      params.delete('q');
    }
    if (nextStatus && nextStatus !== 'all') {
      params.set('status', nextStatus);
    } else {
      params.delete('status');
    }
    startTransition(() => {
      router.push(`/?${params.toString()}`);
    });
  }

  return (
    <section className="panel flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            pushState(query, status);
          }
        }}
        placeholder="Search by CNIC or Name"
        className="w-full flex-1 rounded-xl border border-slate-300 px-4 py-2 outline-none focus:border-slate-900"
      />
      <select
        value={status}
        onChange={(event) => {
          setStatus(event.target.value);
          pushState(query, event.target.value);
        }}
        className="rounded-xl border border-slate-300 px-3 py-2 font-semibold"
      >
        {STATUS_OPTIONS.map((option) => (
          <option key={option} value={option}>
            {option === 'all' ? 'All sentiments' : option}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => pushState(query, status)}
        className="rounded-xl bg-slate-900 px-4 py-2 font-semibold text-white"
      >
        Search
      </button>
    </section>
  );
}
