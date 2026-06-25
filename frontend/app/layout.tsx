import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Column Rosetta Mapper — CivilSpace',
  description: 'Reconcile a GFC drawing against an ETABS structural model.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
