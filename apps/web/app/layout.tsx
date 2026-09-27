import type { Metadata } from 'next';

import { AuthProvider } from '@/lib/auth-context';

import './globals.css';

export const metadata: Metadata = {
  title: 'Zynalive',
  description: 'Watch live streams, meet new people, support creators.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
