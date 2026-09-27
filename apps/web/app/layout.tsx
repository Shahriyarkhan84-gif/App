import type { Metadata } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: 'Zynalive',
  description: 'Watch live streams, meet new people, support creators.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
