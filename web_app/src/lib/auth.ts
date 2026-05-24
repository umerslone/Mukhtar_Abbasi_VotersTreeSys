import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';

export const authOptions: NextAuthOptions = {
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  providers: [
    CredentialsProvider({
      name: 'Campaign Staff',
      credentials: {
        username: { label: 'Username', type: 'text' },
        password: { label: 'Password', type: 'password' }
      },
      async authorize(credentials) {
        const expectedUser = process.env.STAFF_USERNAME ?? 'staff';
        const passwordHash = process.env.STAFF_PASSWORD_HASH ?? '';
        if (!credentials?.username || !credentials.password) {
          return null;
        }
        if (credentials.username !== expectedUser) {
          return null;
        }
        if (!passwordHash) {
          return null;
        }
        const ok = await bcrypt.compare(credentials.password, passwordHash);
        if (!ok) {
          return null;
        }
        return { id: 'staff', name: expectedUser };
      }
    })
  ]
};
