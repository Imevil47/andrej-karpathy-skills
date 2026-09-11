import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiPost } from '../api';
import { Card, Field, Message, PageHeader } from '../components/ui';
import { nowLocalInput } from '../format';
import { useResource } from '../hooks';
import { useEquipment, useSterilizationPrograms } from '../masterdata';

type RunOption = Readonly<{ id: string; runCode: string; status: string }>;

const OPEN_RUN_STATUSES = ['PLANIFIE', 'EN_COURS', 'SUSPENDU'];

/** Création d'un cycle de stérilisation (section 27/29) : autoclave, programme et charge(s). */
export function SterilisationNouveau() {
  const navigate = useNavigate();
  const autoclaves = useEquipment('AUTOCLAVE');
  const programs = useSterilizationPrograms();
  const runs = useResource<readonly RunOption[]>('/api/production/runs');

  const [autoclaveId, setAutoclaveId] = useState('');
  const [programId, setProgramId] = useState('');
  const [startedAt, setStartedAt] = useState(nowLocalInput());
  const [runId, setRunId] = useState('');
  const [quantityUnits, setQuantityUnits] = useState('');
  const [basketReference, setBasketReference] = useState('');
  const [error, setError] = useState<string | null>(null);

  const openRuns = (runs.data ?? []).filter((run) => OPEN_RUN_STATUSES.includes(run.status));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      const created = await apiPost<{ id: string }>('/api/sterilization-cycles', {
        autoclaveId,
        sterilizationProgramId: programId,
        startedAt: new Date(startedAt).toISOString(),
        operatorUserId: null,
        notes: null,
        loads: [
          {
            productionRunId: runId,
            quantityUnits: quantityUnits.trim() === '' ? null : Number(quantityUnits.trim()),
            basketReference: basketReference.trim() === '' ? null : basketReference.trim(),
            notes: null,
          },
        ],
      });
      navigate(`/production/sterilisation/${created.id}`);
    } catch (failure) {
      setError((failure as Error).message);
    }
  };

  return (
    <>
      <PageHeader title="Nouveau cycle de stérilisation" subtitle={null} actions={null} />
      <Message kind="erreur" text={error} />

      <Card title={null}>
        <form onSubmit={submit}>
          <div className="grille-champs">
            <Field label="Autoclave" hint={null}>
              <select value={autoclaveId} onChange={(event) => setAutoclaveId(event.target.value)} required>
                <option value="">Sélectionner...</option>
                {(autoclaves.data ?? []).map((equipment) => (
                  <option key={equipment.id} value={equipment.id}>
                    {equipment.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Programme" hint="Barème validé applicable au cycle.">
              <select value={programId} onChange={(event) => setProgramId(event.target.value)} required>
                <option value="">Sélectionner...</option>
                {(programs.data ?? []).map((program) => (
                  <option key={program.id} value={program.id}>
                    {program.code} — {program.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Début" hint={null}>
              <input
                type="datetime-local"
                value={startedAt}
                onChange={(event) => setStartedAt(event.target.value)}
                required
              />
            </Field>
            <Field label="Run chargé" hint="Au moins un Run doit être chargé dans le cycle.">
              <select value={runId} onChange={(event) => setRunId(event.target.value)} required>
                <option value="">Sélectionner...</option>
                {openRuns.map((run) => (
                  <option key={run.id} value={run.id}>
                    {run.runCode}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Quantité (unités)" hint="Facultatif.">
              <input
                value={quantityUnits}
                onChange={(event) => setQuantityUnits(event.target.value)}
                inputMode="numeric"
              />
            </Field>
            <Field label="Référence panier" hint="Facultatif.">
              <input value={basketReference} onChange={(event) => setBasketReference(event.target.value)} />
            </Field>
          </div>
          <div className="ligne-boutons">
            <button type="submit" disabled={!autoclaveId || !programId || !runId}>
              Créer le cycle
            </button>
          </div>
        </form>
      </Card>
    </>
  );
}
