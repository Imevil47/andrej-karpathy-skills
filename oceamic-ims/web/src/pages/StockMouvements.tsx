import { useState } from 'react';
import { Link } from 'react-router-dom';
import { apiPost, buildQuery } from '../api';
import { useAuth } from '../auth';
import { Badge, Card, DataTable, Message, PageHeader } from '../components/ui';
import { formatDateTime, formatQuantity, label } from '../format';
import { useResource } from '../hooks';
import { useLocations } from '../masterdata';

type MovementRow = Readonly<{
  id: string;
  movementCode: string;
  occurredAt: string;
  movementType: string;
  quantityKg: string;
  referenceType: string;
  reason: string | null;
  lotId: string;
  lotCode: string;
  sourceLocationCode: string | null;
  destinationLocationCode: string | null;
  createdByName: string;
  reversedByCode: string | null;
  isReversal: boolean;
}>;

const MOVEMENT_TYPES = [
  'RECEPTION',
  'TRANSFERT',
  'SOUS_TRAITANCE',
  'RETOUR',
  'PERTE',
  'AJUSTEMENT',
  'FRACTIONNEMENT',
] as const;

export function StockMouvements() {
  const { can } = useAuth();
  const locations = useLocations();
  const [filters, setFilters] = useState({ emplacement: '', type: '' });
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data, error: loadError, loading, reload } = useResource<readonly MovementRow[]>(
    `/api/stock/movements${buildQuery({ emplacement: filters.emplacement, type: filters.type })}`,
  );

  // Correction policy: a validated movement is never deleted, it is cancelled
  // by a mirror movement that stays visible in the history.
  const cancel = async (movement: MovementRow) => {
    const reason = window.prompt(
      `Motif d'annulation du mouvement ${movement.movementCode} :`,
      '',
    );
    if (reason === null || reason.trim() === '') {
      return;
    }
    setError(null);
    setFeedback(null);
    try {
      await apiPost(`/api/stock/movements/${movement.id}/reversal`, { reason: reason.trim() });
      setFeedback(`Mouvement ${movement.movementCode} annulé par un mouvement inverse.`);
      reload();
    } catch (failure) {
      setError((failure as Error).message);
    }
  };

  return (
    <>
      <PageHeader title="Mouvements de stock" subtitle="Journal des mouvements" actions={null} />

      <Card title={null}>
        <div className="filtres">
          <select
            value={filters.emplacement}
            onChange={(event) => setFilters((f) => ({ ...f, emplacement: event.target.value }))}
          >
            <option value="">Tous les emplacements</option>
            {(locations.data ?? []).map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
          <select
            value={filters.type}
            onChange={(event) => setFilters((f) => ({ ...f, type: event.target.value }))}
          >
            <option value="">Tous les types</option>
            {MOVEMENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {label(type)}
              </option>
            ))}
          </select>
        </div>

        <Message kind="erreur" text={error ?? loadError} />
        <Message kind="succes" text={feedback} />

        {loading ? (
          <p>Chargement...</p>
        ) : (
          <DataTable
            columns={[
              { key: 'code', label: 'Mouvement', numeric: false },
              { key: 'date', label: 'Date', numeric: false },
              { key: 'lot', label: 'Lot', numeric: false },
              { key: 'type', label: 'Type', numeric: false },
              { key: 'source', label: 'Source', numeric: false },
              { key: 'destination', label: 'Destination', numeric: false },
              { key: 'quantite', label: 'Quantité (kg)', numeric: true },
              { key: 'motif', label: 'Motif', numeric: false },
              { key: 'auteur', label: 'Utilisateur', numeric: false },
              { key: 'actions', label: '', numeric: false },
            ]}
            isEmpty={(data ?? []).length === 0}
            emptyText="Aucun mouvement enregistré."
          >
            {(data ?? []).map((row) => (
              <tr key={row.id}>
                <td>
                  <strong>{row.movementCode}</strong>
                  {row.isReversal ? <Badge value="ANNULATION" /> : null}
                </td>
                <td>{formatDateTime(row.occurredAt)}</td>
                <td>
                  <Link to={`/lots/${row.lotId}`}>{row.lotCode}</Link>
                </td>
                <td>{label(row.movementType)}</td>
                <td>{row.sourceLocationCode ?? '-'}</td>
                <td>{row.destinationLocationCode ?? '-'}</td>
                <td className="nombre">{formatQuantity(row.quantityKg)}</td>
                <td>{row.reason ?? '-'}</td>
                <td>{row.createdByName}</td>
                <td>
                  {row.reversedByCode ? (
                    <span className="badge">Annulé par {row.reversedByCode}</span>
                  ) : can('stock:reverse') && !row.isReversal ? (
                    <button type="button" className="lien" onClick={() => cancel(row)}>
                      Annuler
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
