import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiPost } from '../api';
import { useAuth } from '../auth';
import { Badge, Card, DataTable, Field, Message, PageHeader } from '../components/ui';
import { formatDateTime } from '../format';
import { useResource } from '../hooks';
import { useSeamingParameters } from '../masterdata';

type SeamingControlDetail = Readonly<{
  control: Readonly<{
    id: string;
    seamingOperationId: string;
    productionRunId: string;
    runCode: string;
    machineCode: string | null;
    controlledAt: string;
    controllerName: string;
    measurementCount: number;
    nonConformeCount: number;
    result: string;
  }>;
  measurements: readonly Readonly<{
    id: string;
    parameterName: string;
    sampleNumber: number | null;
    measuredValue: string;
    unit: string;
    minValueSnapshot: string | null;
    maxValueSnapshot: string | null;
    status: string | null;
    recordStatus: string;
  }>[];
}>;

/** Saisie et détail d'un contrôle sertissage (section 22/23). */
export function ControleSertissageDetail() {
  const { id } = useParams();
  const resource = useResource<SeamingControlDetail>(`/api/seaming-controls/${id}`);
  const parameters = useSeamingParameters();
  const { can } = useAuth();

  const [parameterId, setParameterId] = useState('');
  const [measuredValue, setMeasuredValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  if (resource.loading && resource.data === null) {
    return <p>Chargement...</p>;
  }
  if (resource.data === null) {
    return <div className="message erreur">{resource.error ?? 'Contrôle sertissage introuvable.'}</div>;
  }

  const { control, measurements } = resource.data;
  const selectedParameter = (parameters.data ?? []).find((parameter) => parameter.id === parameterId);

  const submit = async () => {
    if (!selectedParameter) {
      return;
    }
    setError(null);
    setSuccess(null);
    try {
      const result = await apiPost<{ status: string | null }>(
        `/api/seaming-controls/${control.id}/mesures`,
        {
          seamingParameterId: selectedParameter.id,
          sampleNumber: null,
          measuredValue: measuredValue.trim(),
          unit: selectedParameter.defaultUnit,
          productId: null,
          format: null,
        },
      );
      setSuccess(
        `${selectedParameter.name} : ${measuredValue.trim()} ${selectedParameter.defaultUnit}` +
          (result.status ? ` — ${result.status === 'CONFORME' ? 'Conforme' : 'Non conforme'}` : ''),
      );
      setMeasuredValue('');
      resource.reload();
    } catch (failure) {
      setError((failure as Error).message);
    }
  };

  return (
    <>
      <PageHeader
        title="Contrôle sertissage"
        subtitle={<Link to={`/production/${control.productionRunId}`}>{control.runCode}</Link>}
        actions={<Badge value={control.result} />}
      />

      <Message kind="erreur" text={error} />
      <Message kind="succes" text={success} />

      {control.result === 'NON_CONFORME' ? (
        <div className="message erreur">
          Contrôle sertissage non conforme : {control.nonConformeCount} mesure(s) hors spécification.
        </div>
      ) : null}

      <Card title={null}>
        <p style={{ margin: 0 }}>
          Machine : {control.machineCode ?? '-'} — {formatDateTime(control.controlledAt)} —{' '}
          {control.controllerName}
        </p>
      </Card>

      {can('seaming:control') ? (
        <Card title="Nouvelle mesure">
          <div className="grille-champs">
            <Field label="Paramètre" hint={null}>
              <select value={parameterId} onChange={(event) => setParameterId(event.target.value)}>
                <option value="">Sélectionner...</option>
                {(parameters.data ?? []).map((parameter) => (
                  <option key={parameter.id} value={parameter.id}>
                    {parameter.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={`Valeur mesurée${selectedParameter ? ` (${selectedParameter.defaultUnit})` : ''}`} hint={null}>
              <input
                value={measuredValue}
                onChange={(event) => setMeasuredValue(event.target.value)}
                inputMode="decimal"
              />
            </Field>
          </div>
          <div className="ligne-boutons">
            <button
              type="button"
              disabled={!selectedParameter || measuredValue.trim() === ''}
              onClick={() => void submit()}
            >
              Enregistrer la mesure
            </button>
          </div>
        </Card>
      ) : null}

      <Card title="Mesures enregistrées">
        <DataTable
          columns={[
            { key: 'parametre', label: 'Paramètre', numeric: false },
            { key: 'valeur', label: 'Valeur', numeric: true },
            { key: 'limites', label: 'Limites', numeric: false },
            { key: 'statut', label: 'Statut', numeric: false },
          ]}
          isEmpty={measurements.length === 0}
          emptyText="Aucune mesure enregistrée."
        >
          {measurements
            .filter((measurement) => measurement.recordStatus === 'VALIDE')
            .map((measurement) => (
              <tr key={measurement.id}>
                <td>{measurement.parameterName}</td>
                <td className="nombre">
                  {measurement.measuredValue} {measurement.unit}
                </td>
                <td>
                  {measurement.minValueSnapshot === null && measurement.maxValueSnapshot === null
                    ? 'Non définies'
                    : `${measurement.minValueSnapshot ?? '-'} — ${measurement.maxValueSnapshot ?? '-'}`}
                </td>
                <td>{measurement.status ? <Badge value={measurement.status} /> : '-'}</td>
              </tr>
            ))}
        </DataTable>
      </Card>
    </>
  );
}
