import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiPost } from '../api';
import { useAuth } from '../auth';
import { Badge, Card, DataTable, Field, KeyValue, Message, PageHeader } from '../components/ui';
import { formatDateTime, formatDuration, label } from '../format';
import { useResource } from '../hooks';

type CycleDetail = Readonly<{
  cycle: Readonly<{
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
    openDeviationCount: number;
    latestCcpResult: string | null;
    latestCcpDecision: string | null;
    runCodes: readonly string[];
  }>;
  loads: readonly Readonly<{
    id: string;
    productionRunId: string;
    runCode: string;
    quantityUnits: number | null;
    basketReference: string | null;
  }>[];
  measurements: readonly Readonly<{
    id: string;
    measuredAt: string;
    temperatureC: string | null;
    pressureBar: string | null;
    f0Value: string | null;
    phase: string | null;
    sourceType: string;
    recordStatus: string;
  }>[];
  ccpControls: readonly Readonly<{
    id: string;
    controlledAt: string;
    ccpType: string;
    result: string;
    decision: string;
    controllerName: string;
    notes: string | null;
    recordStatus: string;
  }>[];
  cooling: readonly Readonly<{
    id: string;
    startedAt: string;
    endedAt: string | null;
    coolingMethod: string | null;
    waterTemperatureC: string | null;
    finalProductTemperatureC: string | null;
    result: string | null;
  }>[];
  deviations: readonly Readonly<{
    id: string;
    deviationCode: string;
    severity: string;
    status: string;
    description: string;
  }>[];
}>;

const ACTIVE_STATUSES = ['PLANIFIE', 'EN_CHARGEMENT', 'EN_COURS', 'A_VERIFIER'];

/** Elapsed time since the cycle started, refreshed periodically, never persisted (section 51/52). */
function ElapsedTime({ startedAt, endedAt }: { startedAt: string; endedAt: string | null }) {
  const [now, setNow] = useState(() => Date.now());
  useState(() => {
    const interval = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(interval);
  });
  const end = endedAt ? new Date(endedAt).getTime() : now;
  const seconds = Math.max(0, Math.floor((end - new Date(startedAt).getTime()) / 1000));
  return <>{formatDuration(seconds)}</>;
}

