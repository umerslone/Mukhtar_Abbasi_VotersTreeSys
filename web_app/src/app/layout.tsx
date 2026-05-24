import type { Metadata } from 'next';
import './globals.css';
import { SessionProvider } from '@/components/SessionProvider';

export const metadata: Metadata = {
  title: 'Smart Nigraan — Voter Management',
  description: 'Secure Electoral Intelligence Platform · Nigraan Voter System (AJK).',
  icons: {
    icon: [{ url: '/favicon.svg', type: 'image/svg+xml' }],
    shortcut: '/favicon.svg'
  }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ur" dir="rtl">
      <head>
        {/* Preload the self-hosted Jameel Noori Nastaleeq so Urdu text
            renders in the correct nastaliq face on first paint instead
            of flashing in the system Arabic fallback. */}
        <link
          rel="preload"
          href="/fonts/JameelNooriNastaleeq.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
      </head>
      <body>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
