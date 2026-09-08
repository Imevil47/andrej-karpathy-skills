import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { apiPost, buildQuery } from '../api';
import { useAuth } from '../auth';
import { Badge, Card, DataTable, Field, KeyValue, Message, PageHeader } from '../components/ui';
import { formatDate, formatDateTime, formatDuration, formatQuantity, label, nowLocalInput } from '../format';
import { useResource } from '../hooks';
import { useDowntimeCategories, useEmployees, useLossReasons, useProductionStages } from '../masterdata';

type RunDetailPayload = Readonly<{
  run: Readonly<{
    id: string;
    runCode: string;
    productionDate: string;
    startedAt: string | null;
    endedAt: string | null;
    status: string;
    speciesCode: string;
    productCode: string;
    productName: string;
    format: string | null;
    piecesPerCan: number | null;
    responsibleName: string | null;
    inputKg: string;
    usefulKg: string;
    byProductKg: string;
    reworkKg: string;
    reclassifiedKg: string;
    realLossKg: string;
    accountedKg: string;
    differenceKg: string;
    differencePercent: string | null;
    balanceStatus: string;
    yieldPercent: string | null;
    isJustified: boolean;
    notes: string | null;
    differenceJustification: string | null;
    justifiedByName: string | null;
    justifiedAt: string | null;
    cancellationReason: string | null;
  }>;
  consumptions: readonly Readonly<{
    id: string;
    consumedAt: string;
    lotId: string;
    lotCode: string;
    speciesCode: string;
    sizeGrade: string | null;
    locationCode: string;
    quantityKg: string;
    status: string;
    movementCode: string;
    createdByName: string;
    cancellationReason: string | null;
  }>[];
  lines: readonly Readonly<{
    id: string;
    lineCode: string;
    lineName: string;
    area: string | null;
    activityType: string;
    isActiveForRun: boolean;
  }>[];
  outputs: readonly Readonly<{
    id: string;
    outputType: string;
    quantityKg: string;
    occurredAt: string;
    lineCode: string | null;
    stageCode: string | null;
    destinationLocationCode: string | null;
    lossReasonName: string | null;
    reasonText: string | null;
    notes: string | null;
    status: string;
    createdByName: string;
  }>[];
}>;

type StockLine = Readonly<{
  lotId: string;
  lotCode: string;
  locationCode: string;
  sizeGrade: string | null;
  qualityGrade: string | null;
  availableQuantityKg: string;
  isBlocked: boolean;
}>;

type LocationRow = Readonly<{ id: string; code: string }>;

type RunLineCadenceSummaryRow = Readonly<{
  productionRunLineId: string;
  presentCount: number;
  lastControlledAt: string | null;
  lastCoveragePercent: string | null;
  lastCoverageStatus: string | null;
  lineCadencePerHour: string | null;
  performancePercent: string | null;
  performanceStatus: string | null;
  downtimeTodaySeconds: number;
  activeDowntime: boolean;
}>;

type WorkforceRow = Readonly<{
  assignmentId: string;
  productionRunLineId: string;
  lineCode: string;
  lineName: string;
  activityType: string;
  employeeId: string;
  employeeNumber: string;
  employeeName: string;
  isPresent: boolean;
  assignedFrom: string;
}>;

type ControlRoundSummaryRow = Readonly<{
  id: string;
  roundCode: string;
  startedAt: string;
  endedAt: string | null;
  status: string;
  controllerName: string;
  linesVisited: number;
  linesCompleted: number;
  employeesExpected: number;
  employeesControlled: number;
  coveragePercent: string | null;
}>;

type RunCadenceRow = Readonly<{
  id: string;
  controlledAt: string;
  lineCode: string;
  employeeNumber: string;
  employeeName: string;
  quantityCompleted: string;
  measurementUnit: string;
  cadencePerHour: string;
  performancePercent: string | null;
  performanceStatus: string | null;
}>;

type DowntimeRow = Readonly<{
  id: string;
  productionRunLineId: string | null;
  lineCode: string | null;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
  categoryCode: string;
  categoryName: string;
  reasonText: string | null;
  planned: boolean;
  createdByName: string;
}>;

const TABS = [
  'Vue générale',
  'Lots consommés',
  'Lignes',
  'Contrôles horaires',
  'Cadence',
  'Arrêts',
  'Remplissage',
  'Sertissage',
  'Stérilisation',
  'Sorties',
  'Pertes',
  'Bilan matière',
  'Traçabilité',
] as const;

type ProcessOverview = Readonly<{
  fillingStatus: string | null;
  seamingStatus: string | null;
  markingStatus: string | null;
  sterilizationStatus: string | null;
  coolingStatus: string | null;
  hasActiveHold: boolean;
}>;

type FillingOperationRow = Readonly<{
  id: string;
  operationCode: string;
  productCode: string;
  format: string | null;
  status: string;
  startedAt: string;
  lastControlAt: string | null;
  lastControlStatus: string | null;
}>;

type WeightControlSummaryRow = Readonly<{
  id: string;
  controlCode: string;
  controlledAt: string;
  sampleCount: number;
  sampleSize: number;
  underweightCount: number;
  overweightCount: number;
  controlStatus: string;
}>;

type SeamingOperationRow = Readonly<{
  id: string;
  operationCode: string;
  machineCode: string | null;
  status: string;
  startedAt: string;
}>;

type SeamingControlSummaryRow = Readonly<{
  id: string;
  controlledAt: string;
  result: string;
  nonConformeCount: number;
}>;

type MarkingEventRow = Readonly<{
  id: string;
  markingCode: string;
  status: string;
  markedAt: string;
}>;

type SterilizationCycleSummaryRow = Readonly<{
  id: string;
  cycleCode: string;
  autoclaveCode: string;
  status: string;
  startedAt: string;
  latestCcpDecision: string | null;
}>;

type RunGenealogy = Readonly<{
  fillingOperations: readonly FillingOperationRow[];
  weightControls: readonly WeightControlSummaryRow[];
  seamingOperations: readonly SeamingOperationRow[];
  seamingControls: readonly SeamingControlSummaryRow[];
  markingEvents: readonly MarkingEventRow[];
  sterilizationCycles: readonly SterilizationCycleSummaryRow[];
}>;

const LOSS_TYPES = ['PERTE_REELLE', 'SOUS_PRODUIT', 'REWORK', 'RECLASSEMENT'] as const;

