import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiPost, buildQuery } from '../api';
import { useAuth } from '../auth';
import { Badge, Card, DataTable, Field, Message, PageHeader } from '../components/ui';
import { formatDate, label } from '../format';
import { useResource } from '../hooks';
import { useCustomers } from '../masterdata';

type ComplaintRow = Readonly<{
  id: string;
  complaintCode: string;
  receivedAt: string;
  customerName: string;
  shipmentCode: string | null;
  finishedGoodLotCode: string | null;
  complaintType: string;
  severity: string;
  status: string;
  ownerName: string | null;
}>;

const TYPES = [
  'QUALITE',
  'POIDS',
  'SERTISSAGE',
  'BOITE_DEFORMEE',
  'MARQUAGE',
  'ODEUR',
  'GOUT',
  'CORPS_ETRANGER',
  'QUANTITE',
  'DOCUMENTATION',
  'AUTRE',
] as const;
const STATUSES = ['OUVERTE', 'EN_ANALYSE', 'ACTION_REQUISE', 'CLOTUREE', 'ANNULEE'] as const;

/** Réclamations client (section 16-18, 60) : jamais un CRM - la
 * traçabilité se reconstruit depuis l'expédition, jamais ressaisie. */
export function Reclamations() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const customers = useCustomers();
  const [filters, setFilters] = useState({ statut: '' });
  const { data, error, loading } = useResource<readonly ComplaintRow[]>(`/api/complaints${buildQuery(filters)}`);

  const [customerId, setCustomerId] = useState('');
  const [complaintType, setComplaintType] = useState('QUALITE');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState('MINEURE');
  const [createError, setCreateError] = useState<string | null>(null);

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    setCreateError(null);
    try {
      const created = await apiPost<{ id: string }>('/api/complaints', {
        receivedAt: new Date().toISOString(),
        customerId,
        shipmentId: null,
        finishedGoodLotId: null,
        palletId: null,
        complaintType,
        description: description.trim(),
        severity,
        ownerUserId: null,
      });
      navigate(`/qualite/reclamations/${created.id}`);
    } catch (failure) {
      setCreateError((failure as Error).message);
    }
  };

  return (
    <>
      <PageHeader title="Réclamations client" subtitle="Traçabilité recalculée depuis l'expédition, jamais ressaisie" actions={null} />
      <Message kind="erreur" text={createError} />

      {can('complaint:manage') ? (
        <Card title="Enregistrer une réclamation">
          <form id="creation" onSubmit={create}>
            <div className="grille-champs">
              <Field label="Client" hint={null}>
                <select value={customerId} onChange={(event) => setCustomerId(event.target.value)} required>
                  <option value="">Sélectionner...</option>
                  {(customers.data ?? []).map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Type" hint={null}>
                <select value={complaintType} onChange={(event) => setComplaintType(event.target.value)}>
                  {TYPES.map((type) => (
                    <option key={type} value={type}>
                      {label(type)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Gravité" hint={null}>
                <select value={severity} onChange={(event) => setSeverity(event.target.value)}>
                  <option value="MINEURE">Mineure</option>
                  <option value="MAJEURE">Majeure</option>
                  <option value="CRITIQUE">Critique</option>
                </select>
              </Field>
              <Field label="Description" hint="L'expédition/lot d'origine se lie ensuite sur la fiche détaillée.">
                <input value={description} onChange={(event) => setDescription(event.target.value)} required />
              </Field>
            </div>
            <div className="ligne-boutons">
              <button type="submit">Enregistrer</button>
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
              { key: 'code', label: 'Réclamation', numeric: false },
              { key: 'date', label: 'Date', numeric: false },
              { key: 'client', label: 'Client', numeric: false },
              { key: 'expedition', label: 'Expédition', numeric: false },
              { key: 'type', label: 'Type', numeric: false },
              { key: 'gravite', label: 'Gravité', numeric: false },
              { key: 'statut', label: 'Statut', numeric: false },
            ]}
            isEmpty={(data ?? []).length === 0}
            emptyText="Aucune réclamation."
          >
            {(data ?? []).map((row) => (
              <tr key={row.id}>
                <td>
                  <Link to={`/qualite/reclamations/${row.id}`}>
                    <strong>{row.complaintCode}</strong>
                  </Link>
                </td>
                <td>{formatDate(row.receivedAt)}</td>
                <td>{row.customerName}</td>
                <td>{row.shipmentCode ?? '-'}</td>
                <td>{label(row.complaintType)}</td>
                <td>
                  <Badge value={row.severity} />
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
