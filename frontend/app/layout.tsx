import type { Metadata } from 'next';
import LanguageToggle from '@/components/language-toggle';
import LanguageRuntime from '@/components/language-runtime';
import './globals.css';

export const metadata: Metadata = {
  title: 'VGO AI',
  description: 'VGO AI is an AI workspace for chat, teams, billing, and operations.',
  icons: {
    icon: '/brand-logo.png',
    apple: '/brand-logo.png',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>
        <LanguageToggle />
        <LanguageRuntime />
        {children}
      </body>
    </html>
  );
}
