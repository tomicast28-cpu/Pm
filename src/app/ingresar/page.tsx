import type { Metadata } from 'next';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Ingresar' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ volver?: string }>;
}) {
  const { volver } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center bg-madera-800 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-lg">
        <h1 className="text-xl font-semibold text-madera-900">Punto Madera</h1>
        <p className="mt-1 text-sm text-madera-500">Ingresá para operar el local.</p>
        <LoginForm next={volver ?? '/'} />
      </div>
    </main>
  );
}
