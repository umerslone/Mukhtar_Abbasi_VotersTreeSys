'use server';

import { revalidatePath } from 'next/cache';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { requireRole, type Role } from '@/lib/permissions';

const ROLES: Role[] = ['ADMIN', 'EDITOR', 'VIEWER'];

function isRole(v: unknown): v is Role {
  return typeof v === 'string' && (ROLES as readonly string[]).includes(v);
}

function validatePassword(pw: string): void {
  if (pw.length < 8) throw new Error('Password must be at least 8 characters.');
  if (pw.length > 200) throw new Error('Password is too long.');
}

function validateUsername(u: string): void {
  if (!/^[a-zA-Z0-9._-]{3,40}$/.test(u)) {
    throw new Error('Username must be 3–40 chars: letters, digits, dot, underscore, hyphen.');
  }
}

export async function createUser(formData: FormData): Promise<void> {
  await requireRole('ADMIN');
  const username = String(formData.get('username') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const role = String(formData.get('role') ?? 'VIEWER');

  validateUsername(username);
  validatePassword(password);
  if (!isRole(role)) throw new Error('Invalid role.');

  const exists = await prisma.user.findUnique({ where: { username } });
  if (exists) throw new Error(`User "${username}" already exists.`);

  const password_hash = await bcrypt.hash(password, 10);
  await prisma.user.create({
    data: { username, password_hash, role, active: true },
  });
  revalidatePath('/admin/users');
}

export async function updateUserRole(id: string, role: Role): Promise<void> {
  const me = await requireRole('ADMIN');
  if (!isRole(role)) throw new Error('Invalid role.');

  if (id === me.id && role !== 'ADMIN') {
    throw new Error('You cannot demote yourself.');
  }
  await prisma.user.update({ where: { id }, data: { role } });
  revalidatePath('/admin/users');
}

export async function toggleUserActive(id: string): Promise<void> {
  const me = await requireRole('ADMIN');
  if (id === me.id) throw new Error('You cannot deactivate yourself.');

  const user = await prisma.user.findUnique({ where: { id }, select: { active: true } });
  if (!user) throw new Error('User not found.');
  await prisma.user.update({ where: { id }, data: { active: !user.active } });
  revalidatePath('/admin/users');
}

export async function resetUserPassword(id: string, newPassword: string): Promise<void> {
  await requireRole('ADMIN');
  validatePassword(newPassword);
  const password_hash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({ where: { id }, data: { password_hash } });
  revalidatePath('/admin/users');
}

export async function deleteUser(id: string): Promise<void> {
  const me = await requireRole('ADMIN');
  if (id === me.id) throw new Error('You cannot delete yourself.');

  // Refuse to delete the last remaining ADMIN.
  const target = await prisma.user.findUnique({ where: { id }, select: { role: true } });
  if (!target) throw new Error('User not found.');
  if (target.role === 'ADMIN') {
    const adminCount = await prisma.user.count({ where: { role: 'ADMIN', active: true } });
    if (adminCount <= 1) throw new Error('Cannot delete the last active ADMIN.');
  }

  await prisma.user.delete({ where: { id } });
  revalidatePath('/admin/users');
}
