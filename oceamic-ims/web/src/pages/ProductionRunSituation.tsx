import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiPost } from '../api';
import { useAuth } from '../auth';
import { Badge, Card, DataTable, Field, KeyValue, Message, PageHeader } from '../components/ui';
import { formatDate, formatDateTime, formatQuantity, label, nowLocalInput } from '../format';
import { useResource } from '../hooks';
import { useLossReasons, useProductionStages } from '../masterdata';

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

const TABS = [
  'Vue générale',
  'Lots consommés',
  'Lignes',
  'Sorties',
  'Pertes',
  'Bilan matière',
  'Traçabilité',
] as const;

const LOSS_TYPES = ['PERTE_REELLE', 'SOUS_PRODUIT', 'REWORK', 'RECLASSEMENT'] as const;

/** "Situation du Run": one page, one tab per concern. */
export function ProductionRunSituation() {
  const { id } = useParams();
  const { can } = useAuth();
  const { data, error, loading, reload } = useResource<RunDetailPayload>(
    `/api/production/runs/${id}`,
  );
  const situation = useResource<readonly StockLine[]>('/api/stock/situation');
  const locations = useResource<readonly LocationRow[]>('/api/locations');
  const stages = useProductionStages();
  const lossReasons = useLossReasons();

  const [tab, setTab] = useState<(typeof TABS)[number]>('Vue générale');
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

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
        <Card title="Lignes du Run">
          <DataTable
            columns={[
              { key: 'ligne', label: 'Ligne', numeric: false },
              { key: 'zone', label: 'Zone', numeric: false },
              { key: 'activite', label: 'Activité', numeric: false },
              { key: 'active', label: 'Active', numeric: false },
            ]}
            isEmpty={data.lines.length === 0}
            emptyText="Aucune ligne configurée pour ce Run."
          >
            {data.lines.map((row) => (
              <tr key={row.id}>
                <td>
                  <strong>{row.lineName}</strong>
                </td>
                <td>{row.area ?? '-'}</td>
                <td>{label(row.activityType)}</td>
                <td>{row.isActiveForRun ? 'Oui' : 'Non'}</td>
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
