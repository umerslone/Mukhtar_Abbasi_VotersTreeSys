'use client';

import { useState, type ReactNode } from 'react';

/**
 * Two-tab switcher used by /family-lookup to flip between the
 * hierarchical tree view and the sectioned list view, mirroring
 * the Streamlit reference's `st.tabs(["🌳 Tree view", "📋 List view"])`.
 */
export function FamilyLookupTabs({
  tree,
  list,
}: Readonly<{ tree: ReactNode; list: ReactNode }>) {
  const [tab, setTab] = useState<'tree' | 'list'>('tree');

  const pill = (active: boolean) =>
    `rounded-full border px-4 py-1.5 text-sm font-semibold transition ${
      active
        ? 'border-indigo-700 bg-indigo-50 text-indigo-800'
        : 'border-slate-300 text-slate-600 hover:bg-slate-100'
    }`;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'tree'} className={pill(tab === 'tree')} onClick={() => setTab('tree')}>
          🌳 Tree view
        </button>
        <button type="button" role="tab" aria-selected={tab === 'list'} className={pill(tab === 'list')} onClick={() => setTab('list')}>
          📋 List view
        </button>
      </div>
      <div role="tabpanel">{tab === 'tree' ? tree : list}</div>
    </div>
  );
}
