import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiPost, buildQuery } from '../api';
import { useAuth } from '../auth';
import { Badge, Card, DataTable, Field, Message, PageHeader } from '../components/ui';
import { formatDate, label } from '../format';
import { useResource } from '../hooks';
import { useUsers } from '../masterdata';

type QualityDocumentRow = Readonly<{
  id: string;
  documentCode: string;
  title: string;
  documentType: string;
  currentRevisionNumber: number | null;
  effectiveDate: string | null;
  ownerName: string;
  status: string;
}>;

const TYPES = [
  'PROCEDURE',
  'INSTRUCTION',
  'FORMULAIRE',
  'PLAN',
  'SPECIFICATION',
  'MANUEL',
  'POLITIQUE',
  'ENREGISTREMENT_MODELE',
  'AUTRE',
] as const;
const DOCUMENT_TYPE_LABELS: Readonly<Record<string, string>> = {
  PROCEDURE: 'Procédure',
  INSTRUCTION: 'Instruction',
  FORMULAIRE: 'Formulaire',
  PLAN: 'Plan',
  SPECIFICATION: 'Spécification',
  MANUEL: 'Manuel',
  POLITIQUE: 'Politique',
  ENREGISTREMENT_MODELE: "Modèle d'enregistrement",
  AUTRE: 'Autre',
};
const STATUSES = ['BROUILLON', 'EN_REVISION', 'APPROUVE', 'EN_VIGUEUR', 'OBSOLETE', 'ANNULE'] as const;

/** Documents qualité maîtrisés (section 43) : une révision n'est jamais
 * écrasée (section 27), un document affiche toujours sa révision en
 * vigueur, jamais une révision obsolète. */
export function Documents() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const users = useUsers();
  const [filters, setFilters] = useState({ statut: '' });
  const { data, error, loading } = useResource<readonly QualityDocumentRow[]>(`/api/quality-documents${buildQuery(filters)}`);

  const [documentCode, setDocumentCode] = useState('');
  const [title, setTitle] = useState('');
  const [documentType, setDocumentType] = useState('PROCEDURE');
  const [ownerUserId, setOwnerUserId] = useState('');
  const [changeSummary, setChangeSummary] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    setCreateError(null);
    try {
      const created = await apiPost<{ id: string }>('/api/quality-documents', {
        documentCode: documentCode.trim(),
        title: title.trim(),
        documentType,
        department: null,
        ownerUserId,
        changeSummary: changeSummary.trim(),
      });
      navigate(`/qualite/documents/${created.id}`);
    } catch (failure) {
      setCreateError((failure as Error).message);
    }
  };

  return (
    <>
      <PageHeader title="Documents qualité" subtitle="Procédures, instructions, formulaires — révisions maîtrisées" actions={null} />
      <Message kind="erreur" text={createError} />

      {can('document:manage') ? (
        <Card title="Créer un document">
          <form onSubmit={create}>
            <div className="grille-champs">
              <Field label="Code" hint="Ex : PR-QA-004.">
                <input value={documentCode} onChange={(event) => setDocumentCode(event.target.value)} required />
              </Field>
              <Field label="Titre" hint={null}>
                <input value={title} onChange={(event) => setTitle(event.target.value)} required />
              </Field>
              <Field label="Type" hint={null}>
                <select value={documentType} onChange={(event) => setDocumentType(event.target.value)}>
                  {TYPES.map((type) => (
                    <option key={type} value={type}>
                      {DOCUMENT_TYPE_LABELS[type]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Propriétaire" hint={null}>
                <select value={ownerUserId} onChange={(event) => setOwnerUserId(event.target.value)} required>
                  <option value="">Sélectionner...</option>
                  {(users.data ?? []).map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.fullName}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Objet de la révision initiale" hint={null}>
                <input value={changeSummary} onChange={(event) => setChangeSummary(event.target.value)} required />
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
              { key: 'code', label: 'Code', numeric: false },
              { key: 'titre', label: 'Titre', numeric: false },
              { key: 'type', label: 'Type', numeric: false },
              { key: 'revision', label: 'Révision', numeric: false },
              { key: 'effet', label: "Date d'effet", numeric: false },
              { key: 'proprietaire', label: 'Propriétaire', numeric: false },
              { key: 'statut', label: 'Statut', numeric: false },
            ]}
            isEmpty={(data ?? []).length === 0}
            emptyText="Aucun document."
          >
            {(data ?? []).map((row) => (
              <tr key={row.id}>
                <td>
                  <Link to={`/qualite/documents/${row.id}`}>
                    <strong>{row.documentCode}</strong>
                  </Link>
                </td>
                <td>{row.title}</td>
                <td>{DOCUMENT_TYPE_LABELS[row.documentType] ?? row.documentType}</td>
                <td>{row.currentRevisionNumber ?? '-'}</td>
                <td>{formatDate(row.effectiveDate)}</td>
                <td>{row.ownerName}</td>
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

export { DOCUMENT_TYPE_LABELS };
