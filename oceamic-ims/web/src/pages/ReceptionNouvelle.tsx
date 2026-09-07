import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiPost } from '../api';
import { Card, Field, Message, PageHeader } from '../components/ui';
import { nowLocalInput } from '../format';
import { useLocations, useLots, useSpecies, useSuppliers, useVessels } from '../masterdata';

type ReceptionCreated = Readonly<{
  receptionCode: string;
  lotId: string;
  lotCode: string;
  movementCode: string;
}>;

const RECEPTION_TYPES = [
  { value: 'FOURNISSEUR', label: 'Fournisseur' },
  { value: 'RETOUR_SOUS_TRAITANCE', label: 'Retour sous-traitance' },
  { value: 'TRANSFERT_ENTRANT', label: 'Transfert entrant' },
  { value: 'RETOUR_PRODUCTION', label: 'Retour production' },
  { value: 'AUTRE', label: 'Autre' },
] as const;

/**
 * One single screen creates the lot, the reception and the stock movement.
 * The operator never has to open the lots or movements screens beforehand.
 */
export function ReceptionNouvelle() {
  const navigate = useNavigate();
  const species = useSpecies();
  const suppliers = useSuppliers();
  const vessels = useVessels();
  const locations = useLocations();
  const lots = useLots('?limite=200');

  const [lotMode, setLotMode] = useState<'NOUVEAU' | 'EXISTANT'>('NOUVEAU');
  const [lotCode, setLotCode] = useState('');
  const [lotId, setLotId] = useState('');
  const [speciesId, setSpeciesId] = useState('');
  const [origin, setOrigin] = useState('');
  const [captureDate, setCaptureDate] = useState('');
  const [receivedAt, setReceivedAt] = useState(nowLocalInput());
  const [supplierId, setSupplierId] = useState('');
  const [vesselId, setVesselId] = useState('');
  const [tideNumber, setTideNumber] = useState('');
  const [truckRegistration, setTruckRegistration] = useState('');
  const [quantityKg, setQuantityKg] = useState('');
  const [destinationLocationId, setDestinationLocationId] = useState('');
  const [receptionType, setReceptionType] = useState<string>('FOURNISSEUR');
  const [documentReference, setDocumentReference] = useState('');
  const [notes, setNotes] = useState('');

  const [withInspection, setWithInspection] = useState(false);
  const [temperatureC, setTemperatureC] = useState('');
  const [qualityGrade, setQualityGrade] = useState('');
  const [sizeGrade, setSizeGrade] = useState('');
  const [inspectionResult, setInspectionResult] = useState('CONFORME');

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const receivingLocations = (locations.data ?? []).filter((location) => location.canReceive);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const created = await apiPost<ReceptionCreated>('/api/receptions', {
        receivedAt: new Date(receivedAt).toISOString(),
        lot:
          lotMode === 'NOUVEAU'
            ? {
                mode: 'NOUVEAU',
                lotCode: lotCode.trim() === '' ? null : lotCode.trim(),
                speciesId,
                origin: origin.trim() === '' ? null : origin.trim(),
                captureDate: captureDate === '' ? null : captureDate,
                notes: null,
              }
            : { mode: 'EXISTANT', lotId },
        supplierId: supplierId === '' ? null : supplierId,
        vesselId: vesselId === '' ? null : vesselId,
        tideNumber: tideNumber.trim() === '' ? null : tideNumber.trim(),
        truckRegistration: truckRegistration.trim() === '' ? null : truckRegistration.trim(),
        quantityKg,
        destinationLocationId,
        receptionType,
        externalSourceLocationId: null,
        documentReference: documentReference.trim() === '' ? null : documentReference.trim(),
        notes: notes.trim() === '' ? null : notes.trim(),
        quickInspection: withInspection
          ? {
              temperatureC: temperatureC.trim() === '' ? null : temperatureC.trim(),
              qualityGrade: qualityGrade.trim() === '' ? null : qualityGrade.trim(),
              sizeGrade: sizeGrade.trim() === '' ? null : sizeGrade.trim(),
              result: inspectionResult,
              notes: null,
            }
          : null,
      });

      setSuccess(
        `Réception ${created.receptionCode} enregistrée. Lot ${created.lotCode}, mouvement ${created.movementCode}.`,
      );
      navigate(`/lots/${created.lotId}`);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Nouvelle réception"
        subtitle="Le lot, la réception et le mouvement de stock sont créés ensemble."
        actions={null}
      />

      <Message kind="erreur" text={error} />
      <Message kind="succes" text={success} />

      <form onSubmit={submit}>
        <Card title="Informations réception">
          <div className="grille-champs">
            <Field label="Date et heure de réception" hint={null}>
              <input
                type="datetime-local"
                value={receivedAt}
                onChange={(event) => setReceivedAt(event.target.value)}
                required
              />
            </Field>
            <Field label="Type de réception" hint={null}>
              <select
                value={receptionType}
                onChange={(event) => setReceptionType(event.target.value)}
              >
                {RECEPTION_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Référence document" hint="Bon de livraison, bon de pesée...">
              <input
                value={documentReference}
                onChange={(event) => setDocumentReference(event.target.value)}
              />
            </Field>
          </div>
        </Card>

        <Card title="Matière première">
          <div className="grille-champs">
            <Field label="Lot" hint="Un camion tracé séparément justifie un nouveau lot.">
              <select
                value={lotMode}
                onChange={(event) => setLotMode(event.target.value as 'NOUVEAU' | 'EXISTANT')}
              >
                <option value="NOUVEAU">Créer un nouveau lot</option>
                <option value="EXISTANT">Rattacher à un lot existant</option>
              </select>
            </Field>

            {lotMode === 'NOUVEAU' ? (
              <>
                <Field label="Code lot" hint="Laisser vide pour une génération automatique.">
                  <input
                    value={lotCode}
                    onChange={(event) => setLotCode(event.target.value)}
                    placeholder="Généré automatiquement"
                  />
                </Field>
                <Field label="Espèce" hint={null}>
                  <select
                    value={speciesId}
                    onChange={(event) => setSpeciesId(event.target.value)}
                    required
                  >
                    <option value="">Sélectionner...</option>
                    {(species.data ?? []).map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Origine" hint={null}>
                  <input value={origin} onChange={(event) => setOrigin(event.target.value)} />
                </Field>
                <Field label="Date de capture" hint={null}>
                  <input
                    type="date"
                    value={captureDate}
                    onChange={(event) => setCaptureDate(event.target.value)}
                  />
                </Field>
              </>
            ) : (
              <Field label="Lot existant" hint={null}>
                <select value={lotId} onChange={(event) => setLotId(event.target.value)} required>
                  <option value="">Sélectionner...</option>
                  {(lots.data ?? []).map((lot) => (
                    <option key={lot.id} value={lot.id}>
                      {lot.lotCode} — {lot.speciesCode}
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </div>
        </Card>

        <Card title="Traçabilité">
          <div className="grille-champs">
            <Field label="Fournisseur" hint={null}>
              <select value={supplierId} onChange={(event) => setSupplierId(event.target.value)}>
                <option value="">Non renseigné</option>
                {(suppliers.data ?? []).map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Bateau" hint={null}>
              <select value={vesselId} onChange={(event) => setVesselId(event.target.value)}>
                <option value="">Non renseigné</option>
                {(vessels.data ?? []).map((vessel) => (
                  <option key={vessel.id} value={vessel.id}>
                    {vessel.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Numéro de marée" hint={null}>
              <input value={tideNumber} onChange={(event) => setTideNumber(event.target.value)} />
            </Field>
            <Field label="Immatriculation camion" hint={null}>
              <input
                value={truckRegistration}
                onChange={(event) => setTruckRegistration(event.target.value)}
              />
            </Field>
          </div>
        </Card>

        <Card title="Quantité et destination">
          <div className="grille-champs">
            <Field label="Quantité (kg)" hint="Trois décimales maximum.">
              <input
                value={quantityKg}
                onChange={(event) => setQuantityKg(event.target.value)}
                inputMode="decimal"
                placeholder="5000.000"
                required
              />
            </Field>
            <Field
              label="Emplacement de destination"
              hint="Le type de stock (interne / externe) est déduit de l'emplacement."
            >
              <select
                value={destinationLocationId}
                onChange={(event) => setDestinationLocationId(event.target.value)}
                required
              >
                <option value="">Sélectionner...</option>
                {receivingLocations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name} ({location.stockType === 'INTERNE' ? 'Interne' : 'Externe'})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Observations" hint={null}>
              <input value={notes} onChange={(event) => setNotes(event.target.value)} />
            </Field>
          </div>
        </Card>

        <Card title="Contrôle qualité rapide">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
            <input
              type="checkbox"
              checked={withInspection}
              onChange={(event) => setWithInspection(event.target.checked)}
            />
            Enregistrer un contrôle à la réception
          </label>
          {withInspection ? (
            <div className="grille-champs" style={{ marginTop: 14 }}>
              <Field label="Température (°C)" hint={null}>
                <input
                  value={temperatureC}
                  onChange={(event) => setTemperatureC(event.target.value)}
                  inputMode="decimal"
                />
              </Field>
              <Field label="Qualité observée" hint={null}>
                <input
                  value={qualityGrade}
                  onChange={(event) => setQualityGrade(event.target.value)}
                />
              </Field>
              <Field label="Calibre" hint={null}>
                <input value={sizeGrade} onChange={(event) => setSizeGrade(event.target.value)} />
              </Field>
              <Field label="Résultat" hint={null}>
                <select
                  value={inspectionResult}
                  onChange={(event) => setInspectionResult(event.target.value)}
                >
                  <option value="CONFORME">Conforme</option>
                  <option value="A_SURVEILLER">À surveiller</option>
                  <option value="NON_CONFORME">Non conforme</option>
                </select>
              </Field>
            </div>
          ) : null}
        </Card>

        <div className="ligne-boutons">
          <button type="submit" disabled={busy}>
            {busy ? 'Enregistrement...' : 'Enregistrer la réception'}
          </button>
          <button type="button" className="secondaire" onClick={() => navigate('/receptions')}>
            Annuler
          </button>
        </div>
      </form>
    </>
  );
}
