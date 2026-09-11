import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiPost, buildQuery } from '../api';
import { useAuth } from '../auth';
import { Badge, Card, DataTable, Field, Message, PageHeader } from '../components/ui';
import { formatDateTime, label } from '../format';
import { useResource } from '../hooks';
import { useEquipment } from '../masterdata';

type FailureRow = Readonly<{
  id: string;
  failureCode: string;
  equipmentId: string;
  equipmentCode: string;
  equipmentName: string;
  severity: string;
  status: string;
  description: string;
  reportedAt: string;
  reportedByName: string;
}>;

const SEVERITIES = ['FAIBLE', 'MOYENNE', 'HAUTE', 'CRITIQUE'] as const;
const STATUSES = ['DECLAREE', 'PRISE_EN_CHARGE', 'RESOLUE', 'ANNULEE'] as const;

/** Pannes (section 10) : déclaration rapide sur le terrain, sans long
 * formulaire administratif. */
export function Pannes() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const equipment = useEquipment();
  const [filters, setFilters] = useState({ statut: '' });
  const { data, error, loading, reload } = useResource<readonly FailureRow[]>(`/api/failures${buildQuery(filters)}`);

  const [equipmentId, setEquipmentId] = useState('');
  const [severity, setSeverity] = useState<(typeof SEVERITIES)[number]>('MOYENNE');
  const [description, setDescription] = useState('');
  const [stopsProduction, setStopsProduction] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    setCreateError(null);
    try {
      await apiPost('/api/failures', {
        equipmentId,
        severity,
        description: description.trim(),
        productionRunId: null,
        productionRunLineId: null,
        stopsProduction,
      });
      reload();
      setDescription('');
      navigate('/maintenance/pannes');
    } catch (failure) {
      setCreateError((failure as Error).message);
    }
  };

  return (
    <>
      <PageHeader title="Pannes" subtitle="Déclaration et suivi des pannes équipement" actions={null} />
      <Message kind="erreur" text={createError} />

      {can('failure:report') ? (
        <Card title="Déclarer une panne">
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
              <Field label="Gravité" hint={null}>
                <select value={severity} onChange={(event) => setSeverity(event.target.value as typeof severity)}>
                  {SEVERITIES.map((value) => (
                    <option key={value} value={value}>
                      {label(value)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Description" hint={null}>
                <input value={description} onChange={(event) => setDescription(event.target.value)} required />
              </Field>
              <Field label="Production arrêtée ?" hint="Un arrêt de production réel sera ouvert (lié au Run actif).">
                <select
                  value={stopsProduction ? 'oui' : 'non'}
                  onChange={(event) => setStopsProduction(event.target.value === 'oui')}
                >
                  <option value="non">Non</option>
                  <option value="oui">Oui</option>
                </select>
              </Field>
            </div>
            <div className="ligne-boutons">
              <button type="submit">Déclarer</button>
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
              { key: 'code', label: 'N°', numeric: false },
              { key: 'equipement', label: 'Équipement', numeric: false },
              { key: 'gravite', label: 'Gravité', numeric: false },
              { key: 'description', label: 'Description', numeric: false },
              { key: 'declaree', label: 'Déclarée le', numeric: false },
              { key: 'statut', label: 'Statut', numeric: false },
            ]}
            isEmpty={(data ?? []).length === 0}
            emptyText="Aucune panne."
          >
            {(data ?? []).map((row) => (
              <tr key={row.id}>
                <td>
                  <strong>{row.failureCode}</strong>
                </td>
                <td>
                  <Link to={`/maintenance/equipements/${row.equipmentId}`}>{row.equipmentCode}</Link>
                </td>
                <td>
                  <Badge value={row.severity} />
                </td>
                <td>{row.description}</td>
                <td>{formatDateTime(row.reportedAt)}</td>
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
