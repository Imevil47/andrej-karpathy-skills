import { useState } from 'react';
import { Link } from 'react-router-dom';
import { apiPost, buildQuery } from '../api';
import { Badge, Card, DataTable, Message, PageHeader } from '../components/ui';
import { formatDateTime, formatDuration } from '../format';
import { useResource } from '../hooks';
import { useDowntimeCategories } from '../masterdata';

type DowntimeRow = Readonly<{
  id: string;
  productionRunId: string;
  runCode: string;
  productionRunLineId: string | null;
  lineCode: string | null;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
  categoryCode: string;
  categoryName: string;
  reasonText: string | null;
  planned: boolean;
  createdByName: string;
}>;

/** Elapsed time since a still-open downtime started, refreshed once a minute. */
function LiveDuration({ startedAt }: { startedAt: string }) {
  const [now, setNow] = useState(() => Date.now());
  useState(() => {
    const interval = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(interval);
  });
  const seconds = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  return <>{formatDuration(seconds)}</>;
}

export function Arrets() {
  const categories = useDowntimeCategories();
  const [filters, setFilters] = useState({ categorie: '', enCours: '' });
  const { data, error, loading, reload } = useResource<readonly DowntimeRow[]>(
    `/api/downtime${buildQuery(filters)}`,
  );
  const [closeError, setCloseError] = useState<string | null>(null);

  const closeDowntime = async (id: string) => {
    setCloseError(null);
    try {
      await apiPost(`/api/downtime/${id}/cloture`, { endedAt: new Date().toISOString() });
      reload();
    } catch (failure) {
      setCloseError((failure as Error).message);
    }
  };

  return (
    <>
      <PageHeader
        title="Arrêts de production"
        subtitle="Interruptions déclarées, par Run et par ligne"
        actions={null}
      />

      <Message kind="erreur" text={closeError} />

      <Card title={null}>
        <div className="filtres">
          <select
            value={filters.categorie}
            onChange={(event) => setFilters((f) => ({ ...f, categorie: event.target.value }))}
          >
            <option value="">Toutes les catégories</option>
            {(categories.data ?? []).map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
          <select
            value={filters.enCours}
            onChange={(event) => setFilters((f) => ({ ...f, enCours: event.target.value }))}
          >
            <option value="">Tous les arrêts</option>
            <option value="true">En cours uniquement</option>
          </select>
        </div>

        {error ? <div className="message erreur">{error}</div> : null}
        {loading ? (
          <p>Chargement...</p>
        ) : (
          <DataTable
            columns={[
              { key: 'debut', label: 'Début', numeric: false },
              { key: 'fin', label: 'Fin', numeric: false },
              { key: 'duree', label: 'Durée', numeric: false },
              { key: 'run', label: 'Run', numeric: false },
              { key: 'ligne', label: 'Ligne', numeric: false },
              { key: 'categorie', label: 'Catégorie', numeric: false },
              { key: 'motif', label: 'Motif', numeric: false },
              { key: 'planifie', label: 'Planifié', numeric: false },
              { key: 'actions', label: '', numeric: false },
            ]}
            isEmpty={(data ?? []).length === 0}
            emptyText="Aucun arrêt enregistré."
          >
            {(data ?? []).map((row) => (
              <tr key={row.id}>
                <td>{formatDateTime(row.startedAt)}</td>
                <td>{row.endedAt ? formatDateTime(row.endedAt) : <Badge value="EN_COURS" />}</td>
                <td>
                  {row.durationSeconds !== null ? (
                    formatDuration(row.durationSeconds)
                  ) : (
                    <LiveDuration startedAt={row.startedAt} />
                  )}
                </td>
                <td>
                  <Link to={`/production/${row.productionRunId}`}>{row.runCode}</Link>
                </td>
                <td>{row.lineCode ?? <em>Tout le Run</em>}</td>
                <td>{row.categoryName}</td>
                <td>{row.reasonText ?? '-'}</td>
                <td>{row.planned ? 'Oui' : 'Non'}</td>
                <td>
                  {row.endedAt === null ? (
                    <button type="button" className="lien" onClick={() => closeDowntime(row.id)}>
                      Terminer l'arrêt
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </Card>
    </>
  );
}
