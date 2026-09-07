import { useState } from 'react';
import { Link } from 'react-router-dom';
import { apiPost } from '../api';
import { useAuth } from '../auth';
import { Badge, Card, DataTable, Field, Message, PageHeader } from '../components/ui';
import { formatDateTime, label, nowLocalInput } from '../format';
import { useResource } from '../hooks';
import { useLocations, useLots } from '../masterdata';

type InspectionRow = Readonly<{
  id: string;
  inspectionCode: string;
  inspectedAt: string;
  inspectionType: string;
  processStage: string;
  temperatureC: string | null;
  histaminePpm: string | null;
  abvt: string | null;
  qualityGrade: string | null;
  sizeGrade: string | null;
  result: string;
  lotId: string;
  lotCode: string;
  locationCode: string | null;
  inspectorName: string;
}>;

export function QualiteControles() {
  const { can } = useAuth();
  const lots = useLots('?limite=200');
  const locations = useLocations();
  const { data, error, loading, reload } = useResource<readonly InspectionRow[]>(
    '/api/quality/inspections',
  );

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    rawMaterialLotId: '',
    inspectedAt: nowLocalInput(),
    inspectionType: 'STOCKAGE',
    processStage: 'STOCKAGE',
    locationId: '',
    temperatureC: '',
    histaminePpm: '',
    abvt: '',
    qualityGrade: '',
    sizeGrade: '',
    result: 'CONFORME',
    notes: '',
  });
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const update = (key: keyof typeof form, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setActionError(null);
    try {
      await apiPost('/api/quality/inspections', {
        rawMaterialLotId: form.rawMaterialLotId,
        inspectedAt: new Date(form.inspectedAt).toISOString(),
        inspectionType: form.inspectionType,
        processStage: form.processStage,
        locationId: form.locationId === '' ? null : form.locationId,
        temperatureC: form.temperatureC.trim() === '' ? null : form.temperatureC.trim(),
        histaminePpm: form.histaminePpm.trim() === '' ? null : form.histaminePpm.trim(),
        abvt: form.abvt.trim() === '' ? null : form.abvt.trim(),
        qualityGrade: form.qualityGrade.trim() === '' ? null : form.qualityGrade.trim(),
        sizeGrade: form.sizeGrade.trim() === '' ? null : form.sizeGrade.trim(),
        result: form.result,
        notes: form.notes.trim() === '' ? null : form.notes.trim(),
      });
      setShowForm(false);
      reload();
    } catch (failure) {
      setActionError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Contrôles qualité"
        subtitle="Mesures et observations sur les lots matière première"
        actions={
          can('quality:inspect') ? (
            <button type="button" onClick={() => setShowForm((value) => !value)}>
              {showForm ? 'Fermer' : 'Nouveau contrôle'}
            </button>
          ) : null
        }
      />

      <Message kind="erreur" text={actionError ?? error} />

      {showForm ? (
        <Card title="Nouveau contrôle">
          <form onSubmit={submit}>
            <div className="grille-champs">
              <Field label="Lot" hint={null}>
                <select
                  value={form.rawMaterialLotId}
                  onChange={(event) => update('rawMaterialLotId', event.target.value)}
                  required
                >
                  <option value="">Sélectionner...</option>
                  {(lots.data ?? []).map((lot) => (
                    <option key={lot.id} value={lot.id}>
                      {lot.lotCode} — {lot.speciesCode}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Date et heure" hint={null}>
                <input
                  type="datetime-local"
                  value={form.inspectedAt}
                  onChange={(event) => update('inspectedAt', event.target.value)}
                  required
                />
              </Field>
              <Field label="Type de contrôle" hint={null}>
                <select
                  value={form.inspectionType}
                  onChange={(event) => update('inspectionType', event.target.value)}
                >
                  <option value="RECEPTION">Réception</option>
                  <option value="STOCKAGE">Stockage</option>
                  <option value="SOUS_TRAITANCE">Sous-traitance</option>
                  <option value="RECONTROLE">Recontrôle</option>
                  <option value="AUTRE">Autre</option>
                </select>
              </Field>
              <Field label="Étape" hint={null}>
                <select
                  value={form.processStage}
                  onChange={(event) => update('processStage', event.target.value)}
                >
                  <option value="RECEPTION">Réception</option>
                  <option value="STOCKAGE">Stockage</option>
                  <option value="SOUS_TRAITANCE">Sous-traitance</option>
                  <option value="AUTRE">Autre</option>
                </select>
              </Field>
              <Field label="Emplacement" hint={null}>
                <select
                  value={form.locationId}
                  onChange={(event) => update('locationId', event.target.value)}
                >
                  <option value="">Non renseigné</option>
                  {(locations.data ?? []).map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Température (°C)" hint={null}>
                <input
                  value={form.temperatureC}
                  onChange={(event) => update('temperatureC', event.target.value)}
                  inputMode="decimal"
                />
              </Field>
              <Field label="Histamine (ppm)" hint={null}>
                <input
                  value={form.histaminePpm}
                  onChange={(event) => update('histaminePpm', event.target.value)}
                  inputMode="decimal"
                />
              </Field>
              <Field label="ABVT" hint={null}>
                <input
                  value={form.abvt}
                  onChange={(event) => update('abvt', event.target.value)}
                  inputMode="decimal"
                />
              </Field>
              <Field label="Qualité observée" hint={null}>
                <input
                  value={form.qualityGrade}
                  onChange={(event) => update('qualityGrade', event.target.value)}
                />
              </Field>
              <Field label="Calibre" hint={null}>
                <input
                  value={form.sizeGrade}
                  onChange={(event) => update('sizeGrade', event.target.value)}
                />
              </Field>
              <Field label="Résultat" hint="Une mesure est une observation, pas une décision.">
                <select value={form.result} onChange={(event) => update('result', event.target.value)}>
                  <option value="CONFORME">Conforme</option>
                  <option value="A_SURVEILLER">À surveiller</option>
                  <option value="NON_CONFORME">Non conforme</option>
                </select>
              </Field>
              <Field label="Observations" hint={null}>
                <input value={form.notes} onChange={(event) => update('notes', event.target.value)} />
              </Field>
            </div>
            <div className="ligne-boutons">
              <button type="submit" disabled={busy}>
                {busy ? 'Enregistrement...' : 'Enregistrer le contrôle'}
              </button>
            </div>
          </form>
        </Card>
      ) : null}

      <Card title={null}>
        {loading ? (
          <p>Chargement...</p>
        ) : (
          <DataTable
            columns={[
              { key: 'code', label: 'Contrôle', numeric: false },
              { key: 'date', label: 'Date', numeric: false },
              { key: 'lot', label: 'Lot', numeric: false },
              { key: 'type', label: 'Type', numeric: false },
              { key: 'emplacement', label: 'Emplacement', numeric: false },
              { key: 'temperature', label: 'T (°C)', numeric: true },
              { key: 'histamine', label: 'Histamine', numeric: true },
              { key: 'abvt', label: 'ABVT', numeric: true },
              { key: 'qualite', label: 'Qualité', numeric: false },
              { key: 'resultat', label: 'Résultat', numeric: false },
              { key: 'controleur', label: 'Contrôleur', numeric: false },
            ]}
            isEmpty={(data ?? []).length === 0}
            emptyText="Aucun contrôle enregistré."
          >
            {(data ?? []).map((row) => (
              <tr key={row.id}>
                <td>{row.inspectionCode}</td>
                <td>{formatDateTime(row.inspectedAt)}</td>
                <td>
                  <Link to={`/lots/${row.lotId}`}>{row.lotCode}</Link>
                </td>
                <td>{label(row.inspectionType)}</td>
                <td>{row.locationCode ?? '-'}</td>
                <td className="nombre">{row.temperatureC ?? '-'}</td>
                <td className="nombre">{row.histaminePpm ?? '-'}</td>
                <td className="nombre">{row.abvt ?? '-'}</td>
                <td>{row.qualityGrade ?? '-'}</td>
                <td>
                  <Badge value={row.result} />
                </td>
                <td>{row.inspectorName}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Card>
    </>
  );
}
