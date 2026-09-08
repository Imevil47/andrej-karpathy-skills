import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiPost, buildQuery } from '../api';
import { useAuth } from '../auth';
import { Badge, Card, DataTable, Field, Message, PageHeader } from '../components/ui';
import { formatDateTime, label } from '../format';
import { useResource } from '../hooks';

type DeviationRow = Readonly<{
  id: string;
  deviationCode: string;
  runCode: string | null;
  cycleCode: string | null;
  processStage: string;
  detectedAt: string;
  deviationType: string;
  description: string;
  severity: string;
  status: string;
  detectedByName: string;
  openActionCount: number;
}>;

const STATUSES = ['OUVERTE', 'EN_ANALYSE', 'ACTION_REQUISE', 'CLOTUREE', 'ANNULEE'] as const;

/** Déviations de process (section 37), avec création rapide. */
export function Deviations() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const [filters, setFilters] = useState({ statut: '' });
  const { data, error, loading } = useResource<readonly DeviationRow[]>(
    `/api/deviations${buildQuery(filters)}`,
  );

  const [processStage, setProcessStage] = useState('');
  const [deviationType, setDeviationType] = useState('');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState('MINEURE');
  const [createError, setCreateError] = useState<string | null>(null);

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    setCreateError(null);
    try {
      const created = await apiPost<{ id: string }>('/api/deviations', {
        productionRunId: null,
        sterilizationCycleId: null,
        processStage: processStage.trim(),
        detectedAt: new Date().toISOString(),
        deviationType: deviationType.trim(),
        description: description.trim(),
        severity,
      });
      navigate(`/qualite/deviations/${created.id}`);
    } catch (failure) {
      setCreateError((failure as Error).message);
    }
  };

  return (
    <>
      <PageHeader title="Déviations" subtitle="Écarts documentés par rapport au procédé attendu" actions={null} />
      <Message kind="erreur" text={createError} />

      {can('deviation:manage') ? (
        <Card title="Déclarer une déviation">
          <form onSubmit={create}>
            <div className="grille-champs">
              <Field label="Étape du process" hint="Ex : Remplissage, Sertissage, Stérilisation.">
                <input value={processStage} onChange={(event) => setProcessStage(event.target.value)} required />
              </Field>
              <Field label="Type de déviation" hint={null}>
                <input value={deviationType} onChange={(event) => setDeviationType(event.target.value)} required />
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
              { key: 'code', label: 'Déviation', numeric: false },
              { key: 'contexte', label: 'Run / Cycle', numeric: false },
              { key: 'etape', label: 'Étape', numeric: false },
              { key: 'gravite', label: 'Gravité', numeric: false },
              { key: 'description', label: 'Description', numeric: false },
              { key: 'actions', label: 'Actions ouvertes', numeric: true },
              { key: 'statut', label: 'Statut', numeric: false },
            ]}
            isEmpty={(data ?? []).length === 0}
            emptyText="Aucune déviation."
          >
            {(data ?? []).map((row) => (
              <tr key={row.id}>
                <td>
                  <Link to={`/qualite/deviations/${row.id}`}>
                    <strong>{row.deviationCode}</strong>
                  </Link>
                  <div style={{ fontSize: 12, color: 'var(--texte-doux)' }}>
                    {formatDateTime(row.detectedAt)} — {row.detectedByName}
                  </div>
                </td>
                <td>{row.runCode ?? row.cycleCode ?? '-'}</td>
                <td>{row.processStage}</td>
                <td>
                  <Badge value={row.severity} />
                </td>
                <td>{row.description}</td>
                <td className="nombre">{row.openActionCount}</td>
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