export function SterilisationCycle() {
  const { id } = useParams();
  const resource = useResource<CycleDetail>(`/api/sterilization-cycles/${id}`);
  const { can } = useAuth();

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [temperatureC, setTemperatureC] = useState('');
  const [pressureBar, setPressureBar] = useState('');
  const [f0Value, setF0Value] = useState('');
  const [phase, setPhase] = useState('');

  const [ccpType, setCcpType] = useState('');
  const [ccpResult, setCcpResult] = useState('CONFORME');
  const [ccpDecision, setCcpDecision] = useState('LIBERE');
  const [ccpNotes, setCcpNotes] = useState('');

  const [coolingMethod, setCoolingMethod] = useState('');
  const [waterTemperatureC, setWaterTemperatureC] = useState('');

  const [deviationDescription, setDeviationDescription] = useState('');
  const [deviationSeverity, setDeviationSeverity] = useState('MINEURE');

  const call = async (action: () => Promise<unknown>, message: string) => {
    setError(null);
    setSuccess(null);
    try {
      await action();
      setSuccess(message);
      resource.reload();
    } catch (failure) {
      setError((failure as Error).message);
    }
  };

  if (resource.loading && resource.data === null) {
    return <p>Chargement...</p>;
  }
  if (resource.data === null) {
    return <div className="message erreur">{resource.error ?? 'Cycle de stérilisation introuvable.'}</div>;
  }

  const { cycle, loads, measurements, ccpControls, cooling, deviations } = resource.data;
  const isActive = ACTIVE_STATUSES.includes(cycle.status);
  const openCooling = cooling.find((event) => event.endedAt === null);

  return (
    <>
      <PageHeader
        title={`Cycle ${cycle.cycleCode}`}
        subtitle={`${cycle.autoclaveCode} — Programme ${cycle.programCode} — ${cycle.programName}`}
        actions={
          <>
            <Badge value={cycle.status} />
            {can('sterilization:operate') && cycle.status === 'EN_CHARGEMENT' ? (
              <button
                type="button"
                onClick={() =>
                  call(() => apiPost(`/api/sterilization-cycles/${cycle.id}/demarrage`, {}), 'Cycle démarré.')
                }
              >
                Démarrer
              </button>
            ) : null}
            {can('sterilization:operate') && isActive ? (
              <button
                type="button"
                onClick={() =>
                  call(async () => {
                    const result = await apiPost<{ status: string; message: string | null }>(
                      `/api/sterilization-cycles/${cycle.id}/cloture`,
                      {},
                    );
                    if (result.message) {
                      throw new Error(result.message);
                    }
                  }, 'Cycle terminé.')
                }
              >
                Terminer le cycle
              </button>
            ) : null}
          </>
        }
      />

      <Message kind="erreur" text={error} />
      <Message kind="succes" text={success} />

      {cycle.status === 'A_VERIFIER' ? (
        <div className="message erreur">
          Cycle incomplet. Des données CCP obligatoires sont manquantes.
        </div>
      ) : null}
      {cycle.status === 'BLOQUE' ? (
        <div className="message erreur">
          Le cycle est terminé mais le matériel reste retenu par une décision CCP : voir « Lots bloqués » /
          retenues de Run.
        </div>
      ) : null}

      <Card title={null}>
        <KeyValue
          items={[
            { key: 'Run(s) / charge', value: loads.map((load) => load.runCode).join(', ') || '-' },
            { key: 'Début', value: formatDateTime(cycle.startedAt) },
            { key: 'Temps écoulé', value: <ElapsedTime startedAt={cycle.startedAt} endedAt={cycle.endedAt} /> },
            { key: 'F0 maximum mesuré', value: cycle.maxF0Value ?? '-' },
            {
              key: 'CCP',
              value: cycle.latestCcpDecision ? <Badge value={cycle.latestCcpDecision} /> : 'Aucune donnée',
            },
          ]}
        />
      </Card>

      <Card title="Mesures du procédé">
        <p style={{ color: 'var(--texte-doux)', marginTop: 0 }}>
          Saisie manuelle : aucune intégration directe avec l'autoclave n'existe à ce jour (section 52).
        </p>
        {can('sterilization:operate') && isActive ? (
          <form
            className="grille-champs"
            onSubmit={(event) => {
              event.preventDefault();
              void call(
                () =>
                  apiPost(`/api/sterilization-cycles/${cycle.id}/mesures`, {
                    measuredAt: new Date().toISOString(),
                    temperatureC: temperatureC.trim() === '' ? null : temperatureC.trim(),
                    pressureBar: pressureBar.trim() === '' ? null : pressureBar.trim(),
                    f0Value: f0Value.trim() === '' ? null : f0Value.trim(),
                    phase: phase.trim() === '' ? null : phase.trim(),
                    sourceType: 'MANUEL',
                  }),
                'Mesure enregistrée.',
              ).then(() => {
                setTemperatureC('');
                setPressureBar('');
                setF0Value('');
                setPhase('');
              });
            }}
          >
            <Field label="Température (°C)" hint={null}>
              <input value={temperatureC} onChange={(event) => setTemperatureC(event.target.value)} inputMode="decimal" />
            </Field>
            <Field label="Pression (bar)" hint={null}>
              <input value={pressureBar} onChange={(event) => setPressureBar(event.target.value)} inputMode="decimal" />
            </Field>
            <Field label="F0" hint={null}>
              <input value={f0Value} onChange={(event) => setF0Value(event.target.value)} inputMode="decimal" />
            </Field>
            <Field label="Phase" hint="Ex : montée, palier, fin de palier.">
              <input value={phase} onChange={(event) => setPhase(event.target.value)} />
            </Field>
            <div style={{ alignSelf: 'end' }}>
              <button type="submit">Enregistrer</button>
            </div>
          </form>
        ) : null}

        <DataTable
          columns={[
            { key: 'heure', label: 'Heure', numeric: false },
            { key: 'temp', label: 'Température', numeric: true },
            { key: 'pression', label: 'Pression', numeric: true },
            { key: 'f0', label: 'F0', numeric: true },
            { key: 'phase', label: 'Phase', numeric: false },
            { key: 'source', label: 'Source', numeric: false },
          ]}
          isEmpty={measurements.filter((m) => m.recordStatus === 'VALIDE').length === 0}
          emptyText="Aucune mesure enregistrée."
        >
          {measurements
            .filter((m) => m.recordStatus === 'VALIDE')
            .map((measurement) => (
              <tr key={measurement.id}>
                <td>{formatDateTime(measurement.measuredAt)}</td>
                <td className="nombre">{measurement.temperatureC ? `${measurement.temperatureC} °C` : '-'}</td>
                <td className="nombre">{measurement.pressureBar ? `${measurement.pressureBar} bar` : '-'}</td>
                <td className="nombre">{measurement.f0Value ?? '-'}</td>
                <td>{measurement.phase ?? '-'}</td>
                <td>{label(measurement.sourceType)}</td>
              </tr>
            ))}
        </DataTable>
      </Card>

      <Card title="CCP">
        {can('ccp:validate') && isActive ? (
          <form
            className="grille-champs"
            onSubmit={(event) => {
              event.preventDefault();
              void call(
                () =>
                  apiPost(`/api/sterilization-cycles/${cycle.id}/ccp`, {
                    controlledAt: new Date().toISOString(),
                    ccpType: ccpType.trim(),
                    result: ccpResult,
                    decision: ccpDecision,
                    notes: ccpNotes.trim() === '' ? null : ccpNotes.trim(),
                  }),
                'Décision CCP enregistrée.',
              ).then(() => {
                setCcpType('');
                setCcpNotes('');
              });
            }}
          >
            <Field label="Type de CCP" hint="Ex : F0 minimum, température minimale.">
              <input value={ccpType} onChange={(event) => setCcpType(event.target.value)} required />
            </Field>
            <Field label="Résultat" hint={null}>
              <select value={ccpResult} onChange={(event) => setCcpResult(event.target.value)}>
                <option value="CONFORME">Conforme</option>
                <option value="NON_CONFORME">Non conforme</option>
                <option value="DEVIATION">Déviation</option>
                <option value="A_VERIFIER">À vérifier</option>
              </select>
            </Field>
            <Field label="Décision" hint="Retenu déclenche une retenue sur chaque Run chargé.">
              <select value={ccpDecision} onChange={(event) => setCcpDecision(event.target.value)}>
                <option value="LIBERE">Libéré</option>
                <option value="RETENU">Retenu</option>
                <option value="A_VERIFIER">À vérifier</option>
              </select>
            </Field>
            <Field label="Observations" hint={null}>
              <input value={ccpNotes} onChange={(event) => setCcpNotes(event.target.value)} />
            </Field>
            <div style={{ alignSelf: 'end' }}>
              <button type="submit" disabled={ccpType.trim() === ''}>
                Enregistrer la décision
              </button>
            </div>
          </form>
        ) : null}

        <DataTable
          columns={[
            { key: 'heure', label: 'Heure', numeric: false },
            { key: 'type', label: 'Type', numeric: false },
            { key: 'resultat', label: 'Résultat', numeric: false },
            { key: 'decision', label: 'Décision', numeric: false },
            { key: 'controleur', label: 'Contrôleur', numeric: false },
          ]}
          isEmpty={ccpControls.filter((c) => c.recordStatus === 'VALIDE').length === 0}
          emptyText="Aucune décision CCP enregistrée."
        >
          {ccpControls
            .filter((c) => c.recordStatus === 'VALIDE')
            .map((ccp) => (
              <tr key={ccp.id}>
                <td>{formatDateTime(ccp.controlledAt)}</td>
                <td>{ccp.ccpType}</td>
                <td>
                  <Badge value={ccp.result} />
                </td>
                <td>
                  <Badge value={ccp.decision} />
                </td>
                <td>{ccp.controllerName}</td>
              </tr>
            ))}
        </DataTable>
      </Card>

      <Card title="Refroidissement">
        {can('sterilization:operate') ? (
          <div className="ligne-boutons" style={{ marginTop: 0 }}>
            {!openCooling ? (
              <form
                className="filtres"
                onSubmit={(event) => {
                  event.preventDefault();
                  void call(
                    () =>
                      apiPost(`/api/sterilization-cycles/${cycle.id}/refroidissement`, {
                        startedAt: new Date().toISOString(),
                        coolingMethod: coolingMethod.trim() === '' ? null : coolingMethod.trim(),
                        waterTemperatureC: waterTemperatureC.trim() === '' ? null : waterTemperatureC.trim(),
                      }),
                    'Refroidissement démarré.',
                  ).then(() => {
                    setCoolingMethod('');
                    setWaterTemperatureC('');
                  });
                }}
              >
                <input
                  placeholder="Méthode (ex : eau chlorée)"
                  value={coolingMethod}
                  onChange={(event) => setCoolingMethod(event.target.value)}
                />
                <input
                  placeholder="Température eau (°C)"
                  value={waterTemperatureC}
                  onChange={(event) => setWaterTemperatureC(event.target.value)}
                  inputMode="decimal"
                />
                <button type="submit">Démarrer le refroidissement</button>
              </form>
            ) : (
              <button
                type="button"
                onClick={() =>
                  call(
                    () =>
                      apiPost(`/api/cooling-events/${openCooling.id}/cloture`, {
                        endedAt: new Date().toISOString(),
                        finalProductTemperatureC: null,
                        result: 'CONFORME',
                      }),
                    'Refroidissement terminé.',
                  )
                }
              >
                Terminer le refroidissement
              </button>
            )}
          </div>
        ) : null}

        <DataTable
          columns={[
            { key: 'debut', label: 'Début', numeric: false },
            { key: 'fin', label: 'Fin', numeric: false },
            { key: 'methode', label: 'Méthode', numeric: false },
            { key: 'temp_finale', label: 'Température finale', numeric: true },
            { key: 'resultat', label: 'Résultat', numeric: false },
          ]}
          isEmpty={cooling.length === 0}
          emptyText="Aucun refroidissement enregistré."
        >
          {cooling.map((event) => (
            <tr key={event.id}>
              <td>{formatDateTime(event.startedAt)}</td>
              <td>{event.endedAt ? formatDateTime(event.endedAt) : <Badge value="EN_COURS" />}</td>
              <td>{event.coolingMethod ?? '-'}</td>
              <td className="nombre">
                {event.finalProductTemperatureC ? `${event.finalProductTemperatureC} °C` : '-'}
              </td>
              <td>{event.result ? <Badge value={event.result} /> : '-'}</td>
            </tr>
          ))}
        </DataTable>
      </Card>

      <Card title="Déviations">
        {can('deviation:manage') ? (
          <form
            className="filtres"
            onSubmit={(event) => {
              event.preventDefault();
              void call(
                () =>
                  apiPost('/api/deviations', {
                    productionRunId: null,
                    sterilizationCycleId: cycle.id,
                    processStage: 'STERILISATION',
                    detectedAt: new Date().toISOString(),
                    deviationType: 'AUTRE',
                    description: deviationDescription.trim(),
                    severity: deviationSeverity,
                  }),
                'Déviation créée.',
              ).then(() => setDeviationDescription(''));
            }}
          >
            <select value={deviationSeverity} onChange={(event) => setDeviationSeverity(event.target.value)}>
              <option value="MINEURE">Mineure</option>
              <option value="MAJEURE">Majeure</option>
              <option value="CRITIQUE">Critique</option>
            </select>
            <input
              placeholder="Description de la déviation"
              value={deviationDescription}
              onChange={(event) => setDeviationDescription(event.target.value)}
              style={{ minWidth: 260 }}
            />
            <button type="submit" disabled={deviationDescription.trim() === ''}>
              Déclarer
            </button>
          </form>
        ) : null}

        <DataTable
          columns={[
            { key: 'code', label: 'Déviation', numeric: false },
            { key: 'gravite', label: 'Gravité', numeric: false },
            { key: 'description', label: 'Description', numeric: false },
            { key: 'statut', label: 'Statut', numeric: false },
          ]}
          isEmpty={deviations.length === 0}
          emptyText="Aucune déviation sur ce cycle."
        >
          {deviations.map((deviation) => (
            <tr key={deviation.id}>
              <td>
                <Link to="/qualite/deviations">{deviation.deviationCode}</Link>
              </td>
              <td>
                <Badge value={deviation.severity} />
              </td>
              <td>{deviation.description}</td>
              <td>
                <Badge value={deviation.status} />
              </td>
            </tr>
          ))}
        </DataTable>
      </Card>
    </>
  );
}
