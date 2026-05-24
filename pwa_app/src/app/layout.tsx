import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Standalone Offline Voter Management System',
  description: 'Offline-first voter management for AJK political field operations.',
  manifest: '/manifest.webmanifest'
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ur" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
