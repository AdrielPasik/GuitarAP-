import { Navigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/data/database';
import { TablatureEditor } from '@/features/tablature/TablatureEditor';

export function TablatureScreen() {
  const { id } = useParams();
  const document = useLiveQuery(() => id ? db.documents.get(id) : undefined, [id]);
  if (!id) return <Navigate to="/biblioteca" replace />;
  if (document === undefined) return <p className="p-6 text-sm text-stone-500">Cargando tablatura…</p>;
  if (!document || document.type !== 'tablature') return <Navigate to="/biblioteca" replace />;
  return <TablatureEditor document={document} />;
}
