import { useState } from 'react';
import { apiPost, buildQuery } from '../api';
import { useAuth } from '../auth';
import { Badge, Card, DataTable, Field, Message, PageHeader } from '../components/ui';
import { formatDate, label } from '../format';
import { useResource } from '../hooks';
import { useSuppliers } from '../masterdata';

type SupplierIncidentRow = Readonly<{
  id: string;
  incidentCode: string;
  supplierName: string;
  rawMaterialLotCode: string | null;
  detectedAt: string;
  category: string;
  severity: string;
  status: string;
}>;

const STATUSES = ['OUVERTE', 'EN_ANALYSE', 'CLOTUREE', 'ANNULEE'] as const;

/** Incidents qualité fournisseur (section 20) : jamais un système d'achat -
 * un compteur simple pour suivre la performance fournisseur. */
export function IncidentsFournisseurs() {
  const { can } = useAuth();
  const suppliers = useSuppliers();
  const [filters, setFilters] = useState({ statut: '' });
  const { data, error, loading, reload } = useResource<readonly SupplierIncidentRow[]>(
    `/api/supplier-incidents${buildQuery(filters)}`,
  );

  const [supplierId, setSupplierId] = useState('');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState('MINEURE');
  const [createError, setCreateError] = useState<string | null>(null);

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    setCreateError(null);
    try {
      await apiPost('/api/supplier-incidents', {
        supplierId,
        rawMaterialLotId: null,
        receptionId: null,
        detectedAt: new Date().toISOString(),
        category: category.trim(),
        description: description.trim(),
        severity,
      });
      setCategory('');
      setDescription('');
      reload();
    } catch (failure) {
      setCreateError((failure as Error).message);
    }
  };

  return (
    <>
      <PageHeader title="Incidents fournisseur" subtitle="Suivi qualité fournisseur" actions={null} />
      <Message kind="erreur" text={createError} />

      {can('supplierincident:manage') ? (
        <Card title="Déclarer un incident">
          <form onSubmit={create}>
            <div className="grille-champs">
              <Field label="Fournisseur" hint={null}>
                <select value={supplierId} onChange={(event) => setSupplierId(event.target.value)} required>
                  <option value="">Sélectionner...</option>
                  {(suppliers.data ?? []).map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>
                      {supplier.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Catégorie" hint="Ex : Qualité matière, retard, documentation.">
                <input value={category} onChange={(event) => setCategory(event.target.value)} required />
              </Field>
              <Field label="Gravité" hint={null}>
                <select value={severity} onChange={(event) => setSeverity(event.target.value)}>
                  <option value="MINEURE">Mineure</option>
                  <option value="MAJEURE">Majeure</option>
                  <option value="CRITIQUE">Critique</option>
                </select>
              </Field>
              <Field label="Description" hint={null}>
                <input value={description} onChange={(event) => setDescription(event.target.value)} required />
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
              { key: 'code', label: 'Incident', numeric: false },
              { key: 'fournisseur', label: 'Fournisseur', numeric: false },
              { key: 'lot', label: 'Lot matière première', numeric: false },
              { key: 'date', label: 'Date', numeric: false },
              { key: 'categorie', label: 'Catégorie', numeric: false },
              { key: 'gravite', label: 'Gravité', numeric: false },
              { key: 'statut', label: 'Statut', numeric: false },
              { key: 'action', label: '', numeric: false },
            ]}
            isEmpty={(data ?? []).length === 0}
            emptyText="Aucun incident fournisseur."
          >
            {(data ?? []).map((row) => (
              <tr key={row.id}>
                <td>
                  <strong>{row.incidentCode}</strong>
                </td>
                <td>{row.supplierName}</td>
                <td>{row.rawMaterialLotCode ?? '-'}</td>
                <td>{formatDate(row.detectedAt)}</td>
                <td>{row.category}</td>
                <td>
                  <Badge value={row.severity} />
                </td>
                <td>
                  <Badge value={row.status} />
                </td>
                <td>
                  {can('supplierincident:manage') && row.status !== 'CLOTUREE' && row.status !== 'ANNULEE' ? (
                    <button
                      type="button"
                      className="lien"
                      onClick={() =>
                        apiPost(`/api/supplier-incidents/${row.id}/statut`, { status: 'CLOTUREE' }).then(reload)
                      }
                    >
                      Clôturer
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
