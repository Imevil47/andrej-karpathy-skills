import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiPost, buildQuery } from '../api';
import { useAuth } from '../auth';
import { Badge, Card, DataTable, Field, Message, PageHeader } from '../components/ui';
import { formatDateTime, label } from '../format';
import { useResource } from '../hooks';

type RecallEventRow = Readonly<{
  id: string;
  recallCode: string;
  eventType: string;
  targetLabel: string | null;
  openedAt: string;
  closedAt: string | null;
  severity: string;
  status: string;
  initiatedByName: string;
  affectedCount: number;
}>;

const EVENT_TYPES = ['EXERCICE_TRACABILITE', 'RETRAIT', 'RAPPEL'] as const;
const STATUSES = ['OUVERT', 'EN_COURS', 'CLOTURE', 'ANNULE'] as const;

/**
 * Retraits / rappels / exercices de traçabilité (sections 32-36) : l'impact
 * est toujours calculé depuis la traçabilité existante, jamais saisi à la
 * main. Un exercice de routine (recall:exercise, Qualité) et un vrai
 * retrait/rappel (recall:manage, Responsable Qualité) restent deux
 * autorisations distinctes (section 53/54).
 */
export function Retraits() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const [filters, setFilters] = useState({ statut: '' });
  const { data, error, loading } = useResource<readonly RecallEventRow[]>(`/api/recall-events${buildQuery(filters)}`);

  const [eventType, setEventType] = useState('EXERCICE_TRACABILITE');
  const [targetEntityType, setTargetEntityType] = useState<'RAW_MATERIAL_LOT' | 'FINISHED_GOOD_LOT'>('RAW_MATERIAL_LOT');
  const [targetEntityId, setTargetEntityId] = useState('');
  const [reason, setReason] = useState('');
  const [severity, setSeverity] = useState('MINEURE');
  const [createError, setCreateError] = useState<string | null>(null);

  const canCreate = eventType === 'EXERCICE_TRACABILITE' ? can('recall:exercise') : can('recall:manage');

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    setCreateError(null);
    try {
      const created = await apiPost<{ id: string }>('/api/recall-events', {
        eventType,
        targetEntityType,
        targetEntityId: targetEntityId.trim(),
        reason: reason.trim(),
        severity,
        scopeDescription: null,
      });
      navigate(`/qualite/retraits/${created.id}`);
    } catch (failure) {
      setCreateError((failure as Error).message);
    }
  };

  return (
    <>
      <PageHeader
        title="Retraits / rappels"
        subtitle="Exercices de traçabilité et retraits/rappels réels, calculés depuis la traçabilité existante"
        actions={null}
      />
      <Message kind="erreur" text={createError} />

      <Card title="Ouvrir un exercice ou un retrait/rappel">
        <p style={{ color: 'var(--texte-doux)', marginTop: 0 }}>
          L'identifiant se trouve sur la fiche du lot (Traçabilité ou Lots MP/PF).
        </p>
        <form onSubmit={create}>
          <div className="grille-champs">
            <Field label="Type" hint={null}>
              <select value={eventType} onChange={(event) => setEventType(event.target.value)}>
                {EVENT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {label(type)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Type de lot d'origine" hint={null}>
              <select value={targetEntityType} onChange={(event) => setTargetEntityType(event.target.value as typeof targetEntityType)}>
                <option value="RAW_MATERIAL_LOT">Lot matière première</option>
                <option value="FINISHED_GOOD_LOT">Lot PF</option>
              </select>
            </Field>
            <Field label="Identifiant du lot" hint="UUID du lot d'origine.">
              <input value={targetEntityId} onChange={(event) => setTargetEntityId(event.target.value)} required />
            </Field>
            <Field label="Gravité" hint={null}>
              <select value={severity} onChange={(event) => setSeverity(event.target.value)}>
                <option value="MINEURE">Mineure</option>
                <option value="MAJEURE">Majeure</option>
                <option value="CRITIQUE">Critique</option>
              </select>
            </Field>
            <Field label="Motif" hint={null}>
              <input value={reason} onChange={(event) => setReason(event.target.value)} required />
            </Field>
          </div>
          <div className="ligne-boutons">
            <button type="submit" disabled={!canCreate}>
              Ouvrir
            </button>
          </div>
        </form>
      </Card>

      <Card title={null}>
        <div className="filtres">
          <select value={filters.statut} onChange={(event) => setFilters({ statut: event.target.value })}>
            <option value="">Tous les statuts</option>
            {STATUSES.map((status) => (
              <option key={status} value={status}>
                {label(status)}
              </option>
            ))}
          </select>
        </div>

        {error ? <div className="message erreur">{error}</div> : null}
        {loading ? (
          <p>Chargement...</p>
        ) : (
          <DataTable
            columns={[
              { key: 'code', label: 'Évènement', numeric: false },
              { key: 'type', label: 'Type', numeric: false },
              { key: 'lot', label: 'Lot d’origine', numeric: false },
              { key: 'ouverture', label: 'Ouverture', numeric: false },
              { key: 'gravite', label: 'Gravité', numeric: false },
              { key: 'affectes', label: 'Entités affectées', numeric: true },
              { key: 'statut', label: 'Statut', numeric: false },
            ]}
            isEmpty={(data ?? []).length === 0}
            emptyText="Aucun évènement."
          >
            {(data ?? []).map((row) => (
              <tr key={row.id}>
                <td>
                  <Link to={`/qualite/retraits/${row.id}`}>
                    <strong>{row.recallCode}</strong>
                  </Link>
                </td>
                <td>{label(row.eventType)}</td>
                <td>{row.targetLabel ?? '-'}</td>
                <td>{formatDateTime(row.openedAt)}</td>
                <td>
                  <Badge value={row.severity} />
                </td>
                <td className="nombre">{row.affectedCount}</td>
                <td>
                  <Badge value={row.status} />
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </Card>
    </>
  );
}
