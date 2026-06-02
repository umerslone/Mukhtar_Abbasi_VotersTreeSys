import 'next-auth';
import 'next-auth/jwt';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      role: 'ADMIN' | 'EDITOR' | 'VIEWER';
    };
  }

  interface User {
    id: string;
    name?: string | null;
    role: 'ADMIN' | 'EDITOR' | 'VIEWER';
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    userId: string;
    role: 'ADMIN' | 'EDITOR' | 'VIEWER';
  }
}
