import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiPost } from '../api';
import { Card, Field, Message, PageHeader } from '../components/ui';
import { useResource } from '../hooks';
import { useLocations } from '../masterdata';

type FinishedGoodLotOption = Readonly<{ id: string; lotCode: string; qualityStatus: string }>;

/** Creates a pallet with a single Lot PF content (section 11): the common
 * case. Composition is set once and never edited afterwards. */
export function PaletteNouvelle() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const lots = useResource<readonly FinishedGoodLotOption[]>('/api/finished-good-lots');
  const locations = useLocations();

  const [lotId, setLotId] = useState(searchParams.get('lot') ?? '');
  const [locationId, setLocationId] = useState('');
  const [quantityCartons, setQuantityCartons] = useState('');
  const [quantityUnits, setQuantityUnits] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pfLocations = (locations.data ?? []).filter(
    (location) => location.stockDomain === 'PF' || location.stockDomain === 'MIXTE',
  );

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const pallet = await apiPost<{ id: string }>('/api/pallets', {
        destinationLocationId: locationId,
        occurredAt: new Date().toISOString(),
        notes: null,
        contents: [
          {
            finishedGoodLotId: lotId,
            quantityCartons: Number(quantityCartons.trim()),
            quantityUnits: Number(quantityUnits.trim()),
          },
        ],
      });
      navigate(`/palettes/${pallet.id}`);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="Nouvelle palette" subtitle={null} actions={null} />
      <Message kind="erreur" text={error} />

      <Card title={null}>
        <form onSubmit={submit}>
          <div className="grille-champs">
            <Field label="Lot PF" hint={null}>
              <select value={lotId} onChange={(event) => setLotId(event.target.value)} required>
                <option value="">Sélectionner...</option>
                {(lots.data ?? []).map((lot) => (
                  <option key={lot.id} value={lot.id}>
                    {lot.lotCode}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Emplacement de destination" hint="Emplacements configurés pour le stock PF.">
              <select value={locationId} onChange={(event) => setLocationId(event.target.value)} required>
                <option value="">Sélectionner...</option>
                {pfLocations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Cartons" hint={null}>
              <input
                value={quantityCartons}
                onChange={(event) => setQuantityCartons(event.target.value)}
                inputMode="numeric"
                required
              />
            </Field>
            <Field label="Unités" hint={null}>
              <input
                value={quantityUnits}
                onChange={(event) => setQuantityUnits(event.target.value)}
                inputMode="numeric"
                required
              />
            </Field>
          </div>
          <div className="ligne-boutons">
            <button type="submit" disabled={busy || !lotId || !locationId}>
              Créer la palette
            </button>
          </div>
        </form>
      </Card>
    </>
  );
}