/** "Situation du Run": one page, one tab per concern. */
export function ProductionRunSituation() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const { data, error, loading, reload } = useResource<RunDetailPayload>(
    `/api/production/runs/${id}`,
  );
  const situation = useResource<readonly StockLine[]>('/api/stock/situation');
  const locations = useResource<readonly LocationRow[]>('/api/locations');
  const stages = useProductionStages();
  const lossReasons = useLossReasons();
  const lineSummary = useResource<readonly RunLineCadenceSummaryRow[]>(
    `/api/production/runs/${id}/lignes/resume`,
  );
  const workforce = useResource<readonly WorkforceRow[]>(`/api/production/runs/${id}/personnel`);
  const employees = useEmployees();
  const controlRounds = useResource<readonly ControlRoundSummaryRow[]>(
    `/api/cadence/control-rounds${buildQuery({ run: id ?? null })}`,
  );
  const downtimeEvents = useResource<readonly DowntimeRow[]>(
    `/api/downtime${buildQuery({ run: id ?? null })}`,
  );
  const downtimeCategories = useDowntimeCategories();
  const cadenceHistory = useResource<readonly RunCadenceRow[]>(
    `/api/cadence${buildQuery({ run: id ?? null })}`,
  );
  const processOverview = useResource<ProcessOverview>(`/api/production/runs/${id}/vue-process`);
  const genealogy = useResource<RunGenealogy>(`/api/production/runs/${id}/genealogie`);

  const [tab, setTab] = useState<(typeof TABS)[number]>('Vue générale');
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const [assignLineId, setAssignLineId] = useState('');
  const [assignEmployeeId, setAssignEmployeeId] = useState('');

  const [downtimeLineId, setDowntimeLineId] = useState('');
  const [downtimeCategoryId, setDowntimeCategoryId] = useState('');
  const [downtimeReason, setDowntimeReason] = useState('');
  const [downtimePlanned, setDowntimePlanned] = useState(false);

  const [selection, setSelection] = useState('');
  const [quantityKg, setQuantityKg] = useState('');
  const [consumedAt, setConsumedAt] = useState(nowLocalInput());

  const [outputType, setOutputType] = useState('SORTIE_UTILE');
  const [outputQuantityKg, setOutputQuantityKg] = useState('');
  const [outputStageId, setOutputStageId] = useState('');
  const [outputLineId, setOutputLineId] = useState('');
  const [outputNotes, setOutputNotes] = useState('');

  const [lossType, setLossType] = useState<string>('PERTE_REELLE');
  const [lossReasonId, setLossReasonId] = useState('');
  const [lossQuantityKg, setLossQuantityKg] = useState('');
  const [lossLineId, setLossLineId] = useState('');
  const [lossNotes, setLossNotes] = useState('');

  const [justification, setJustification] = useState('');

  const stockLines = useMemo(() => {
    const byCode = new Map((locations.data ?? []).map((location) => [location.code, location.id]));
    return (situation.data ?? [])
      .filter((line) => !line.isBlocked)
      .map((line) => ({ ...line, locationId: byCode.get(line.locationCode) ?? '' }));
  }, [situation.data, locations.data]);

  const selectedStock = stockLines.find((line) => `${line.lotId}|${line.locationId}` === selection);

  const run = data?.run ?? null;
  const isOpen = run !== null && ['PLANIFIE', 'EN_COURS', 'SUSPENDU'].includes(run.status);

  const call = async (action: () => Promise<unknown>, message: string) => {
    setActionError(null);
    setActionSuccess(null);
    try {
      await action();
      setActionSuccess(message);
      reload();
      situation.reload();
    } catch (failure) {
      setActionError((failure as Error).message);
    }
  };

  if (loading) {
    return <p>Chargement...</p>;
  }
  if (error || data === null || run === null) {
    return <div className="message erreur">{error ?? 'Ordre de production introuvable.'}</div>;
  }

  const validConsumptions = data.consumptions.filter((row) => row.status === 'VALIDE');
  const validOutputs = data.outputs.filter((row) => row.status === 'VALIDE');
  const usefulOutputs = validOutputs.filter(
    (row) => row.outputType === 'SORTIE_UTILE' || row.outputType === 'AUTRE',
  );
  const lossOutputs = data.outputs.filter((row) =>
    (LOSS_TYPES as readonly string[]).includes(row.outputType),
  );

  return (
    <>
      <PageHeader
        title={`Situation du Run ${run.runCode}`}
        subtitle={`${run.productCode} — ${run.productName} — ${run.speciesCode} — ${formatDate(run.productionDate)}`}
        actions={
          <>
            <Badge value={run.status} />
            {can('production:run') && run.status === 'PLANIFIE' ? (
              <button
                type="button"
                onClick={() =>
                  call(
                    () => apiPost(`/api/production/runs/${run.id}/demarrage`, {}),
                    'Run démarré.',
                  )
                }
              >
                Démarrer le Run
              </button>
            ) : null}
            {can('production:run') && isOpen && run.status !== 'PLANIFIE' ? (
              <button
                type="button"
                onClick={() =>
                  call(
                    () => apiPost(`/api/production/runs/${run.id}/cloture`, {}),
                    'Run terminé.',
                  )
                }
              >
                Terminer le Run
              </button>
            ) : null}
          </>
        }
      />

      <Message kind="erreur" text={actionError} />
      <Message kind="succes" text={actionSuccess} />

      {run.balanceStatus === 'ECART_A_JUSTIFIER' && !run.isJustified ? (
        <div className="message erreur">
          Écart matière à justifier : {formatQuantity(run.differenceKg)} kg
          {run.differencePercent === null ? '' : ` (${run.differencePercent} %)`}. Le Run ne peut pas
          être terminé tant que l'écart n'est pas justifié.
        </div>
      ) : null}

      <div className="grille-cartes">
        <div className="indicateur accent">
          <div className="titre">Entrée MP</div>
          <div className="valeur">
            {formatQuantity(run.inputKg)}
            <span className="unite">kg</span>
          </div>
        </div>
        <div className="indicateur">
          <div className="titre">Sortie utile</div>
          <div className="valeur">
            {formatQuantity(run.usefulKg)}
            <span className="unite">kg</span>
          </div>
        </div>
        <div className="indicateur">
          <div className="titre">Rendement matière</div>
          <div className="valeur">
            {run.yieldPercent === null ? '-' : run.yieldPercent}
            <span className="unite">%</span>
          </div>
        </div>
        <div className="indicateur">
          <div className="titre">Pertes réelles</div>
          <div className="valeur">
            {formatQuantity(run.realLossKg)}
            <span className="unite">kg</span>
          </div>
        </div>
        <div className="indicateur">
          <div className="titre">Écart matière</div>
          <div className="valeur">
            {formatQuantity(run.differenceKg)}
            <span className="unite">kg</span>
          </div>
        </div>
      </div>

      <div className="onglets">
        {TABS.map((entry) => (
          <button
            key={entry}
            type="button"
            className={tab === entry ? 'actif' : ''}
            onClick={() => setTab(entry)}
          >
            {entry}
          </button>
        ))}
      </div>

      {tab === 'Vue générale' ? (
        <Card title="Informations du Run">
          <KeyValue
            items={[
              { key: 'Run', value: run.runCode },
              { key: 'Produit', value: `${run.productCode} — ${run.productName}` },
              { key: 'Espèce', value: run.speciesCode },
              { key: 'Format', value: run.format ?? '-' },
              { key: 'Pièces par boîte', value: run.piecesPerCan?.toString() ?? '-' },
              { key: 'Date de production', value: formatDate(run.productionDate) },
              { key: 'Heure de début', value: formatDateTime(run.startedAt) },
              { key: 'Heure de fin', value: formatDateTime(run.endedAt) },
              { key: 'Responsable', value: run.responsibleName ?? '-' },
              { key: 'Statut', value: <Badge value={run.status} /> },
              { key: 'Observations', value: run.notes ?? '-' },
              ...(run.cancellationReason
                ? [{ key: "Motif d'annulation", value: run.cancellationReason }]
                : []),
            ]}
          />
        </Card>
      ) : null}

      {tab === 'Vue générale' && processOverview.data ? (
        <Card title="Vue du process">
          {processOverview.data.hasActiveHold ? (
            <div className="message erreur">
              Ce Run est retenu par une décision CCP défavorable : voir l'onglet Stérilisation.
            </div>
          ) : null}
          <DataTable
            columns={[
              { key: 'etape', label: 'Étape', numeric: false },
              { key: 'statut', label: 'Statut', numeric: false },
            ]}
            isEmpty={false}
            emptyText=""
          >
            {(
              [
                ['Remplissage', processOverview.data.fillingStatus],
                ['Sertissage', processOverview.data.seamingStatus],
                ['Marquage', processOverview.data.markingStatus],
                ['Stérilisation', processOverview.data.sterilizationStatus],
                ['Refroidissement', processOverview.data.coolingStatus],
              ] as const
            ).map(([stage, status]) => (
              <tr key={stage}>
                <td>{stage}</td>
                <td>{status ? <Badge value={status} /> : <span style={{ color: 'var(--texte-doux)' }}>En attente</span>}</td>
              </tr>
            ))}
          </DataTable>
        </Card>
      ) : null}

      {tab === 'Lots consommés' ? (
        <>
          {can('production:material') && isOpen ? (
            <Card title="Ajouter une matière première">
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!selectedStock) {
                    return;
                  }
                  void call(
                    () =>
                      apiPost(`/api/production/runs/${run.id}/consommations`, {
                        rawMaterialLotId: selectedStock.lotId,
                        sourceLocationId: selectedStock.locationId,
                        quantityKg,
                        consumedAt: new Date(consumedAt).toISOString(),
                        notes: null,
                      }),
                    'Consommation enregistrée.',
                  ).then(() => setQuantityKg(''));
                }}
              >
                <div className="grille-champs">
                  <Field label="Lot MP et emplacement source" hint="Les lots bloqués ne sont pas listés.">
                    <select
                      value={selection}
                      onChange={(event) => setSelection(event.target.value)}
                      required
                    >
                      <option value="">Sélectionner...</option>
                      {stockLines.map((line) => (
                        <option
                          key={`${line.lotId}|${line.locationId}`}
                          value={`${line.lotId}|${line.locationId}`}
                        >
                          {line.lotCode} — {line.locationCode} —{' '}
                          {formatQuantity(line.availableQuantityKg)} kg
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Stock disponible" hint={null}>
                    <input
                      readOnly
                      value={
                        selectedStock
                          ? `${formatQuantity(selectedStock.availableQuantityKg)} kg`
                          : '-'
                      }
                    />
                  </Field>
                  <Field label="Moule / calibre connu" hint="Issu du dernier contrôle qualité.">
                    <input readOnly value={selectedStock?.sizeGrade ?? '-'} />
                  </Field>
                  <Field label="Quantité à consommer (kg)" hint={null}>
                    <input
                      value={quantityKg}
                      onChange={(event) => setQuantityKg(event.target.value)}
                      inputMode="decimal"
                      placeholder="2000.000"
                      required
                    />
                  </Field>
                  <Field label="Heure de consommation" hint={null}>
                    <input
                      type="datetime-local"
                      value={consumedAt}
                      onChange={(event) => setConsumedAt(event.target.value)}
                      required
                    />
                  </Field>
                </div>
                <div className="ligne-boutons">
                  <button type="submit" disabled={selectedStock === undefined}>
                    Ajouter la consommation
                  </button>
                </div>
              </form>
            </Card>
          ) : null}

          <Card title={`Historique des consommations (${validConsumptions.length} validée(s))`}>
            <DataTable
              columns={[
                { key: 'heure', label: 'Heure', numeric: false },
                { key: 'lot', label: 'Lot MP', numeric: false },
                { key: 'emplacement', label: 'Emplacement', numeric: false },
                { key: 'mouvement', label: 'Mouvement', numeric: false },
                { key: 'utilisateur', label: 'Utilisateur', numeric: false },
                { key: 'statut', label: 'Statut', numeric: false },
                { key: 'quantite', label: 'Quantité (kg)', numeric: true },
                { key: 'actions', label: '', numeric: false },
              ]}
              isEmpty={data.consumptions.length === 0}
              emptyText="Aucune matière première consommée."
            >
              {data.consumptions.map((row) => (
                <tr key={row.id}>
                  <td>{formatDateTime(row.consumedAt)}</td>
                  <td>
                    <Link to={`/lots/${row.lotId}`}>{row.lotCode}</Link>
                  </td>
                  <td>{row.locationCode}</td>
                  <td>{row.movementCode}</td>
                  <td>{row.createdByName}</td>
                  <td>
                    <Badge value={row.status} />
                    {row.cancellationReason ? ` — ${row.cancellationReason}` : ''}
                  </td>
                  <td className="nombre">{formatQuantity(row.quantityKg)}</td>
                  <td>
                    {can('production:correct') && row.status === 'VALIDE' ? (
                      <button
                        type="button"
                        className="lien"
                        onClick={() => {
                          const corrected = window.prompt(
                            `Quantité réellement consommée pour ${row.lotCode} (kg). Laisser vide pour annuler la consommation.`,
                            row.quantityKg,
                          );
                          if (corrected === null) {
                            return;
                          }
                          const reason = window.prompt('Motif de la correction :', '');
                          if (reason === null || reason.trim() === '') {
                            return;
                          }
                          void call(
                            () =>
                              apiPost(`/api/production/consommations/${row.id}/correction`, {
                                correctedQuantityKg: corrected.trim() === '' ? null : corrected.trim(),
                                reason: reason.trim(),
                              }),
                            'Consommation corrigée par annulation et remplacement.',
                          );
                        }}
                      >
                        Corriger
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </DataTable>
          </Card>
        </>
      ) : null}

      {tab === 'Lignes' ? (
        <>
          <Card title="Lignes du Run">
            <DataTable
              columns={[
                { key: 'ligne', label: 'Ligne', numeric: false },
                { key: 'zone', label: 'Zone', numeric: false },
                { key: 'activite', label: 'Activité', numeric: false },
                { key: 'active', label: 'Active', numeric: false },
                { key: 'presentes', label: 'Employées présentes', numeric: true },
                { key: 'dernier', label: 'Dernier contrôle', numeric: false },
                { key: 'cadence', label: 'Cadence ligne', numeric: true },
                { key: 'performance', label: 'Performance', numeric: false },
                { key: 'arret', label: "Arrêt aujourd'hui", numeric: false },
              ]}
              isEmpty={data.lines.length === 0}
              emptyText="Aucune ligne configurée pour ce Run."
            >
              {data.lines.map((row) => {
                const summary = (lineSummary.data ?? []).find(
                  (entry) => entry.productionRunLineId === row.id,
                );
                return (
                  <tr key={row.id}>
                    <td>
                      <strong>{row.lineName}</strong>
                    </td>
                    <td>{row.area ?? '-'}</td>
                    <td>{label(row.activityType)}</td>
                    <td>{row.isActiveForRun ? 'Oui' : 'Non'}</td>
                    <td className="nombre">{summary?.presentCount ?? 0}</td>
                    <td>
                      {summary?.lastCoverageStatus ? (
                        <>
                          {summary.lastCoveragePercent ?? '-'} % <Badge value={summary.lastCoverageStatus} />
                        </>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className="nombre">
                      {summary?.lineCadencePerHour ? `${summary.lineCadencePerHour} / h` : '-'}
                    </td>
                    <td>
                      {summary?.performancePercent ? (
                        <>
                          {summary.performancePercent} %{' '}
                          {summary.performanceStatus ? <Badge value={summary.performanceStatus} /> : null}
                        </>
                      ) : (
                        <span className="badge">Standard non défini</span>
                      )}
                    </td>
                    <td>
                      {summary?.activeDowntime ? (
                        <Badge value="INCOMPLET" />
                      ) : summary && summary.downtimeTodaySeconds > 0 ? (
                        formatDuration(summary.downtimeTodaySeconds)
                      ) : (
                        '-'
                      )}
                    </td>
                  </tr>
                );
              })}
            </DataTable>
          </Card>

          <Card title="Personnel du Run">
            {can('workforce:manage') && isOpen ? (
              <form
                className="filtres"
                onSubmit={(event) => {
                  event.preventDefault();
                  void call(
                    () =>
                      apiPost(`/api/production/runs/${id}/personnel`, {
                        productionRunLineId: assignLineId,
                        employeeId: assignEmployeeId,
                        isPresent: true,
                      }),
                    'Employée affectée.',
                  ).then(() => {
                    workforce.reload();
                    lineSummary.reload();
                    setAssignEmployeeId('');
                  });
                }}
              >
                <select
                  value={assignLineId}
                  onChange={(event) => setAssignLineId(event.target.value)}
                  required
                >
                  <option value="">Ligne...</option>
                  {data.lines
                    .filter((line) => line.isActiveForRun && line.activityType !== 'INACTIVE')
                    .map((line) => (
                      <option key={line.id} value={line.id}>
                        {line.lineName}
                      </option>
                    ))}
                </select>
                <select
                  value={assignEmployeeId}
                  onChange={(event) => setAssignEmployeeId(event.target.value)}
                  required
                >
                  <option value="">Matricule...</option>
                  {(employees.data ?? []).map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.employeeNumber} — {employee.displayName}
                    </option>
                  ))}
                </select>
                <button type="submit" className="secondaire">
                  Affecter
                </button>
              </form>
            ) : null}

            <DataTable
              columns={[
                { key: 'matricule', label: 'Matricule', numeric: false },
                { key: 'nom', label: 'Nom', numeric: false },
                { key: 'ligne', label: 'Ligne', numeric: false },
                { key: 'presence', label: 'Présence', numeric: false },
              ]}
              isEmpty={(workforce.data ?? []).length === 0}
              emptyText="Aucune employée affectée à ce Run."
            >
              {(workforce.data ?? []).map((row) => (
                <tr key={row.assignmentId}>
                  <td>{row.employeeNumber}</td>
                  <td>{row.employeeName}</td>
                  <td>{row.lineCode}</td>
                  <td>
                    {can('workforce:manage') && isOpen ? (
                      <button
                        type="button"
                        className="lien"
                        onClick={() =>
                          call(
                            () =>
                              apiPost(`/api/production/personnel/${row.assignmentId}/presence`, {
                                isPresent: !row.isPresent,
                              }),
                            row.isPresent ? 'Marquée absente.' : 'Marquée présente.',
                          ).then(() => workforce.reload())
                        }
                      >
                        {row.isPresent ? 'Présente' : 'Absente'}
                      </button>
                    ) : (
                      <Badge value={row.isPresent ? 'ACTIF' : 'ANNULE'} />
                    )}
                  </td>
                </tr>
              ))}
            </DataTable>
          </Card>
        </>
      ) : null}

      {tab === 'Contrôles horaires' ? (
        <Card title="Tours de contrôle">
          {can('cadence:control') && isOpen ? (
            <div className="ligne-boutons" style={{ marginTop: 0, marginBottom: 16 }}>
              <button
                type="button"
                onClick={async () => {
                  setActionError(null);
                  try {
                    const created = await apiPost<{ id: string }>(
                      `/api/production/runs/${id}/tours-controle`,
                      { notes: null },
                    );
                    navigate(`/production/controles/${created.id}`);
                  } catch (failure) {
                    setActionError((failure as Error).message);
                  }
                }}
              >
                Nouveau tour de contrôle
              </button>
            </div>
          ) : null}
          <DataTable
            columns={[
              { key: 'tour', label: 'Tour', numeric: false },
              { key: 'debut', label: 'Début', numeric: false },
              { key: 'fin', label: 'Fin', numeric: false },
              { key: 'controleur', label: 'Contrôleur', numeric: false },
              { key: 'lignes', label: 'Lignes', numeric: false },
              { key: 'employees', label: 'Employées', numeric: false },
              { key: 'couverture', label: 'Couverture', numeric: true },
              { key: 'statut', label: 'Statut', numeric: false },
            ]}
            isEmpty={(controlRounds.data ?? []).length === 0}
            emptyText="Aucun tour de contrôle pour ce Run."
          >
            {(controlRounds.data ?? []).map((row) => (
              <tr key={row.id}>
                <td>
                  <Link to={`/production/controles/${row.id}`}>
                    <strong>{row.roundCode}</strong>
                  </Link>
                </td>
                <td>{formatDateTime(row.startedAt)}</td>
                <td>{formatDateTime(row.endedAt)}</td>
                <td>{row.controllerName}</td>
                <td>
                  {row.linesCompleted} / {row.linesVisited}
                </td>
                <td>
                  {row.employeesControlled} / {row.employeesExpected}
                </td>
                <td className="nombre">
                  {row.coveragePercent === null ? '-' : `${row.coveragePercent} %`}
                </td>
                <td>
                  <Badge value={row.status} />
                </td>
              </tr>
            ))}
          </DataTable>
        </Card>
      ) : null}

      {tab === 'Cadence' ? (
        <Card title="Cadence mesurée sur ce Run">
          <DataTable
            columns={[
              { key: 'heure', label: 'Heure', numeric: false },
              { key: 'ligne', label: 'Ligne', numeric: false },
              { key: 'matricule', label: 'Matricule', numeric: false },
              { key: 'employee', label: 'Employée', numeric: false },
              { key: 'quantite', label: 'Quantité', numeric: true },
              { key: 'cadence', label: 'Cadence', numeric: true },
              { key: 'performance', label: 'Performance', numeric: false },
            ]}
            isEmpty={(cadenceHistory.data ?? []).length === 0}
            emptyText="Aucune mesure de cadence pour ce Run."
          >
            {(cadenceHistory.data ?? []).map((row) => (
              <tr key={row.id}>
                <td>{formatDateTime(row.controlledAt)}</td>
                <td>{row.lineCode}</td>
                <td>{row.employeeNumber}</td>
                <td>{row.employeeName}</td>
                <td className="nombre">
                  {row.quantityCompleted} {label(row.measurementUnit)}
                </td>
                <td className="nombre">{row.cadencePerHour} / h</td>
                <td>
                  {row.performancePercent === null ? (
                    <span className="badge">Standard non défini</span>
                  ) : (
                    <>
                      {row.performancePercent} %{' '}
                      {row.performanceStatus ? <Badge value={row.performanceStatus} /> : null}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </DataTable>
          <div className="ligne-boutons">
            <Link to="/production/cadence">
              <button type="button" className="secondaire">
                Voir toutes les mesures de cadence
              </button>
            </Link>
          </div>
        </Card>
      ) : null}

      {tab === 'Arrêts' ? (
        <Card title="Arrêts de production">
          {can('downtime:record') && isOpen ? (
            <form
              className="filtres"
              onSubmit={(event) => {
                event.preventDefault();
                void call(
                  () =>
                    apiPost(`/api/production/runs/${id}/arrets`, {
                      productionRunLineId: downtimeLineId === '' ? null : downtimeLineId,
                      downtimeCategoryId,
                      reasonText: downtimeReason.trim() === '' ? null : downtimeReason.trim(),
                      planned: downtimePlanned,
                      startedAt: new Date().toISOString(),
                    }),
                  'Arrêt démarré.',
                ).then(() => {
                  downtimeEvents.reload();
                  lineSummary.reload();
                  setDowntimeReason('');
                });
              }}
            >
              <select
                value={downtimeLineId}
                onChange={(event) => setDowntimeLineId(event.target.value)}
              >
                <option value="">Tout le Run</option>
                {data.lines.map((line) => (
                  <option key={line.id} value={line.id}>
                    {line.lineName}
                  </option>
                ))}
              </select>
              <select
                value={downtimeCategoryId}
                onChange={(event) => setDowntimeCategoryId(event.target.value)}
                required
              >
                <option value="">Catégorie...</option>
                {(downtimeCategories.data ?? []).map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
              <input
                placeholder="Motif (optionnel)"
                value={downtimeReason}
                onChange={(event) => setDowntimeReason(event.target.value)}
              />
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="checkbox"
                  checked={downtimePlanned}
                  onChange={(event) => setDowntimePlanned(event.target.checked)}
                />
                Planifié
              </label>
              <button type="submit">Démarrer l'arrêt</button>
            </form>
          ) : null}

          <DataTable
            columns={[
              { key: 'debut', label: 'Début', numeric: false },
              { key: 'fin', label: 'Fin', numeric: false },
              { key: 'duree', label: 'Durée', numeric: false },
              { key: 'ligne', label: 'Ligne', numeric: false },
              { key: 'categorie', label: 'Catégorie', numeric: false },
              { key: 'motif', label: 'Motif', numeric: false },
              { key: 'actions', label: '', numeric: false },
            ]}
            isEmpty={(downtimeEvents.data ?? []).length === 0}
            emptyText="Aucun arrêt enregistré pour ce Run."
          >
            {(downtimeEvents.data ?? []).map((row) => (
              <tr key={row.id}>
                <td>{formatDateTime(row.startedAt)}</td>
                <td>{row.endedAt ? formatDateTime(row.endedAt) : <Badge value="EN_COURS" />}</td>
                <td>{row.durationSeconds !== null ? formatDuration(row.durationSeconds) : '-'}</td>
                <td>{row.lineCode ?? <em>Tout le Run</em>}</td>
                <td>{row.categoryName}</td>
                <td>{row.reasonText ?? '-'}</td>
                <td>
                  {row.endedAt === null && can('downtime:record') ? (
                    <button
                      type="button"
                      className="lien"
                      onClick={() =>
                        call(
                          () =>
                            apiPost(`/api/downtime/${row.id}/cloture`, {
                              endedAt: new Date().toISOString(),
                            }),
                          'Arrêt terminé.',
                        ).then(() => {
                          downtimeEvents.reload();
                          lineSummary.reload();
                        })
                      }
                    >
                      Terminer
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </DataTable>
        </Card>
      ) : null}

      {tab === 'Remplissage' ? (
        <Card title="Remplissage">
          <div className="ligne-boutons" style={{ marginTop: 0, marginBottom: 16 }}>
            <Link to="/production/remplissage">
              <button type="button" className="secondaire">
                Gérer le remplissage
              </button>
            </Link>
          </div>
          <DataTable
            columns={[
              { key: 'operation', label: 'Opération', numeric: false },
              { key: 'produit', label: 'Produit', numeric: false },
              { key: 'format', label: 'Format', numeric: false },
              { key: 'debut', label: 'Début', numeric: false },
              { key: 'statut', label: 'Statut', numeric: false },
            ]}
            isEmpty={(genealogy.data?.fillingOperations ?? []).length === 0}
            emptyText="Aucune opération de remplissage pour ce Run."
          >
            {(genealogy.data?.fillingOperations ?? []).map((row) => (
              <tr key={row.id}>
                <td>{row.operationCode}</td>
                <td>{row.productCode}</td>
                <td>{row.format ?? '-'}</td>
                <td>{formatDateTime(row.startedAt)}</td>
                <td>
                  <Badge value={row.status} />
                </td>
              </tr>
            ))}
          </DataTable>

          <h3 style={{ marginTop: 24 }}>Contrôles poids</h3>
          <DataTable
            columns={[
              { key: 'controle', label: 'Contrôle', numeric: false },
              { key: 'date', label: 'Date', numeric: false },
              { key: 'echantillons', label: 'Échantillons', numeric: true },
              { key: 'sous', label: 'Sous-poids', numeric: true },
              { key: 'sur', label: 'Surpoids', numeric: true },
              { key: 'resultat', label: 'Résultat', numeric: false },
            ]}
            isEmpty={(genealogy.data?.weightControls ?? []).length === 0}
            emptyText="Aucun contrôle poids pour ce Run."
          >
            {(genealogy.data?.weightControls ?? []).map((row) => (
              <tr key={row.id}>
                <td>
                  <Link to={`/qualite/controles-poids/${row.id}`}>{row.controlCode}</Link>
                </td>
                <td>{formatDateTime(row.controlledAt)}</td>
                <td className="nombre">
                  {row.sampleCount} / {row.sampleSize}
                </td>
                <td className="nombre">{row.underweightCount}</td>
                <td className="nombre">{row.overweightCount}</td>
                <td>
                  <Badge value={row.controlStatus} />
                </td>
              </tr>
            ))}
          </DataTable>
        </Card>
      ) : null}

      {tab === 'Sertissage' ? (
        <Card title="Sertissage">
          <div className="ligne-boutons" style={{ marginTop: 0, marginBottom: 16 }}>
            <Link to="/production/sertissage">
              <button type="button" className="secondaire">
                Gérer le sertissage
              </button>
            </Link>
          </div>
          <DataTable
            columns={[
              { key: 'operation', label: 'Opération', numeric: false },
              { key: 'machine', label: 'Machine', numeric: false },
              { key: 'debut', label: 'Début', numeric: false },
              { key: 'statut', label: 'Statut', numeric: false },
            ]}
            isEmpty={(genealogy.data?.seamingOperations ?? []).length === 0}
            emptyText="Aucune opération de sertissage pour ce Run."
          >
            {(genealogy.data?.seamingOperations ?? []).map((row) => (
              <tr key={row.id}>
                <td>{row.operationCode}</td>
                <td>{row.machineCode ?? '-'}</td>
                <td>{formatDateTime(row.startedAt)}</td>
                <td>
                  <Badge value={row.status} />
                </td>
              </tr>
            ))}
          </DataTable>

          <h3 style={{ marginTop: 24 }}>Contrôles sertissage</h3>
          <DataTable
            columns={[
              { key: 'date', label: 'Date', numeric: false },
              { key: 'resultat', label: 'Résultat', numeric: false },
            ]}
            isEmpty={(genealogy.data?.seamingControls ?? []).length === 0}
            emptyText="Aucun contrôle sertissage pour ce Run."
          >
            {(genealogy.data?.seamingControls ?? []).map((row) => (
              <tr key={row.id}>
                <td>
                  <Link to={`/qualite/controles-sertissage/${row.id}`}>{formatDateTime(row.controlledAt)}</Link>
                </td>
                <td>
                  <Badge value={row.result} />
                  {row.nonConformeCount > 0 ? ` — ${row.nonConformeCount} hors spécification` : ''}
                </td>
              </tr>
            ))}
          </DataTable>

          <h3 style={{ marginTop: 24 }}>Marquage</h3>
          <DataTable
            columns={[
              { key: 'code', label: 'Code', numeric: false },
              { key: 'date', label: 'Date', numeric: false },
              { key: 'statut', label: 'Statut', numeric: false },
            ]}
            isEmpty={(genealogy.data?.markingEvents ?? []).length === 0}
            emptyText="Aucun marquage pour ce Run."
          >
            {(genealogy.data?.markingEvents ?? []).map((row) => (
              <tr key={row.id}>
                <td>{row.markingCode}</td>
                <td>{formatDateTime(row.markedAt)}</td>
                <td>
                  <Badge value={row.status} />
                </td>
              </tr>
            ))}
          </DataTable>
        </Card>
      ) : null}

      {tab === 'Stérilisation' ? (
        <Card title="Stérilisation">
          <div className="ligne-boutons" style={{ marginTop: 0, marginBottom: 16 }}>
            <Link to="/production/sterilisation">
              <button type="button" className="secondaire">
                Gérer la stérilisation
              </button>
            </Link>
          </div>
          <DataTable
            columns={[
              { key: 'cycle', label: 'Cycle', numeric: false },
              { key: 'autoclave', label: 'Autoclave', numeric: false },
              { key: 'debut', label: 'Début', numeric: false },
              { key: 'ccp', label: 'CCP', numeric: false },
              { key: 'statut', label: 'Statut', numeric: false },
            ]}
            isEmpty={(genealogy.data?.sterilizationCycles ?? []).length === 0}
            emptyText="Aucun cycle de stérilisation pour ce Run."
          >
            {(genealogy.data?.sterilizationCycles ?? []).map((row) => (
              <tr key={row.id}>
                <td>
                  <Link to={`/production/sterilisation/${row.id}`}>{row.cycleCode}</Link>
                </td>
                <td>{row.autoclaveCode}</td>
                <td>{formatDateTime(row.startedAt)}</td>
                <td>{row.latestCcpDecision ? <Badge value={row.latestCcpDecision} /> : '-'}</td>
                <td>
                  <Badge value={row.status} />
                </td>
              </tr>
            ))}
          </DataTable>
        </Card>
      ) : null}

      {tab === 'Sorties' ? (
        <>
          {can('production:output') && isOpen ? (
            <Card title="Enregistrer une sortie">
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void call(
                    () =>
                      apiPost(`/api/production/runs/${run.id}/sorties`, {
                        outputType,
                        quantityKg: outputQuantityKg,
                        occurredAt: new Date().toISOString(),
                        productionLineId: outputLineId === '' ? null : outputLineId,
                        destinationStageId: outputStageId === '' ? null : outputStageId,
                        destinationLocationId: null,
                        lossReasonId: null,
                        reasonText: null,
                        notes: outputNotes.trim() === '' ? null : outputNotes.trim(),
                      }),
                    'Sortie enregistrée.',
                  ).then(() => setOutputQuantityKg(''));
                }}
              >
                <div className="grille-champs">
                  <Field label="Type de sortie" hint={null}>
                    <select
                      value={outputType}
                      onChange={(event) => setOutputType(event.target.value)}
                    >
                      <option value="SORTIE_UTILE">Sortie utile</option>
                      <option value="AUTRE">Autre</option>
                    </select>
                  </Field>
                  <Field label="Quantité (kg)" hint={null}>
                    <input
                      value={outputQuantityKg}
                      onChange={(event) => setOutputQuantityKg(event.target.value)}
                      inputMode="decimal"
                      required
                    />
                  </Field>
                  <Field label="Étape de destination" hint="Par exemple : remplissage.">
                    <select
                      value={outputStageId}
                      onChange={(event) => setOutputStageId(event.target.value)}
                    >
                      <option value="">Non renseignée</option>
                      {(stages.data ?? []).map((stage) => (
                        <option key={stage.id} value={stage.id}>
                          {stage.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Ligne" hint={null}>
                    <select
                      value={outputLineId}
                      onChange={(event) => setOutputLineId(event.target.value)}
                    >
                      <option value="">Non renseignée</option>
                      {data.lines.map((line) => (
                        <option key={line.id} value={line.id}>
                          {line.lineName}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Commentaire" hint={null}>
                    <input
                      value={outputNotes}
                      onChange={(event) => setOutputNotes(event.target.value)}
                    />
                  </Field>
                </div>
                <div className="ligne-boutons">
                  <button type="submit">Enregistrer la sortie</button>
                </div>
              </form>
            </Card>
          ) : null}

          <Card title="Sorties enregistrées">
            <DataTable
              columns={[
                { key: 'heure', label: 'Heure', numeric: false },
                { key: 'type', label: 'Type', numeric: false },
                { key: 'etape', label: 'Étape', numeric: false },
                { key: 'ligne', label: 'Ligne', numeric: false },
                { key: 'utilisateur', label: 'Utilisateur', numeric: false },
                { key: 'statut', label: 'Statut', numeric: false },
                { key: 'quantite', label: 'Quantité (kg)', numeric: true },
              ]}
              isEmpty={usefulOutputs.length === 0}
              emptyText="Aucune sortie enregistrée."
            >
              {usefulOutputs.map((row) => (
                <tr key={row.id}>
                  <td>{formatDateTime(row.occurredAt)}</td>
                  <td>
                    <Badge value={row.outputType} />
                  </td>
                  <td>{row.stageCode ? label(row.stageCode) : '-'}</td>
                  <td>{row.lineCode ?? '-'}</td>
                  <td>{row.createdByName}</td>
                  <td>
                    <Badge value={row.status} />
                  </td>
                  <td className="nombre">{formatQuantity(row.quantityKg)}</td>
                </tr>
              ))}
            </DataTable>
          </Card>
        </>
      ) : null}

      {tab === 'Pertes' ? (
        <>
          {can('production:output') && isOpen ? (
            <Card title="Déclarer une perte">
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void call(
                    () =>
                      apiPost(`/api/production/runs/${run.id}/sorties`, {
                        outputType: lossType,
                        quantityKg: lossQuantityKg,
                        occurredAt: new Date().toISOString(),
                        productionLineId: lossLineId === '' ? null : lossLineId,
                        destinationStageId: null,
                        destinationLocationId: null,
                        lossReasonId: lossReasonId === '' ? null : lossReasonId,
                        reasonText: null,
                        notes: lossNotes.trim() === '' ? null : lossNotes.trim(),
                      }),
                    'Déclaration enregistrée.',
                  ).then(() => setLossQuantityKg(''));
                }}
              >
                <div className="grille-champs">
                  <Field label="Type" hint="Une perte réelle, un sous-produit et un rework ne sont pas la même chose.">
                    <select
                      value={lossType}
                      onChange={(event) => {
                        setLossType(event.target.value);
                        setLossReasonId('');
                      }}
                    >
                      {LOSS_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {label(type)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Motif" hint={null}>
                    <select
                      value={lossReasonId}
                      onChange={(event) => setLossReasonId(event.target.value)}
                      required={lossType === 'PERTE_REELLE'}
                    >
                      <option value="">Sélectionner...</option>
                      {(lossReasons.data ?? [])
                        .filter((reason) => reason.outputType === lossType)
                        .map((reason) => (
                          <option key={reason.id} value={reason.id}>
                            {reason.name}
                          </option>
                        ))}
                    </select>
                  </Field>
                  <Field label="Quantité (kg)" hint={null}>
                    <input
                      value={lossQuantityKg}
                      onChange={(event) => setLossQuantityKg(event.target.value)}
                      inputMode="decimal"
                      required
                    />
                  </Field>
                  <Field label="Ligne" hint={null}>
                    <select
                      value={lossLineId}
                      onChange={(event) => setLossLineId(event.target.value)}
                    >
                      <option value="">Non renseignée</option>
                      {data.lines.map((line) => (
                        <option key={line.id} value={line.id}>
                          {line.lineName}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Commentaire" hint={null}>
                    <input
                      value={lossNotes}
                      onChange={(event) => setLossNotes(event.target.value)}
                    />
                  </Field>
                </div>
                <div className="ligne-boutons">
                  <button type="submit">Déclarer</button>
                </div>
              </form>
            </Card>
          ) : null}

          <Card title="Pertes, sous-produits, rework et reclassements">
            <DataTable
              columns={[
                { key: 'heure', label: 'Heure', numeric: false },
                { key: 'type', label: 'Type', numeric: false },
                { key: 'motif', label: 'Motif', numeric: false },
                { key: 'ligne', label: 'Ligne', numeric: false },
                { key: 'utilisateur', label: 'Utilisateur', numeric: false },
                { key: 'statut', label: 'Statut', numeric: false },
                { key: 'quantite', label: 'Quantité (kg)', numeric: true },
              ]}
              isEmpty={lossOutputs.length === 0}
              emptyText="Aucune perte déclarée."
            >
              {lossOutputs.map((row) => (
                <tr key={row.id}>
                  <td>{formatDateTime(row.occurredAt)}</td>
                  <td>
                    <Badge value={row.outputType} />
                  </td>
                  <td>{row.lossReasonName ?? row.reasonText ?? '-'}</td>
                  <td>{row.lineCode ?? '-'}</td>
                  <td>{row.createdByName}</td>
                  <td>
                    <Badge value={row.status} />
                  </td>
                  <td className="nombre">{formatQuantity(row.quantityKg)}</td>
                </tr>
              ))}
            </DataTable>
          </Card>
        </>
      ) : null}

      {tab === 'Bilan matière' ? (
        <Card title="Bilan matière">
          <DataTable
            columns={[
              { key: 'poste', label: 'Poste', numeric: false },
              { key: 'quantite', label: 'Quantité (kg)', numeric: true },
            ]}
            isEmpty={false}
            emptyText=""
          >
            <tr>
              <td>
                <strong>Entrée MP</strong>
              </td>
              <td className="nombre">
                <strong>{formatQuantity(run.inputKg)}</strong>
              </td>
            </tr>
            <tr>
              <td>Sortie utile</td>
              <td className="nombre">{formatQuantity(run.usefulKg)}</td>
            </tr>
            <tr>
              <td>Sous-produits</td>
              <td className="nombre">{formatQuantity(run.byProductKg)}</td>
            </tr>
            <tr>
              <td>Rework</td>
              <td className="nombre">{formatQuantity(run.reworkKg)}</td>
            </tr>
            <tr>
              <td>Reclassement</td>
              <td className="nombre">{formatQuantity(run.reclassifiedKg)}</td>
            </tr>
            <tr>
              <td>Pertes réelles</td>
              <td className="nombre">{formatQuantity(run.realLossKg)}</td>
            </tr>
            <tr>
              <td>
                <strong>Total justifié</strong>
              </td>
              <td className="nombre">
                <strong>{formatQuantity(run.accountedKg)}</strong>
              </td>
            </tr>
            <tr>
              <td>
                <strong>Écart matière</strong> ({label(run.balanceStatus)})
              </td>
              <td className="nombre">
                <strong>
                  {formatQuantity(run.differenceKg)}
                  {run.differencePercent === null ? '' : ` (${run.differencePercent} %)`}
                </strong>
              </td>
            </tr>
            <tr>
              <td>
                <strong>Rendement matière</strong>
              </td>
              <td className="nombre">
                <strong>{run.yieldPercent === null ? '-' : `${run.yieldPercent} %`}</strong>
              </td>
            </tr>
          </DataTable>

          {run.differenceJustification ? (
            <div className="message info" style={{ marginTop: 16 }}>
              Écart justifié par {run.justifiedByName} le {formatDateTime(run.justifiedAt)} :{' '}
              {run.differenceJustification}
            </div>
          ) : null}

          {can('production:run') && run.balanceStatus === 'ECART_A_JUSTIFIER' && !run.isJustified ? (
            <div style={{ marginTop: 16 }}>
              <Field label="Justification de l'écart matière" hint={null}>
                <input
                  value={justification}
                  onChange={(event) => setJustification(event.target.value)}
                  placeholder="Expliquez l'origine de l'écart"
                />
              </Field>
              <div className="ligne-boutons">
                <button
                  type="button"
                  disabled={justification.trim() === ''}
                  onClick={() =>
                    call(
                      () =>
                        apiPost(`/api/production/runs/${run.id}/justification-ecart`, {
                          justification: justification.trim(),
                        }),
                      'Écart matière justifié.',
                    )
                  }
                >
                  Justifier l'écart
                </button>
              </div>
            </div>
          ) : null}
        </Card>
      ) : null}

      {tab === 'Traçabilité' ? (
        <Card title="Lots consommés par ce Run">
          <DataTable
            columns={[
              { key: 'lot', label: 'Lot MP', numeric: false },
              { key: 'espece', label: 'Espèce', numeric: false },
              { key: 'calibre', label: 'Calibre connu', numeric: false },
              { key: 'emplacement', label: 'Emplacement source', numeric: false },
              { key: 'quantite', label: 'Quantité consommée (kg)', numeric: true },
            ]}
            isEmpty={validConsumptions.length === 0}
            emptyText="Aucun lot consommé."
          >
            {validConsumptions.map((row) => (
              <tr key={row.id}>
                <td>
                  <Link to={`/lots/${row.lotId}`}>
                    <strong>{row.lotCode}</strong>
                  </Link>
                </td>
                <td>{row.speciesCode}</td>
                <td>{row.sizeGrade ?? '-'}</td>
                <td>{row.locationCode}</td>
                <td className="nombre">{formatQuantity(row.quantityKg)}</td>
              </tr>
            ))}
          </DataTable>
        </Card>
      ) : null}
    </>
  );
}
