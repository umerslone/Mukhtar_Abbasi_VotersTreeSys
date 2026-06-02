import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/permissions';
import type { ReactNode } from 'react';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.role !== 'ADMIN') redirect('/');
  return <>{children}</>;
}
