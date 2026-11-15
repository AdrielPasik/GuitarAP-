import { Navigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/data/database';
import { belongsToOwner, libraryScope } from '@/data/library-scope';
import { TablatureEditor } from '@/features/tablature/TablatureEditor';

export function TablatureScreen() {
  const { id } = useParams();
  const document = useLiveQuery(async () => { if (!id) return undefined; const [item, scope] = await Promise.all([db.documents.get(id), libraryScope()]); return item && belongsToOwner(item, scope) ? item : null; }, [id]);
  if (!id) return <Navigate to="/biblioteca" replace />;
  if (document === undefined) return <p className="p-6 text-sm text-stone-500">Cargando tablatura…</p>;
  if (!document || document.type !== 'tablature') return <Navigate to="/biblioteca" replace />;
  return <TablatureEditor document={document} />;
}
