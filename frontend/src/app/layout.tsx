import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'YLAAM-MEET - HD Video & AI Meeting Intelligence',
  description: 'YLAAM-MEET brings teams together with crystal-clear video, real-time collaboration and intelligent tools.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
