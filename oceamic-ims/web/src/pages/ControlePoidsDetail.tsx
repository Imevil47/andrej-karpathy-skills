import { useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiPost } from '../api';
import { useAuth } from '../auth';
import { Badge, Card, KeyValue, Message, PageHeader } from '../components/ui';
import { formatDateTime } from '../format';
import { useResource } from '../hooks';

type WeightControlDetail = Readonly<{
  control: Readonly<{
    id: string;
    controlCode: string;
    fillingOperationId: string;
    productionRunId: string;
    runCode: string;
    productCode: string;
    format: string | null;
    controlledAt: string;
    controllerName: string;
    sampleSize: number;
    sampleCount: number;
    minWeightGSnapshot: string | null;
    maxWeightGSnapshot: string | null;
    averageWeightG: string | null;
    underweightCount: number;
    conformeCount: number;
    overweightCount: number;
    controlStatus: string;
  }>;
  samples: readonly Readonly<{
    id: string;
    sampleNumber: number;
    measuredWeightG: string;
    status: string;
    deviationG: string;
    recordStatus: string;
    cancellationReason: string | null;
  }>[];
}>;

/**
 * Rapid weight-entry screen (section 17/61): one field per can. After a
 * valid entry, focus moves to the next empty box automatically. The page
 * only shows its full-page loading state before the FIRST successful load -
 * a later reload (after each save) must never unmount the boxes themselves,
 * or the auto-focus target disappears mid-flight (the exact bug fixed in the
 * Phase 3 terrain screen).
 */
export function ControlePoidsDetail() {
  const { id } = useParams();
  const resource = useResource<WeightControlDetail>(`/api/filling-weight-controls/${id}`);
  const { can } = useAuth();

  const [values, setValues] = useState<Record<number, string>>({});
  const [busyNumber, setBusyNumber] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const inputRefs = useRef<Record<number, HTMLInputElement | null>>({});

  const validSamples = useMemo(
    () => (resource.data?.samples ?? []).filter((sample) => sample.recordStatus === 'VALIDE'),
    [resource.data],
  );
  const byNumber = useMemo(() => {
    const map = new Map<number, WeightControlDetail['samples'][number]>();
    for (const sample of validSamples) {
      map.set(sample.sampleNumber, sample);
    }
    return map;
  }, [validSamples]);

  const focusNext = (afterNumber: number, sampleSize: number) => {
    for (let candidate = afterNumber + 1; candidate <= sampleSize; candidate += 1) {
      if (!byNumber.has(candidate)) {
        inputRefs.current[candidate]?.focus();
        return;
      }
    }
    for (let candidate = 1; candidate < afterNumber; candidate += 1) {
      if (!byNumber.has(candidate)) {
        inputRefs.current[candidate]?.focus();
        return;
      }
    }
  };

  const saveSample = async (sampleNumber: number, sampleSize: number) => {
    const value = values[sampleNumber];
    if (!value || value.trim() === '') {
      return;
    }
    setBusyNumber(sampleNumber);
    setError(null);
    setSuccess(null);
    try {
      const result = await apiPost<{ status: string; deviationG: string }>(
        `/api/filling-weight-controls/${id}/echantillons`,
        { sampleNumber, measuredWeightG: value.trim() },
      );
      setSuccess(`Boîte ${sampleNumber.toString().padStart(2, '0')} : ${value.trim()} g`);
      setValues((current) => {
        const next = { ...current };
        delete next[sampleNumber];
        return next;
      });
      resource.reload();
      focusNext(sampleNumber, sampleSize);
      void result;
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusyNumber(null);
    }
  };

  if (resource.loading && resource.data === null) {
    return <p>Chargement...</p>;
  }
  if (resource.data === null) {
    return <div className="message erreur">{resource.error ?? 'Contrôle poids introuvable.'}</div>;
  }

  const { control } = resource.data;
  const boxes = Array.from({ length: control.sampleSize }, (_, index) => index + 1);
  const isOpen = control.sampleCount < control.sampleSize;

  return (
    <>
      <PageHeader
        title={`Contrôle poids ${control.controlCode}`}
        subtitle={
          <>
            <Link to={`/production/${control.productionRunId}`}>{control.runCode}</Link>
            {` — ${control.productCode}${control.format ? ` — Format ${control.format}` : ''}`}
          </>
        }
        actions={<Badge value={control.controlStatus} />}
      />

      <Message kind="erreur" text={error} />
      <Message kind="succes" text={success} />

      {control.controlStatus === 'NON_CONFORME' ? (
        <div className="message erreur">
          Sous-poids détecté : {control.underweightCount} boîte(s) sous le poids minimum de{' '}
          {control.minWeightGSnapshot} g.
        </div>
      ) : null}

      <Card title={null}>
        <KeyValue
          items={[
            { key: 'Contrôleur', value: control.controllerName },
            { key: 'Date', value: formatDateTime(control.controlledAt) },
            {
              key: 'Poids min / max',
              value:
                control.minWeightGSnapshot === null
                  ? '-'
                  : `${control.minWeightGSnapshot} g / ${control.maxWeightGSnapshot} g`,
            },
            { key: 'Poids moyen', value: control.averageWeightG ? `${control.averageWeightG} g` : '-' },
            { key: 'Échantillons', value: `${control.sampleCount} / ${control.sampleSize}` },
            { key: 'Sous-poids', value: control.underweightCount },
            { key: 'Conformes', value: control.conformeCount },
            { key: 'Surpoids', value: control.overweightCount },
          ]}
        />
      </Card>

      <Card title="Pesées">
        <div className="grille-poids">
          {boxes.map((number) => {
            const sample = byNumber.get(number);
            const anomaly = sample && sample.status !== 'CONFORME';
            return (
              <div key={number} className={`boite-poids${anomaly ? ' anomalie' : ''}`}>
                <div className="numero">Boîte {number.toString().padStart(2, '0')}</div>
                {sample ? (
                  <div className="valeur">
                    {sample.measuredWeightG} g
                    <Badge value={sample.status} />
                  </div>
                ) : can('weight:control') && isOpen ? (
                  <input
                    ref={(element) => {
                      inputRefs.current[number] = element;
                    }}
                    value={values[number] ?? ''}
                    onChange={(event) =>
                      setValues((current) => ({ ...current, [number]: event.target.value }))
                    }
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        void saveSample(number, control.sampleSize);
                      }
                    }}
                    inputMode="decimal"
                    disabled={busyNumber === number}
                    placeholder="g"
                  />
                ) : (
                  <div className="valeur vide">-</div>
                )}
              </div>
            );
          })}
        </div>
      </Card>
    </>
  );
}
