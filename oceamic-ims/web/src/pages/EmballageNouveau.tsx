import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiPost } from '../api';
import { Card, Field, Message, PageHeader } from '../components/ui';
import { useResource } from '../hooks';

type RunOption = Readonly<{ id: string; runCode: string; status: string }>;
type CycleOption = Readonly<{ id: string; cycleCode: string; status: string; runCodes: readonly string[] }>;

/**
 * Creates a Finished Goods Lot in one operator-facing step (section 5): the
 * packaging batch is created first, transparently, then the Lot PF itself -
 * two distinct domain records (section 62), one screen.
 */
export function EmballageNouveau() {
  const navigate = useNavigate();
  const runs = useResource<readonly RunOption[]>('/api/production/runs');
  const cycles = useResource<readonly CycleOption[]>('/api/sterilization-cycles');

  const [runId, setRunId] = useState('');
  const [cycleId, setCycleId] = useState('');
  const [format, setFormat] = useState('');
  const [piecesPerCan, setPiecesPerCan] = useState('');
  const [productionDate, setProductionDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [bestBeforeDate, setBestBeforeDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const cyclesForRun = (cycles.data ?? []).filter((cycle) => cycle.runCodes.length > 0);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const batch = await apiPost<{ id: string }>('/api/packaging-batches', {
        productionRunId: runId,
        sterilizationCycleId: cycleId,
        format: format.trim() === '' ? null : format.trim(),
        responsibleUserId: null,
        notes: null,
      });
      const lot = await apiPost<{ id: string }>(`/api/packaging-batches/${batch.id}/lots-pf`, {
        format: format.trim() === '' ? null : format.trim(),
        piecesPerCan: piecesPerCan.trim() === '' ? null : Number(piecesPerCan.trim()),
        productionDate,
        bestBeforeDate: bestBeforeDate.trim() === '' ? null : bestBeforeDate.trim(),
        notes: null,
        sources: [{ sterilizationCycleId: cycleId, productionRunId: runId, quantityUnits: null }],
      });
      navigate(`/emballage/lots-pf/${lot.id}`);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="Nouveau Lot PF" subtitle="Emballage d'un Run stérilisé" actions={null} />
      <Message kind="erreur" text={error} />

      <Card title={null}>
        <form onSubmit={submit}>
          <div className="grille-champs">
            <Field label="Run source" hint={null}>
              <select value={runId} onChange={(event) => setRunId(event.target.value)} required>
                <option value="">Sélectionner...</option>
                {(runs.data ?? []).map((run) => (
                  <option key={run.id} value={run.id}>
                    {run.runCode}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Cycle de stérilisation" hint="Le cycle doit avoir chargé le Run sélectionné.">
              <select value={cycleId} onChange={(event) => setCycleId(event.target.value)} required>
                <option value="">Sélectionner...</option>
                {cyclesForRun.map((cycle) => (
                  <option key={cycle.id} value={cycle.id}>
                    {cycle.cycleCode} — {cycle.runCodes.join(', ')}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Format" hint="Facultatif.">
              <input value={format} onChange={(event) => setFormat(event.target.value)} />
            </Field>
            <Field label="Pièces par boîte" hint="Facultatif.">
              <input
                value={piecesPerCan}
                onChange={(event) => setPiecesPerCan(event.target.value)}
                inputMode="numeric"
              />
            </Field>
            <Field label="Date de production" hint={null}>
              <input
                type="date"
                value={productionDate}
                onChange={(event) => setProductionDate(event.target.value)}
                required
              />
            </Field>
            <Field label="Date limite de consommation" hint="Facultatif.">
              <input
                type="date"
                value={bestBeforeDate}
                onChange={(event) => setBestBeforeDate(event.target.value)}
              />
            </Field>
          </div>
          <div className="ligne-boutons">
            <button type="submit" disabled={busy || !runId || !cycleId}>
              Créer le Lot PF
            </button>
          </div>
        </form>
      </Card>
    </>
  );
}
