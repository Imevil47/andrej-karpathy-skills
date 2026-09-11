import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiPost } from '../api';
import { useAuth } from '../auth';
import { Badge, Card, DataTable, Field, KeyValue, Message, PageHeader } from '../components/ui';
import { formatDateTime, formatQuantity, label } from '../format';
import { useResource } from '../hooks';
import { useLocations } from '../masterdata';

type OperationDetail = Readonly<{
  operation: Readonly<{
    id: string;
    operationCode: string;
    sentAt: string;
    sourceType: string;
    quantitySentKg: string;
    incomingQuality: string | null;
    incomingSizeGrade: string | null;
    status: string;
    notes: string | null;
    subcontractorName: string;
    lotId: string | null;
    lotCode: string | null;
    sourceLocationCode: string | null;
    resultsKg: string;
    differenceKg: string;
  }>;
  results: readonly Readonly<{
    id: string;
    resultType: string;
    quantityKg: string;
    outgoingQuality: string | null;
    outgoingSizeGrade: string | null;
    qualityStatus: string | null;
    resultLotCode: string | null;
    destinationLocationCode: string | null;
    createdAt: string;
  }>[];
}>;

export function SousTraitanceDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const locations = useLocations();
  const { data, error, loading, reload } = useResource<OperationDetail>(`/api/subcontracting/${id}`);

  const [resultType, setResultType] = useState<'PRODUIT' | 'PERTE'>('PRODUIT');
  const [resultLotMode, setResultLotMode] = useState<'MEME_LOT' | 'NOUVEAU_LOT'>('NOUVEAU_LOT');
  const [newLotCode, setNewLotCode] = useState('');
  const [quantityKg, setQuantityKg] = useState('');
  const [outgoingQuality, setOutgoingQuality] = useState('');
  const [outgoingSizeGrade, setOutgoingSizeGrade] = useState('');
  const [destinationLocationId, setDestinationLocationId] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const addResult = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setActionError(null);
    try {
      await apiPost(`/api/subcontracting/${id}/results`, {
        resultType,
        resultLotMode: resultType === 'PERTE' ? 'MEME_LOT' : resultLotMode,
        newLotCode: newLotCode.trim() === '' ? null : newLotCode.trim(),
        quantityKg,
        outgoingQuality: outgoingQuality.trim() === '' ? null : outgoingQuality.trim(),
        outgoingSizeGrade: outgoingSizeGrade.trim() === '' ? null : outgoingSizeGrade.trim(),
        destinationLocationId: resultType === 'PERTE' ? null : destinationLocationId,
        qualityStatus: null,
      });
      setQuantityKg('');
      setNewLotCode('');
      reload();
    } catch (failure) {
      setActionError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const close = async () => {
    setActionError(null);
    try {
      await apiPost(`/api/subcontracting/${id}/cloture`, {});
      reload();
    } catch (failure) {
      setActionError((failure as Error).message);
    }
  };

  if (loading) {
    return <p>Chargement...</p>;
  }
  if (error || data === null) {
    return <div className="message erreur">{error ?? 'Opération introuvable.'}</div>;
  }

  const { operation } = data;
  const hasDifference = operation.differenceKg !== '0.000';

  return (
    <>
      <PageHeader
        title={`Sous-traitance ${operation.operationCode}`}
        subtitle={`${operation.subcontractorName} — ${label(operation.sourceType)}`}
        actions={<Badge value={operation.status} />}
      />

      <Message kind="erreur" text={actionError} />

      <Card title="Bilan matière">
        <KeyValue
          items={[
            { key: 'Envoyé', value: `${formatQuantity(operation.quantitySentKg)} kg` },
            { key: 'Résultats', value: `${formatQuantity(operation.resultsKg)} kg` },
            { key: 'Écart', value: `${formatQuantity(operation.differenceKg)} kg` },
            { key: 'Envoi', value: formatDateTime(operation.sentAt) },
            {
              key: 'Lot',
              value: operation.lotId ? (
                <Link to={`/lots/${operation.lotId}`}>{operation.lotCode}</Link>
              ) : (
                '-'
              ),
            },
            { key: 'Emplacement source', value: operation.sourceLocationCode ?? '-' },
            { key: "Qualité à l'entrée", value: operation.incomingQuality ?? '-' },
            { key: "Calibre à l'entrée", value: operation.incomingSizeGrade ?? '-' },
          ]}
        />
        {hasDifference && operation.status === 'EN_COURS' ? (
          <div className="message info" style={{ marginTop: 14 }}>
            Écart matière à justifier : {formatQuantity(operation.differenceKg)} kg restants à
            déclarer en résultats ou en perte.
          </div>
        ) : null}
      </Card>

      <Card title="Résultats">
        <DataTable
          columns={[
            { key: 'type', label: 'Type', numeric: false },
            { key: 'lot', label: 'Lot résultat', numeric: false },
            { key: 'qualite', label: 'Qualité', numeric: false },
            { key: 'calibre', label: 'Calibre', numeric: false },
            { key: 'destination', label: 'Destination', numeric: false },
            { key: 'date', label: 'Enregistré le', numeric: false },
            { key: 'quantite', label: 'Quantité (kg)', numeric: true },
          ]}
          isEmpty={data.results.length === 0}
          emptyText="Aucun résultat enregistré."
        >
          {data.results.map((row) => (
            <tr key={row.id}>
              <td>
                <Badge value={row.resultType} />
              </td>
              <td>{row.resultLotCode ?? '-'}</td>
              <td>{row.outgoingQuality ?? '-'}</td>
              <td>{row.outgoingSizeGrade ?? '-'}</td>
              <td>{row.destinationLocationCode ?? '-'}</td>
              <td>{formatDateTime(row.createdAt)}</td>
              <td className="nombre">{formatQuantity(row.quantityKg)}</td>
            </tr>
          ))}
        </DataTable>
      </Card>

      {can('subcontracting:result') && operation.status === 'EN_COURS' ? (
        <Card title="Ajouter un résultat">
          <form onSubmit={addResult}>
            <div className="grille-champs">
              <Field label="Type de résultat" hint={null}>
                <select
                  value={resultType}
                  onChange={(event) => setResultType(event.target.value as 'PRODUIT' | 'PERTE')}
                >
                  <option value="PRODUIT">Produit</option>
                  <option value="PERTE">Perte</option>
                </select>
              </Field>

              {resultType === 'PRODUIT' ? (
                <>
                  <Field label="Lot du résultat" hint={null}>
                    <select
                      value={resultLotMode}
                      onChange={(event) =>
                        setResultLotMode(event.target.value as 'MEME_LOT' | 'NOUVEAU_LOT')
                      }
                    >
                      <option value="NOUVEAU_LOT">Créer un lot enfant</option>
                      <option value="MEME_LOT">Conserver le lot source</option>
                    </select>
                  </Field>
                  {resultLotMode === 'NOUVEAU_LOT' ? (
                    <Field label="Code du lot enfant" hint="Vide = génération automatique.">
                      <input
                        value={newLotCode}
                        onChange={(event) => setNewLotCode(event.target.value)}
                        placeholder="Généré automatiquement"
                      />
                    </Field>
                  ) : null}
                  <Field label="Emplacement de destination" hint={null}>
                    <select
                      value={destinationLocationId}
                      onChange={(event) => setDestinationLocationId(event.target.value)}
                      required
                    >
                      <option value="">Sélectionner...</option>
                      {(locations.data ?? [])
                        .filter((location) => location.canReceive)
                        .map((location) => (
                          <option key={location.id} value={location.id}>
                            {location.name}
                          </option>
                        ))}
                    </select>
                  </Field>
                  <Field label="Qualité de sortie" hint={null}>
                    <input
                      value={outgoingQuality}
                      onChange={(event) => setOutgoingQuality(event.target.value)}
                    />
                  </Field>
                  <Field label="Calibre de sortie" hint={null}>
                    <input
                      value={outgoingSizeGrade}
                      onChange={(event) => setOutgoingSizeGrade(event.target.value)}
                    />
                  </Field>
                </>
              ) : null}

              <Field label="Quantité (kg)" hint={null}>
                <input
                  value={quantityKg}
                  onChange={(event) => setQuantityKg(event.target.value)}
                  inputMode="decimal"
                  required
                />
              </Field>
            </div>

            <div className="ligne-boutons">
              <button type="submit" disabled={busy}>
                {busy ? 'Enregistrement...' : 'Ajouter le résultat'}
              </button>
              <button type="button" className="secondaire" onClick={close}>
                Clôturer l'opération
              </button>
            </div>
          </form>
        </Card>
      ) : null}
    </>
  );
}
