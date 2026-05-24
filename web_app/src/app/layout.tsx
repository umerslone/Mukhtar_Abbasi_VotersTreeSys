import type { Metadata } from 'next';
import './globals.css';
import { SessionProvider } from '@/components/SessionProvider';

export const metadata: Metadata = {
  title: 'Voter Management SaaS',
  description: 'Political Voter Management for AJK elections.'
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ur" dir="rtl">
      <body>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
