import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiPost, buildQuery } from '../api';
import { useAuth } from '../auth';
import { Badge, Card, DataTable, Field, Message, PageHeader } from '../components/ui';
import { formatDate, label } from '../format';
import { useResource } from '../hooks';
import { useNonconformityCategories } from '../masterdata';

type NonconformityRow = Readonly<{
  id: string;
  nonconformityCode: string;
  detectedAt: string;
  sourceType: string | null;
  categoryName: string;
  severity: string;
  priority: string;
  status: string;
  ownerName: string | null;
  dueAt: string | null;
  isOverdue: boolean;
}>;

const SEVERITIES = ['MINEURE', 'MAJEURE', 'CRITIQUE'] as const;
const STATUSES = ['OUVERTE', 'EN_ANALYSE', 'ACTION_REQUISE', 'EN_ATTENTE', 'A_VERIFIER', 'CLOTUREE', 'ANNULEE'] as const;

/** Non-conformités (section 39) : liste filtrable, création rapide. */
export function NonConformites() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const categories = useNonconformityCategories();
  const [filters, setFilters] = useState({ statut: '', gravite: '' });
  const { data, error, loading } = useResource<readonly NonconformityRow[]>(
    `/api/nonconformities${buildQuery(filters)}`,
  );

  const [categoryId, setCategoryId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState('MINEURE');
  const [priority, setPriority] = useState('NORMALE');
  const [createError, setCreateError] = useState<string | null>(null);

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    setCreateError(null);
    try {
      const created = await apiPost<{ id: string }>('/api/nonconformities', {
        detectedAt: new Date().toISOString(),
        sourceType: null,
        sourceId: null,
        categoryId,
        title: title.trim(),
        description: description.trim(),
        severity,
        priority,
        ownerUserId: null,
        dueAt: null,
        qualityBlockRequired: false,
        links: [],
      });
      navigate(`/qualite/non-conformites/${created.id}`);
    } catch (failure) {
      setCreateError((failure as Error).message);
    }
  };

  return (
    <>
      <PageHeader title="Non-conformités" subtitle="Écarts documentés, jamais isolés de leur entité source" actions={null} />
      <Message kind="erreur" text={createError} />

      {can('ncr:manage') ? (
        <Card title="Déclarer une non-conformité">
          <form onSubmit={create}>
            <div className="grille-champs">
              <Field label="Catégorie" hint={null}>
                <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} required>
                  <option value="">Sélectionner...</option>
                  {(categories.data ?? []).map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Titre" hint={null}>
                <input value={title} onChange={(event) => setTitle(event.target.value)} required />
              </Field>
              <Field label="Gravité" hint={null}>
                <select value={severity} onChange={(event) => setSeverity(event.target.value)}>
                  {SEVERITIES.map((value) => (
                    <option key={value} value={value}>
                      {label(value)}
                    </option>
                  ))}
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
              <Field label="Description" hint="La source (lot, run, contrôle...) se lie ensuite sur la fiche détaillée.">
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
          <select value={filters.statut} onChange={(event) => setFilters((f) => ({ ...f, statut: event.target.value }))}>
            <option value="">Tous les statuts</option>
            {STATUSES.map((status) => (
              <option key={status} value={status}>
                {label(status)}
              </option>
            ))}
          </select>
          <select value={filters.gravite} onChange={(event) => setFilters((f) => ({ ...f, gravite: event.target.value }))}>
            <option value="">Toutes les gravités</option>
            {SEVERITIES.map((value) => (
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
              { key: 'code', label: 'N°', numeric: false },
              { key: 'date', label: 'Date', numeric: false },
              { key: 'source', label: 'Source', numeric: false },
              { key: 'categorie', label: 'Catégorie', numeric: false },
              { key: 'gravite', label: 'Gravité', numeric: false },
              { key: 'responsable', label: 'Responsable', numeric: false },
              { key: 'echeance', label: 'Échéance', numeric: false },
              { key: 'statut', label: 'Statut', numeric: false },
            ]}
            isEmpty={(data ?? []).length === 0}
            emptyText="Aucune non-conformité."
          >
            {(data ?? []).map((row) => (
              <tr key={row.id}>
                <td>
                  <Link to={`/qualite/non-conformites/${row.id}`}>
                    <strong>{row.nonconformityCode}</strong>
                  </Link>
                </td>
                <td>{formatDate(row.detectedAt)}</td>
                <td>{label(row.sourceType)}</td>
                <td>{row.categoryName}</td>
                <td>
                  <Badge value={row.severity} />
                </td>
                <td>{row.ownerName ?? '-'}</td>
                <td>
                  {formatDate(row.dueAt)}
                  {row.isOverdue ? <div className="badge alerte" style={{ marginTop: 4 }}>En retard</div> : null}
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
