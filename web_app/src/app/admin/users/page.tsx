import Link from 'next/link';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/permissions';
import { CreateUserForm } from './CreateUserForm';
import { UserRow } from './UserRow';

export const dynamic = 'force-dynamic';

export default async function AdminUsersPage() {
  const me = await getCurrentUser();
  if (!me) redirect('/login');
  if (me.role !== 'ADMIN') redirect('/');

  const users = await prisma.user.findMany({
    orderBy: [{ active: 'desc' }, { username: 'asc' }],
    select: {
      id: true,
      username: true,
      role: true,
      active: true,
      last_login_at: true,
      created_at: true,
    },
  });

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-5">
      <header className="panel flex items-center justify-between p-5">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.32em] text-slate-500">Administration</p>
          <h1 className="mt-1 text-2xl font-black text-slate-900">User accounts</h1>
          <p className="mt-1 text-sm text-slate-600">Add staff, change roles, reset passwords. ADMINs see everything; EDITORs can edit voters; VIEWERs are read-only.</p>
        </div>
        <Link
          href="/"
          className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-slate-50"
        >
          Back to Dashboard
        </Link>
      </header>

      <CreateUserForm />

      <div className="panel overflow-x-auto">
        <table className="w-full text-left">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="px-3 py-2 text-xs font-bold uppercase tracking-wider text-slate-600">Username</th>
              <th className="px-3 py-2 text-xs font-bold uppercase tracking-wider text-slate-600">Role</th>
              <th className="px-3 py-2 text-xs font-bold uppercase tracking-wider text-slate-600">Status</th>
              <th className="px-3 py-2 text-xs font-bold uppercase tracking-wider text-slate-600">Last login</th>
              <th className="px-3 py-2 text-xs font-bold uppercase tracking-wider text-slate-600">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <UserRow
                key={u.id}
                user={{
                  id: u.id,
                  username: u.username,
                  role: u.role,
                  active: u.active,
                  last_login_at: u.last_login_at,
                  created_at: u.created_at,
                  isSelf: u.id === me.id,
                }}
              />
            ))}
            {users.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-sm text-slate-500">
                  No users yet — add one above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
