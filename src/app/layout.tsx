import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Punto Madera',
    template: '%s · Punto Madera',
  },
  description: 'Sistema de gestión de Punto Madera',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Punto Madera', statusBarStyle: 'default' },
};

export const viewport: Viewport = {
  themeColor: '#7a4b2a',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-AR">
      <body>{children}</body>
    </html>
  );
}
