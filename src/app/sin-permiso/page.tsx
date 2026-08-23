import Link from 'next/link';

export default function NoPermissionPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="max-w-md rounded-xl border border-madera-200 bg-white p-6 text-center shadow-sm">
        <h1 className="text-lg font-semibold text-madera-900">No tenés permiso</h1>
        <p className="mt-2 text-sm text-madera-600">
          Esta sección está reservada. Si necesitás acceder, pedíselo al dueño.
        </p>
        <Link href="/" className="mt-4 inline-block text-sm text-madera-700 underline">
          Volver al inicio
        </Link>
      </div>
    </main>
  );
}
