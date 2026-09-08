import { Link } from 'react-router-dom';
import { Badge, Card, DataTable, PageHeader } from '../components/ui';
import { formatDateTime } from '../format';
import { useResource } from '../hooks';
import { useAuth } from '../auth';

type SterilizationCycleRow = Readonly<{
  id: string;
  cycleCode: string;
  autoclaveCode: string;
  programCode: string;
  programName: string;
  startedAt: string;
  endedAt: string | null;
  status: string;
  measurementCount: number;
  maxF0Value: string | null;
  latestCcpResult: string | null;
  latestCcpDecision: string | null;
  runCodes: readonly string[];
}>;

const ACTIVE_STATUSES = ['PLANIFIE', 'EN_CHARGEMENT', 'EN_COURS', 'A_VERIFIER'];

/** Cycles de stérilisation (section 50). Les cycles actifs se repèrent en un coup d'œil. */
export function Sterilisation() {
  const { can } = useAuth();
  const { data, error, loading } = useResource<readonly SterilizationCycleRow[]>(
    '/api/sterilization-cycles',
  );

  return (
    <>
      <PageHeader
        title="Stérilisation"
        subtitle="Cycles de stérilisation"
        actions={
          can('sterilization:operate') ? (
            <Link to="/production/sterilisation/nouveau">
              <button type="button">Nouveau cycle</button>
            </Link>
          ) : null
        }
      />

      <Card title={null}>
        {error ? <div className="message erreur">{error}</div> : null}
        {loading ? (
          <p>Chargement...</p>
        ) : (
          <DataTable
            columns={[
              { key: 'cycle', label: 'Cycle', numeric: false },
              { key: 'autoclave', label: 'Autoclave', numeric: false },
              { key: 'run', label: 'Run / Charge', numeric: false },
              { key: 'programme', label: 'Programme', numeric: false },
              { key: 'debut', label: 'Début', numeric: false },
              { key: 'f0', label: 'F0', numeric: true },
              { key: 'ccp', label: 'CCP', numeric: false },
              { key: 'statut', label: 'Statut', numeric: false },
            ]}
            isEmpty={(data ?? []).length === 0}
            emptyText="Aucun cycle de stérilisation."
          >
            {(data ?? []).map((row) => (
              <tr key={row.id}>
                <td>
                  <Link to={`/production/sterilisation/${row.id}`}>
                    <strong>{row.cycleCode}</strong>
                  </Link>
                  {ACTIVE_STATUSES.includes(row.status) ? ' ●' : ''}
                </td>
                <td>{row.autoclaveCode}</td>
                <td>{row.runCodes.join(', ') || '-'}</td>
                <td>{row.programCode}</td>
                <td>{formatDateTime(row.startedAt)}</td>
                <td className="nombre">{row.maxF0Value ?? '-'}</td>
                <td>
                  {row.latestCcpDecision ? (
                    <Badge value={row.latestCcpDecision} />
                  ) : (
                    <span className="badge">Aucune donnée</span>
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
