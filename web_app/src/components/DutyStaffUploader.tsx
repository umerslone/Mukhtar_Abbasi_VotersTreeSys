'use client';

import { useState, useTransition } from 'react';
import { matchDutyStaff } from '@/app/actions';

export function DutyStaffUploader() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);

  return (
    <section className="panel p-5">
      <p className="text-sm text-slate-600">
        Upload an XLSX with at least <code>cnic</code>, <code>name</code>, and <code>father_husband_name</code> columns. Matches are flagged with <code>is_on_duty = true</code>.
      </p>
      <form
        className="mt-4 flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          const formElement = event.currentTarget;
          const formData = new FormData(formElement);
          startTransition(async () => {
            const response = await matchDutyStaff(formData);
            setResult(`Processed ${response.totalRows} rows, flagged ${response.matched} voters.`);
            formElement.reset();
          });
        }}
      >
        <input
          type="file"
          name="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          required
          className="rounded-xl border border-slate-300 px-3 py-2"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-xl bg-slate-900 px-4 py-2 font-semibold text-white disabled:opacity-60"
        >
          {pending ? 'Matching…' : 'Run waterfall match'}
        </button>
      </form>
      {result ? <p className="mt-4 rounded-xl bg-emerald-100 px-4 py-2 text-sm font-semibold text-emerald-900">{result}</p> : null}
    </section>
  );
}
