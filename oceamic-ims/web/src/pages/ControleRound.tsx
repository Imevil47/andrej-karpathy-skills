import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiPost, RequestFailed } from '../api';
import { Badge, Card, Field, KeyValue, Message, PageHeader } from '../components/ui';
import { formatDateTime, label } from '../format';
import { useResource } from '../hooks';

type ControlRoundDetail = Readonly<{
  round: Readonly<{
    id: string;
    roundCode: string;
    productionRunId: string;
    runCode: string;
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
  lines: readonly Readonly<{
    id: string;
    productionRunLineId: string;
    lineCode: string;
    lineName: string;
    activityType: string;
    controlledAt: string;
    status: string;
    expectedEmployeeCount: number;
    controlledEmployeeCount: number;
    coveragePercent: string | null;
    coverageStatus: string;
    lineCadencePerHour: string | null;
  }>[];
  employeeControls: readonly Readonly<{
    id: string;
    employeeId: string;
    employeeNumber: string;
    employeeName: string;
    controlledAt: string;
    quantityCompleted: string;
    measurementUnit: string;
    measurementDurationSeconds: number;
    cadencePerHour: string;
    standardCadenceSnapshot: string | null;
    performancePercent: string | null;
    performanceStatus: string | null;
    status: string;
    cancellationReason: string | null;
  }>[];
}>;

type RunDetail = Readonly<{
  run: Readonly<{ id: string; runCode: string; productCode: string; speciesCode: string; status: string }>;
  lines: readonly Readonly<{
    id: string;
    lineCode: string;
    lineName: string;
    activityType: string;
    isActiveForRun: boolean;
  }>[];
}>;

type WorkforceRow = Readonly<{
  assignmentId: string;
  productionRunLineId: string;
  employeeId: string;
  employeeNumber: string;
  employeeName: string;
  isPresent: boolean;
}>;

const MEASUREMENT_UNITS = ['BOITES', 'PIECES', 'KG', 'UNITES'] as const;

/**
 * Terrain rapid-entry screen. The controller selects a line, then only ever
 * types a matricule's quantity: Run, product, species, line activity,
 * employee name, matched standard and timestamp are all already known
 * (section 48).
 */
export function ControleRound() {
  const { id } = useParams();
  const round = useResource<ControlRoundDetail>(`/api/cadence/control-rounds/${id}`);
  const runId = round.data?.round.productionRunId ?? null;
  const run = useResource<RunDetail>(runId ? `/api/production/runs/${runId}` : '');
  const workforce = useResource<readonly WorkforceRow[]>(
    runId ? `/api/production/runs/${runId}/personnel` : '',
  );

  const [selectedRunLineId, setSelectedRunLineId] = useState<string | null>(null);
  const [measurementUnit, setMeasurementUnit] = useState<string>('BOITES');
  const [durationSeconds, setDurationSeconds] = useState('600');
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busyEmployeeId, setBusyEmployeeId] = useState<string | null>(null);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const activeRunLines = useMemo(
    () => (run.data?.lines ?? []).filter((line) => line.isActiveForRun && line.activityType !== 'INACTIVE'),
    [run.data],
  );

  const lineControlByRunLine = useMemo(() => {
    const map = new Map<string, ControlRoundDetail['lines'][number]>();
    for (const line of round.data?.lines ?? []) {
      map.set(line.productionRunLineId, line);
    }
    return map;
  }, [round.data]);

  const selectedLineControl = selectedRunLineId
    ? (lineControlByRunLine.get(selectedRunLineId) ?? null)
    : null;

  const roster = useMemo(() => {
    if (!selectedRunLineId) {
      return [];
    }
    return (workforce.data ?? []).filter(
      (row) => row.productionRunLineId === selectedRunLineId && row.isPresent,
    );
  }, [workforce.data, selectedRunLineId]);

  const controlledByEmployeeId = useMemo(() => {
    const map = new Map<string, ControlRoundDetail['employeeControls'][number]>();
    if (!selectedLineControl) {
      return map;
    }
    for (const control of round.data?.employeeControls ?? []) {
      if (control.status === 'VALIDE') {
        map.set(control.employeeId, control);
      }
    }
    return map;
  }, [round.data, selectedLineControl]);

  const roundOpen = round.data?.round.status === 'EN_COURS';

  // Reset the selected line when the round data changes to a different round.
  useEffect(() => {
    setSelectedRunLineId(null);
  }, [id]);

  const selectLine = async (runLineId: string) => {
    setError(null);
    setSuccess(null);
    setSelectedRunLineId(runLineId);
    if (!lineControlByRunLine.has(runLineId) && round.data) {
      try {
        await apiPost(`/api/cadence/control-rounds/${round.data.round.id}/lignes`, {
          productionRunLineId: runLineId,
        });
        round.reload();
      } catch (failure) {
        setError((failure as Error).message);
      }
    }
  };

  const focusNext = (afterEmployeeId: string) => {
    const pending = roster.filter((row) => !controlledByEmployeeId.has(row.employeeId));
    const index = pending.findIndex((row) => row.employeeId === afterEmployeeId);
    const next = pending[index + 1] ?? pending.find((row) => row.employeeId !== afterEmployeeId);
    if (next) {
      inputRefs.current[next.employeeId]?.focus();
    }
  };

  const saveQuantity = async (
    row: WorkforceRow,
    confirmCrossLine: boolean,
  ): Promise<void> => {
    const lineControlId = selectedLineControl?.id;
    const quantity = quantities[row.employeeId];
    if (!lineControlId || !quantity || quantity.trim() === '') {
      return;
    }
    setBusyEmployeeId(row.employeeId);
    setError(null);
    setSuccess(null);
    try {
      const result = await apiPost<{ cadencePerHour: string; performancePercent: string | null }>(
        `/api/cadence/line-controls/${lineControlId}/employes`,
        {
          employeeNumber: row.employeeNumber,
          quantityCompleted: quantity.trim(),
          measurementUnit,
          measurementDurationSeconds: Number(durationSeconds),
          controlledAt: new Date().toISOString(),
          confirmCrossLine,
        },
      );
      setSuccess(
        `${row.employeeName} : ${result.cadencePerHour} / h` +
          (result.performancePercent === null ? '' : ` — ${result.performancePercent} %`),
      );
      setQuantities((current) => {
        const next = { ...current };
        delete next[row.employeeId];
        return next;
      });
      round.reload();
      focusNext(row.employeeId);
    } catch (failure) {
      if (failure instanceof RequestFailed && failure.code === 'CONFIRMATION_REQUISE') {
        if (window.confirm(`${failure.message}\n\nConfirmer la saisie sur cette ligne ?`)) {
          await saveQuantity(row, true);
          return;
        }
        return;
      }
      setError((failure as Error).message);
    } finally {
      setBusyEmployeeId(null);
    }
  };

  const closeLine = async () => {
    if (!selectedLineControl) {
      return;
    }
    setError(null);
    setSuccess(null);
    try {
      const coverage = await apiPost<{ coveragePercent: string | null; coverageStatus: string }>(
        `/api/cadence/line-controls/${selectedLineControl.id}/cloture`,
        {},
      );
      round.reload();
      if (coverage.coverageStatus === 'INCOMPLET') {
        setError(
          `Ligne terminée avec une couverture incomplète (${coverage.coveragePercent ?? '-'} %).`,
        );
      } else {
        setSuccess('Ligne terminée. Couverture complète.');
      }
    } catch (failure) {
      setError((failure as Error).message);
    }
  };

  const closeRound = async () => {
    if (!round.data) {
      return;
    }
    setError(null);
    setSuccess(null);
    try {
      const result = await apiPost<{
        summary: { employeesExpected: number; employeesControlled: number; coveragePercent: string | null };
      }>(`/api/cadence/control-rounds/${round.data.round.id}/cloture`, {});
      round.reload();
      setSuccess(
        `Tour terminé. Couverture : ${result.summary.employeesControlled} / ${result.summary.employeesExpected}` +
          (result.summary.coveragePercent === null ? '' : ` (${result.summary.coveragePercent} %)`),
      );
    } catch (failure) {
      setError((failure as Error).message);
    }
  };

  const cancelRound = async () => {
    if (!round.data) {
      return;
    }
    const reason = window.prompt("Motif d'annulation du tour de contrôle :", '');
    if (reason === null || reason.trim() === '') {
      return;
    }
    setError(null);
    try {
      await apiPost(`/api/cadence/control-rounds/${round.data.round.id}/annulation`, {
        reason: reason.trim(),
      });
      round.reload();
    } catch (failure) {
      setError((failure as Error).message);
    }
  };

  if (round.loading && round.data === null) {
    return <p>Chargement...</p>;
  }
  if (round.data === null) {
    return <div className="message erreur">{round.error ?? 'Tour de contrôle introuvable.'}</div>;
  }

  const { round: roundInfo } = round.data;

  return (
    <>
      <PageHeader
        title={`Tour de contrôle ${roundInfo.roundCode}`}
        subtitle={
          <>
            <Link to={`/production/${roundInfo.productionRunId}`}>{roundInfo.runCode}</Link>
            {run.data ? ` — ${run.data.run.productCode} — ${run.data.run.speciesCode}` : ''}
          </>
        }
        actions={
          <>
            <Badge value={roundInfo.status} />
            {roundOpen ? (
              <>
                <button type="button" onClick={closeRound}>
                  Terminer le tour
                </button>
                <button type="button" className="secondaire" onClick={cancelRound}>
                  Annuler le tour
                </button>
              </>
            ) : null}
          </>
        }
      />

      <Message kind="erreur" text={error} />
      <Message kind="succes" text={success} />

      <Card title={null}>
        <KeyValue
          items={[
            { key: 'Contrôleur', value: roundInfo.controllerName },
            { key: 'Démarré le', value: formatDateTime(roundInfo.startedAt) },
            { key: 'Terminé le', value: formatDateTime(roundInfo.endedAt) },
            {
              key: 'Couverture globale',
              value:
                roundInfo.coveragePercent === null
                  ? `${roundInfo.employeesControlled} / ${roundInfo.employeesExpected}`
                  : `${roundInfo.employeesControlled} / ${roundInfo.employeesExpected} (${roundInfo.coveragePercent} %)`,
            },
          ]}
        />
      </Card>

      <Card title="Progression des lignes">
        <div className="grille-champs">
          {activeRunLines.map((line) => {
            const lineControl = lineControlByRunLine.get(line.id);
            const isSelected = selectedRunLineId === line.id;
            return (
              <button
                key={line.id}
                type="button"
                className={isSelected ? '' : 'secondaire'}
                onClick={() => selectLine(line.id)}
                style={{ textAlign: 'left' }}
              >
                <div style={{ fontWeight: 700 }}>{line.lineName}</div>
                <div style={{ fontSize: 13, fontWeight: 400 }}>
                  {label(line.activityType)}
                  <br />
                  {lineControl
                    ? `${lineControl.controlledEmployeeCount} / ${lineControl.expectedEmployeeCount}` +
                      (lineControl.status === 'TERMINE' ? ' ✓' : ' — en cours')
                    : 'À contrôler'}
                </div>
              </button>
            );
          })}
        </div>
        {run.data && run.data.lines.length > activeRunLines.length ? (
          <p style={{ color: 'var(--texte-doux)', marginTop: 12, marginBottom: 0 }}>
            {run.data.lines.length - activeRunLines.length} ligne(s) inactive(s) pour ce Run, non
            affichée(s).
          </p>
        ) : null}
      </Card>

      {selectedRunLineId && selectedLineControl ? (
        <Card
          title={`Ligne ${
            activeRunLines.find((line) => line.id === selectedRunLineId)?.lineName ?? ''
          } — ${label(selectedLineControl.activityType)}`}
        >
          <KeyValue
            items={[
              {
                key: 'Couverture',
                value: `${selectedLineControl.controlledEmployeeCount} / ${selectedLineControl.expectedEmployeeCount}`,
              },
              {
                key: 'Statut',
                value: <Badge value={selectedLineControl.coverageStatus} />,
              },
              {
                key: 'Cadence ligne',
                value:
                  selectedLineControl.lineCadencePerHour === null
                    ? '-'
                    : `${selectedLineControl.lineCadencePerHour} / h`,
              },
            ]}
          />

          {roundOpen && selectedLineControl.status === 'EN_COURS' ? (
            <>
              <div className="grille-champs" style={{ marginTop: 16 }}>
                <Field label="Unité de mesure" hint={null}>
                  <select
                    value={measurementUnit}
                    onChange={(event) => setMeasurementUnit(event.target.value)}
                  >
                    {MEASUREMENT_UNITS.map((unit) => (
                      <option key={unit} value={unit}>
                        {label(unit)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Durée de mesure (secondes)" hint="600 = 10 minutes.">
                  <input
                    value={durationSeconds}
                    onChange={(event) => setDurationSeconds(event.target.value)}
                    inputMode="numeric"
                  />
                </Field>
              </div>

              <div className="tableau-conteneur" style={{ marginTop: 16 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Matricule</th>
                      <th>Nom</th>
                      <th className="nombre">Quantité</th>
                      <th className="nombre">Cadence</th>
                      <th>Performance</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {roster.map((row) => {
                      const done = controlledByEmployeeId.get(row.employeeId);
                      return (
                        <tr key={row.employeeId}>
                          <td>{row.employeeNumber}</td>
                          <td>{row.employeeName}</td>
                          <td className="nombre">
                            {done ? (
                              done.quantityCompleted
                            ) : (
                              <input
                                ref={(element) => {
                                  inputRefs.current[row.employeeId] = element;
                                }}
                                value={quantities[row.employeeId] ?? ''}
                                onChange={(event) =>
                                  setQuantities((current) => ({
                                    ...current,
                                    [row.employeeId]: event.target.value,
                                  }))
                                }
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter') {
                                    event.preventDefault();
                                    void saveQuantity(row, false);
                                  }
                                }}
                                inputMode="decimal"
                                disabled={busyEmployeeId === row.employeeId}
                                style={{ maxWidth: 100 }}
                              />
                            )}
                          </td>
                          <td className="nombre">{done ? `${done.cadencePerHour} / h` : '-'}</td>
                          <td>
                            {done ? (
                              done.performancePercent === null ? (
                                <span className="badge">Standard non défini</span>
                              ) : (
                                <>
                                  {done.performancePercent} %{' '}
                                  <Badge value={done.performanceStatus ?? ''} />
                                </>
                              )
                            ) : (
                              '-'
                            )}
                          </td>
                          <td>
                            {!done ? (
                              <button
                                type="button"
                                className="lien"
                                disabled={
                                  busyEmployeeId === row.employeeId ||
                                  !quantities[row.employeeId]?.trim()
                                }
                                onClick={() => void saveQuantity(row, false)}
                              >
                                Enregistrer
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {roster.length === 0 ? (
                  <p style={{ color: 'var(--texte-doux)' }}>
                    Aucune employée présente affectée à cette ligne. Affectez le personnel depuis la
                    situation du Run.
                  </p>
                ) : null}
              </div>

              <div className="ligne-boutons">
                <button type="button" onClick={closeLine}>
                  Terminer la ligne
                </button>
              </div>
            </>
          ) : (
            <p style={{ color: 'var(--texte-doux)' }}>
              Cette ligne est terminée. Historique consultable ci-dessous.
            </p>
          )}
        </Card>
      ) : null}
    </>
  );
}
