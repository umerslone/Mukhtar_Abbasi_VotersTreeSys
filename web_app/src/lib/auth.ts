import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { prisma } from './prisma';

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
        if (!credentials?.username || !credentials.password) return null;
        const username = credentials.username.trim();

        // Bootstrap: if the User table is empty, seed one ADMIN from env so
        // existing deployments keep working without a manual seed step.
        const userCount = await prisma.user.count();
        if (userCount === 0) {
          const envUser = (process.env.STAFF_USERNAME ?? '').trim();
          const envHash = process.env.STAFF_PASSWORD_HASH ?? '';
          if (envUser && envHash) {
            await prisma.user.create({
              data: {
                username: envUser,
                password_hash: envHash,
                role: 'ADMIN',
                active: true,
              },
            });
          }
        }

        const user = await prisma.user.findUnique({ where: { username } });
        if (!user || !user.active) return null;

        const ok = await bcrypt.compare(credentials.password, user.password_hash);
        if (!ok) return null;

        await prisma.user.update({
          where: { id: user.id },
          data: { last_login_at: new Date() },
        });

        return { id: user.id, name: user.username, role: user.role };
      }
    })
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.userId = user.id;
        token.role = user.role;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.userId;
        session.user.role = token.role;
      }
      return session;
    },
  },
};
