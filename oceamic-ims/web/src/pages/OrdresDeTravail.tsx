import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiPost, buildQuery } from '../api';
import { useAuth } from '../auth';
import { Badge, Card, DataTable, Field, Message, PageHeader } from '../components/ui';
import { formatDate, formatDateTime, label } from '../format';
import { useResource } from '../hooks';
import { useEquipment } from '../masterdata';

type WorkOrderRow = Readonly<{
  id: string;
  workOrderCode: string;
  equipmentId: string;
  equipmentCode: string;
  equipmentName: string;
  productionLineCode: string | null;
  workOrderType: string;
  priority: string;
  status: string;
  title: string;
  requestedAt: string;
  dueAt: string | null;
  assignedToName: string | null;
}>;

const TYPES = ['CORRECTIVE', 'PREVENTIVE', 'INSPECTION', 'REGLAGE', 'AMELIORATION', 'URGENCE'] as const;
const PRIORITIES = ['BASSE', 'NORMALE', 'HAUTE', 'URGENTE'] as const;
const STATUSES = ['OUVERT', 'PLANIFIE', 'EN_COURS', 'EN_ATTENTE_PIECE', 'EN_ATTENTE_PRODUCTION', 'TERMINE', 'ANNULE'] as const;

/** Ordres de travail (section 43) : liste filtrable, création rapide. */
export function OrdresDeTravail() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const equipment = useEquipment();
  const [filters, setFilters] = useState({ type: '', priorite: '', statut: '' });
  const { data, error, loading, reload } = useResource<readonly WorkOrderRow[]>(
    `/api/work-orders${buildQuery(filters)}`,
  );

  const [equipmentId, setEquipmentId] = useState('');
  const [workOrderType, setWorkOrderType] = useState<(typeof TYPES)[number]>('CORRECTIVE');
  const [priority, setPriority] = useState<(typeof PRIORITIES)[number]>('NORMALE');
  const [title, setTitle] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    setCreateError(null);
    try {
      const created = await apiPost<{ id: string }>('/api/work-orders', {
        equipmentId,
        failureReportId: null,
        workOrderType,
        priority,
        title: title.trim(),
        description: null,
        assignedTo: null,
        dueAt: null,
      });
      reload();
      navigate(`/maintenance/ordres-de-travail/${created.id}`);
    } catch (failure) {
      setCreateError((failure as Error).message);
    }
  };

  return (
    <>
      <PageHeader title="Ordres de travail" subtitle="Travaux de maintenance autorisés" actions={null} />
      <Message kind="erreur" text={createError} />

      {can('workorder:manage') ? (
        <Card title="Nouvel ordre de travail">
          <form id="creation" onSubmit={create}>
            <div className="grille-champs">
              <Field label="Équipement" hint={null}>
                <select value={equipmentId} onChange={(event) => setEquipmentId(event.target.value)} required>
                  <option value="">Sélectionner...</option>
                  {(equipment.data ?? []).map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.code} — {item.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Type" hint={null}>
                <select value={workOrderType} onChange={(event) => setWorkOrderType(event.target.value as typeof workOrderType)}>
                  {TYPES.map((value) => (
                    <option key={value} value={value}>
                      {label(value)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Priorité" hint={null}>
                <select value={priority} onChange={(event) => setPriority(event.target.value as typeof priority)}>
                  {PRIORITIES.map((value) => (
                    <option key={value} value={value}>
                      {label(value)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Titre" hint={null}>
                <input value={title} onChange={(event) => setTitle(event.target.value)} required />
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
          <select value={filters.type} onChange={(event) => setFilters((f) => ({ ...f, type: event.target.value }))}>
            <option value="">Tous les types</option>
            {TYPES.map((value) => (
              <option key={value} value={value}>
                {label(value)}
              </option>
            ))}
          </select>
          <select value={filters.priorite} onChange={(event) => setFilters((f) => ({ ...f, priorite: event.target.value }))}>
            <option value="">Toutes les priorités</option>
            {PRIORITIES.map((value) => (
              <option key={value} value={value}>
                {label(value)}
              </option>
            ))}
          </select>
          <select value={filters.statut} onChange={(event) => setFilters((f) => ({ ...f, statut: event.target.value }))}>
            <option value="">Tous les statuts</option>
            {STATUSES.map((value) => (
              <option key={value} value={value}>
                {label(value)}
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
              { key: 'code', label: 'OT', numeric: false },
              { key: 'equipement', label: 'Équipement', numeric: false },
              { key: 'type', label: 'Type', numeric: false },
              { key: 'priorite', label: 'Priorité', numeric: false },
              { key: 'demande', label: 'Demandé le', numeric: false },
              { key: 'assigne', label: 'Assigné à', numeric: false },
              { key: 'echeance', label: 'Échéance', numeric: false },
              { key: 'statut', label: 'Statut', numeric: false },
            ]}
            isEmpty={(data ?? []).length === 0}
            emptyText="Aucun ordre de travail."
          >
            {(data ?? []).map((row) => (
              <tr key={row.id}>
                <td>
                  <Link to={`/maintenance/ordres-de-travail/${row.id}`}>
                    <strong>{row.workOrderCode}</strong>
                  </Link>
                </td>
                <td>
                  {row.equipmentCode}
                  {row.productionLineCode ? <div className="aide">{row.productionLineCode}</div> : null}
                </td>
                <td>{label(row.workOrderType)}</td>
                <td>
                  <Badge value={row.priority} />
                </td>
                <td>{formatDateTime(row.requestedAt)}</td>
                <td>{row.assignedToName ?? '-'}</td>
                <td>{formatDate(row.dueAt)}</td>
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
