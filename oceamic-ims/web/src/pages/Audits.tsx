import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiPost, buildQuery } from '../api';
import { useAuth } from '../auth';
import { Badge, Card, DataTable, Field, Message, PageHeader } from '../components/ui';
import { formatDate, label } from '../format';
import { useResource } from '../hooks';
import { useAuditChecklists, useUsers } from '../masterdata';

type AuditRow = Readonly<{
  id: string;
  auditCode: string;
  auditType: string;
  title: string;
  plannedDate: string;
  scope: string;
  leadAuditorName: string;
  status: string;
  findingCount: number;
  openFindingCount: number;
}>;

const TYPES = ['INTERNE', 'CLIENT', 'CERTIFICATION', 'AUTORITE', 'FOURNISSEUR', 'HYGIENE', 'PROCESS', 'AUTRE'] as const;
const STATUSES = ['PLANIFIE', 'EN_COURS', 'TERMINE', 'ANNULE'] as const;

/** Audits (section 42) : planifiés par la Qualité, conduits par l'auditeur
 * assigné. */
export function Audits() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const checklists = useAuditChecklists();
  const users = useUsers();
  const [filters, setFilters] = useState({ statut: '' });
  const { data, error, loading } = useResource<readonly AuditRow[]>(`/api/audits${buildQuery(filters)}`);

  const [auditType, setAuditType] = useState('INTERNE');
  const [title, setTitle] = useState('');
  const [auditChecklistId, setAuditChecklistId] = useState('');
  const [plannedDate, setPlannedDate] = useState('');
  const [scope, setScope] = useState('');
  const [leadAuditorUserId, setLeadAuditorUserId] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    setCreateError(null);
    try {
      const created = await apiPost<{ id: string }>('/api/audits', {
        auditType,
        title: title.trim(),
        auditChecklistId: auditChecklistId === '' ? null : auditChecklistId,
        plannedDate,
        scope: scope.trim(),
        leadAuditorUserId,
        notes: null,
      });
      navigate(`/qualite/audits/${created.id}`);
    } catch (failure) {
      setCreateError((failure as Error).message);
    }
  };

  return (
    <>
      <PageHeader title="Audits" subtitle="Internes, client, certification, autorité, fournisseur" actions={null} />
      <Message kind="erreur" text={createError} />

      {can('audit:plan') ? (
        <Card title="Planifier un audit">
          <form onSubmit={create}>
            <div className="grille-champs">
              <Field label="Type" hint={null}>
                <select value={auditType} onChange={(event) => setAuditType(event.target.value)}>
                  {TYPES.map((type) => (
                    <option key={type} value={type}>
                      {label(type)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Titre" hint={null}>
                <input value={title} onChange={(event) => setTitle(event.target.value)} required />
              </Field>
              <Field label="Grille de contrôle" hint="Facultative.">
                <select value={auditChecklistId} onChange={(event) => setAuditChecklistId(event.target.value)}>
                  <option value="">Aucune</option>
                  {(checklists.data ?? []).map((checklist) => (
                    <option key={checklist.id} value={checklist.id}>
                      {checklist.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Date prévue" hint={null}>
                <input type="date" value={plannedDate} onChange={(event) => setPlannedDate(event.target.value)} required />
              </Field>
              <Field label="Périmètre" hint={null}>
                <input value={scope} onChange={(event) => setScope(event.target.value)} required />
              </Field>
              <Field label="Auditeur responsable" hint={null}>
                <select value={leadAuditorUserId} onChange={(event) => setLeadAuditorUserId(event.target.value)} required>
                  <option value="">Sélectionner...</option>
                  {(users.data ?? []).map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.fullName}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="ligne-boutons">
              <button type="submit">Planifier</button>
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
              { key: 'code', label: 'Audit', numeric: false },
              { key: 'type', label: 'Type', numeric: false },
              { key: 'date', label: 'Date prévue', numeric: false },
              { key: 'perimetre', label: 'Périmètre', numeric: false },
              { key: 'auditeur', label: 'Auditeur', numeric: false },
              { key: 'constats', label: 'Constats', numeric: true },
              { key: 'ouverts', label: 'Actions ouvertes', numeric: true },
              { key: 'statut', label: 'Statut', numeric: false },
            ]}
            isEmpty={(data ?? []).length === 0}
            emptyText="Aucun audit."
          >
            {(data ?? []).map((row) => (
              <tr key={row.id}>
                <td>
                  <Link to={`/qualite/audits/${row.id}`}>
                    <strong>{row.auditCode}</strong>
                  </Link>
                  <div style={{ fontSize: 12, color: 'var(--texte-doux)' }}>{row.title}</div>
                </td>
                <td>{label(row.auditType)}</td>
                <td>{formatDate(row.plannedDate)}</td>
                <td>{row.scope}</td>
                <td>{row.leadAuditorName}</td>
                <td className="nombre">{row.findingCount}</td>
                <td className="nombre">{row.openFindingCount}</td>
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
