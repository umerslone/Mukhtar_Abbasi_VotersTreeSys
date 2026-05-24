import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { DutyStaffUploader } from '@/components/DutyStaffUploader';

export default async function DutyStaffPage() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return null;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-5">
      <header className="panel flex items-center justify-between p-5">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.32em] text-slate-500">Postal-ballot strategy</p>
          <h1 className="mt-1 text-2xl font-black text-slate-900">Duty Staff Matcher</h1>
        </div>
        <Link href="/" className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold">
          Back to Dashboard
        </Link>
      </header>
      <DutyStaffUploader />
    </div>
  );
}
