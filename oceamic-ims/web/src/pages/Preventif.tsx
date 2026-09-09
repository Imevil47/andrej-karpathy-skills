import { Fragment, useState } from 'react';
import { apiGet, apiPost, buildQuery } from '../api';
import { useAuth } from '../auth';
import { Badge, Card, DataTable, Field, Message, PageHeader } from '../components/ui';
import { formatDate, label } from '../format';
import { useResource } from '../hooks';
import { useEquipment } from '../masterdata';

type PreventiveTaskRow = Readonly<{
  id: string;
  maintenancePlanId: string;
  planName: string;
  equipmentId: string;
  equipmentCode: string;
  equipmentName: string;
  dueAt: string;
  status: string;
  isOverdue: boolean;
  completedAt: string | null;
}>;

type ChecklistResponse = Readonly<{ checklistItemId: string; label: string; completed: boolean; comment: string | null }>;

const FREQUENCIES = ['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'ANNUAL', 'OPERATING_HOURS', 'CUSTOM'] as const;

const RANGES = [
  { key: 'aujourdhui', label: "Aujourd'hui", days: 0 },
  { key: '7jours', label: '7 prochains jours', days: 7 },
  { key: '30jours', label: '30 prochains jours', days: 30 },
  { key: 'enretard', label: 'En retard', days: null },
] as const;

/** Préventif (section 30) : vues calendrier simples, pas de Gantt complexe. */
export function Preventif() {
  const { can } = useAuth();
  const equipment = useEquipment();
  const [range, setRange] = useState<(typeof RANGES)[number]['key']>('enretard');
  const selectedRange = RANGES.find((r) => r.key === range) ?? RANGES[3];
  const query: Readonly<Record<string, string | null>> =
    selectedRange.days === null
      ? { enRetardUniquement: 'true', avantLe: null }
      : { avantLe: new Date(Date.now() + selectedRange.days * 24 * 60 * 60 * 1000).toISOString(), enRetardUniquement: null };
  const { data, error, loading, reload } = useResource<readonly PreventiveTaskRow[]>(
    `/api/preventive-tasks${buildQuery(query)}`,
  );

  const [equipmentId, setEquipmentId] = useState('');
  const [name, setName] = useState('');
  const [frequencyType, setFrequencyType] = useState<(typeof FREQUENCIES)[number]>('MONTHLY');
  const [checklistText, setChecklistText] = useState('');
  const [firstDueAt, setFirstDueAt] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);

  const [completingTaskId, setCompletingTaskId] = useState<string | null>(null);
  const [checklist, setChecklist] = useState<readonly ChecklistResponse[]>([]);
  const [checklistLoading, setChecklistLoading] = useState(false);

  const createPlan = async (event: React.FormEvent) => {
    event.preventDefault();
    setCreateError(null);
    try {
      await apiPost('/api/maintenance-plans', {
        equipmentId,
        name: name.trim(),
        frequencyType,
        checklistLabels: checklistText
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line !== ''),
        firstDueAt: new Date(firstDueAt).toISOString(),
      });
      setName('');
      setChecklistText('');
      setFirstDueAt('');
      reload();
    } catch (failure) {
      setCreateError((failure as Error).message);
    }
  };

  const openCompletion = async (taskId: string) => {
    setCompletingTaskId(taskId);
    setChecklistLoading(true);
    try {
      const rows = await apiGet<readonly ChecklistResponse[]>(`/api/preventive-tasks/${taskId}/checklist`);
      setChecklist(rows.map((row) => ({ ...row, completed: true })));
    } finally {
      setChecklistLoading(false);
    }
  };

  const submitCompletion = async (taskId: string) => {
    await apiPost(`/api/preventive-tasks/${taskId}/completion`, {
      notes: null,
      checklistResponses: checklist.map((item) => ({
        checklistItemId: item.checklistItemId,
        completed: item.completed,
        comment: item.comment,
      })),
    });
    setCompletingTaskId(null);
    reload();
  };

  return (
    <>
      <PageHeader title="Maintenance préventive" subtitle="Plans, échéances et réalisation" actions={null} />
      <Message kind="erreur" text={createError} />

      {can('preventive:manage') ? (
        <Card title="Nouveau plan préventif">
          <form id="creation" onSubmit={createPlan}>
            <div className="grille-champs">
              <Field label="Équipement" hint={null}>
                <select value={equipmentId} onChange={(event) => setEquipmentId(event.target.value)} required>
                  <option value="">Sélectionner...</option>
                  {(equipment.data ?? []).map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.code} — {item.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Nom du plan" hint={null}>
                <input value={name} onChange={(event) => setName(event.target.value)} required />
              </Field>
              <Field label="Fréquence" hint="Heures d'exploitation / personnalisée : échéance planifiée manuellement.">
                <select value={frequencyType} onChange={(event) => setFrequencyType(event.target.value as typeof frequencyType)}>
                  {FREQUENCIES.map((value) => (
                    <option key={value} value={value}>
                      {label(value)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Première échéance" hint={null}>
                <input type="date" value={firstDueAt} onChange={(event) => setFirstDueAt(event.target.value)} required />
              </Field>
              <Field label="Liste de contrôle" hint="Un point par ligne.">
                <textarea value={checklistText} onChange={(event) => setChecklistText(event.target.value)} rows={3} />
              </Field>
            </div>
            <div className="ligne-boutons">
              <button type="submit">Créer le plan</button>
            </div>
          </form>
        </Card>
      ) : null}

      <Card title={null}>
        <div className="filtres">
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              className={r.key === range ? '' : 'secondaire'}
              onClick={() => setRange(r.key)}
            >
              {r.label}
            </button>
          ))}
        </div>

        {error ? <div className="message erreur">{error}</div> : null}
        {loading ? (
          <p>Chargement...</p>
        ) : (
          <DataTable
            columns={[
              { key: 'plan', label: 'Plan', numeric: false },
              { key: 'equipement', label: 'Équipement', numeric: false },
              { key: 'echeance', label: 'Échéance', numeric: false },
              { key: 'statut', label: 'Statut', numeric: false },
              { key: 'actions', label: '', numeric: false },
            ]}
            isEmpty={(data ?? []).length === 0}
            emptyText="Aucune tâche préventive."
          >
            {(data ?? []).map((row) => (
              <Fragment key={row.id}>
                <tr>
                  <td>{row.planName}</td>
                  <td>
                    {row.equipmentCode} — {row.equipmentName}
                  </td>
                  <td>
                    {formatDate(row.dueAt)}
                    {row.isOverdue ? <div className="badge alerte" style={{ marginTop: 4 }}>En retard</div> : null}
                  </td>
                  <td>
                    <Badge value={row.status} />
                  </td>
                  <td>
                    {row.status === 'PLANIFIEE' && can('preventive:complete') ? (
                      <button type="button" className="lien" onClick={() => void openCompletion(row.id)}>
                        Compléter
                      </button>
                    ) : null}
                  </td>
                </tr>
                {completingTaskId === row.id ? (
                  <tr>
                    <td colSpan={5}>
                      {checklistLoading ? (
                        <p>Chargement de la liste de contrôle...</p>
                      ) : (
                        <div style={{ padding: '8px 0' }}>
                          {checklist.map((item, index) => (
                            <label key={item.checklistItemId} style={{ display: 'block', marginBottom: 6 }}>
                              <input
                                type="checkbox"
                                checked={item.completed}
                                onChange={(event) =>
                                  setChecklist((current) =>
                                    current.map((entry, entryIndex) =>
                                      entryIndex === index ? { ...entry, completed: event.target.checked } : entry,
                                    ),
                                  )
                                }
                              />{' '}
                              {item.label}
                            </label>
                          ))}
                          <div className="ligne-boutons">
                            <button type="button" onClick={() => void submitCompletion(row.id)}>
                              Confirmer la réalisation
                            </button>
                            <button type="button" className="secondaire" onClick={() => setCompletingTaskId(null)}>
                              Annuler
                            </button>
                          </div>
                        </div>
                      )}
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
          </DataTable>
        )}
      </Card>
    </>
  );
}
