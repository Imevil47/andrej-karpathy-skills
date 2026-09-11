import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { apiPost, buildQuery } from '../api';
import { useAuth } from '../auth';
import { Badge, Card, DataTable, Field, Message, PageHeader } from '../components/ui';
import { formatDate, label } from '../format';
import { useResource } from '../hooks';
import { useUsers } from '../masterdata';

type CapaRow = Readonly<{
  id: string;
  capaCode: string;
  sourceNonconformityCode: string | null;
  ownerName: string;
  openedAt: string;
  dueAt: string | null;
  isOverdue: boolean;
  totalActions: number;
  openActions: number;
  effectivenessRequired: boolean;
  latestEffective: boolean | null;
  status: string;
}>;

const STATUSES = ['OUVERTE', 'EN_COURS', 'EN_VERIFICATION', 'CLOTUREE', 'ANNULEE'] as const;

/** CAPA (section 41) : jamais clôturé tant qu'une action reste ouverte ou
 * que l'efficacité requise n'a pas été vérifiée positivement. */
export function Capa() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const users = useUsers();
  const [searchParams] = useSearchParams();
  const [filters, setFilters] = useState({ statut: '' });
  const { data, error, loading } = useResource<readonly CapaRow[]>(`/api/capa${buildQuery(filters)}`);

  const sourceNonconformityId = searchParams.get('ncr');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [capaType, setCapaType] = useState('CORRECTIVE');
  const [priority, setPriority] = useState('NORMALE');
  const [dueAt, setDueAt] = useState('');
  const [ownerUserId, setOwnerUserId] = useState('');
  const [effectivenessRequired, setEffectivenessRequired] = useState(true);
  const [createError, setCreateError] = useState<string | null>(null);

  // A HAUTE/URGENTE CAPA without a due date defeats the "CAPA en retard" KPI
  // before it can ever fire (section 7.4) - the deadline is required for
  // those priorities, only encouraged for BASSE/NORMALE.
  const dueDateRequired = priority === 'HAUTE' || priority === 'URGENTE';

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    setCreateError(null);
    try {
      const created = await apiPost<{ id: string }>('/api/capa', {
        sourceNonconformityId: sourceNonconformityId ?? null,
        title: title.trim(),
        description: description.trim(),
        capaType,
        priority,
        ownerUserId,
        openedAt: new Date().toISOString(),
        dueAt: dueAt === '' ? null : new Date(dueAt).toISOString(),
        effectivenessRequired,
      });
      navigate(`/qualite/capa/${created.id}`);
    } catch (failure) {
      setCreateError((failure as Error).message);
    }
  };

  return (
    <>
      <PageHeader title="CAPA" subtitle="Actions correctives et préventives, closes uniquement quand l'efficacité est vérifiée" actions={null} />
      <Message kind="erreur" text={createError} />

      {can('capa:manage') ? (
        <Card title={sourceNonconformityId ? 'Créer un CAPA depuis la non-conformité' : 'Créer un CAPA'}>
          <form id="creation" onSubmit={create}>
            <div className="grille-champs">
              <Field label="Titre" hint={null}>
                <input value={title} onChange={(event) => setTitle(event.target.value)} required />
              </Field>
              <Field label="Description" hint={null}>
                <input value={description} onChange={(event) => setDescription(event.target.value)} required />
              </Field>
              <Field label="Type" hint={null}>
                <select value={capaType} onChange={(event) => setCapaType(event.target.value)}>
                  <option value="CORRECTIVE">Corrective</option>
                  <option value="PREVENTIVE">Préventive</option>
                  <option value="CORRECTIVE_PREVENTIVE">Corrective et préventive</option>
                </select>
              </Field>
              <Field label="Priorité" hint={null}>
                <select value={priority} onChange={(event) => setPriority(event.target.value)}>
                  <option value="BASSE">Basse</option>
                  <option value="NORMALE">Normale</option>
                  <option value="HAUTE">Haute</option>
                  <option value="URGENTE">Urgente</option>
                </select>
              </Field>
              <Field label="Échéance" hint={dueDateRequired ? 'Obligatoire pour une priorité haute ou urgente.' : 'Recommandée.'}>
                <input type="date" value={dueAt} onChange={(event) => setDueAt(event.target.value)} required={dueDateRequired} />
              </Field>
              <Field label="Responsable" hint={null}>
                <select value={ownerUserId} onChange={(event) => setOwnerUserId(event.target.value)} required>
                  <option value="">Sélectionner...</option>
                  {(users.data ?? []).map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.fullName}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Contrôle d'efficacité requis" hint={null}>
                <select
                  value={effectivenessRequired ? 'oui' : 'non'}
                  onChange={(event) => setEffectivenessRequired(event.target.value === 'oui')}
                >
                  <option value="oui">Oui</option>
                  <option value="non">Non</option>
                </select>
              </Field>
            </div>
            <div className="ligne-boutons">
              <button type="submit">Créer</button>
            </div>
          </form>
        </Card>
      ) : null}

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
              { key: 'code', label: 'CAPA', numeric: false },
              { key: 'source', label: 'Source', numeric: false },
              { key: 'responsable', label: 'Responsable', numeric: false },
              { key: 'ouverture', label: 'Ouverture', numeric: false },
              { key: 'echeance', label: 'Échéance', numeric: false },
              { key: 'actions', label: 'Actions', numeric: true },
              { key: 'efficacite', label: 'Efficacité', numeric: false },
              { key: 'statut', label: 'Statut', numeric: false },
            ]}
            isEmpty={(data ?? []).length === 0}
            emptyText="Aucun CAPA."
          >
            {(data ?? []).map((row) => (
              <tr key={row.id}>
                <td>
                  <Link to={`/qualite/capa/${row.id}`}>
                    <strong>{row.capaCode}</strong>
                  </Link>
                </td>
                <td>{row.sourceNonconformityCode ?? '-'}</td>
                <td>{row.ownerName}</td>
                <td>{formatDate(row.openedAt)}</td>
                <td>
                  {formatDate(row.dueAt)}
                  {row.isOverdue ? <div className="badge alerte" style={{ marginTop: 4 }}>En retard</div> : null}
                </td>
                <td className="nombre">
                  {row.totalActions - row.openActions} / {row.totalActions}
                </td>
                <td>
                  {row.effectivenessRequired ? (
                    row.latestEffective === null ? (
                      <Badge value="A_VERIFIER" />
                    ) : row.latestEffective ? (
                      <Badge value="EFFICACE" />
                    ) : (
                      <Badge value="NON_EFFICACE" />
                    )
                  ) : (
                    '-'
                  )}
                </td>
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
