import { getServerSession } from 'next-auth';
import { authOptions } from './auth';

export type Role = 'ADMIN' | 'EDITOR' | 'VIEWER';

const RANK: Record<Role, number> = { VIEWER: 1, EDITOR: 2, ADMIN: 3 };

export interface CurrentUser {
  id: string;
  username: string;
  role: Role;
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return null;
  return {
    id: session.user.id,
    username: session.user.name ?? '',
    role: (session.user.role ?? 'VIEWER') as Role,
  };
}

export async function requireRole(min: Role): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not authenticated.');
  if (RANK[user.role] < RANK[min]) throw new Error('Forbidden: insufficient role.');
  return user;
}

export function hasRole(user: CurrentUser | null, min: Role): boolean {
  if (!user) return false;
  return RANK[user.role] >= RANK[min];
}
