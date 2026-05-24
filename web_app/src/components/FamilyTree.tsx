'use client';

import { useState } from 'react';
import type { FamilyGroup, VoterRow } from '@/lib/types';
import { TagModal, VoterTagButton } from './VoterTag';

function chooseHead(members: VoterRow[]): VoterRow {
  const names = new Set(members.map((member) => member.name.trim().toLowerCase()));
  const head = members.find((member) => !names.has(member.father_husband_name.trim().toLowerCase()));
  return head ?? members[0];
}

export function FamilyTree({ families }: Readonly<{ families: FamilyGroup[] }>) {
  const [selected, setSelected] = useState<VoterRow | null>(null);

  if (!families.length) {
    return <div className="panel p-6 text-center text-slate-500">No voters match your filters.</div>;
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {families.map((family) => {
        const head = chooseHead(family.members);
        const others = family.members.filter((m) => m.id !== head.id);
        return (
          <div key={family.inferred_family_id} className="panel p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.24em] text-slate-500">{family.block_code}</p>
                <h3 className="urdu rtl mt-1 text-lg font-black text-slate-900">{family.address}</h3>
              </div>
              <span className="rounded-full bg-slate-900 px-3 py-1 text-xs font-bold text-white">
                {family.members.length} voters
              </span>
            </div>

            <div className="mt-4 space-y-2">
              <VoterTagButton voter={head} onSelect={setSelected} showHead />
              {others.map((member) => (
                <VoterTagButton key={member.id} voter={member} onSelect={setSelected} />
              ))}
            </div>
          </div>
        );
      })}

      <TagModal voter={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
