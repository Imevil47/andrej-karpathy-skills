import { useMemo, useState } from 'react';
import { apiPost } from '../api';
import { Card, Field, Message, PageHeader } from '../components/ui';
import { formatQuantity, nowLocalInput } from '../format';
import { useResource } from '../hooks';
import { useLocations } from '../masterdata';

type StockRow = Readonly<{
  lotId: string;
  lotCode: string;
  speciesCode: string;
  locationCode: string;
  locationName: string;
  physicalQuantityKg: string;
  availableQuantityKg: string;
  isBlocked: boolean;
}>;

type StockLine = StockRow & { locationId: string };

/**
 * Transfer screen. The source list is the real stock situation, so the operator
 * always sees the quantity the backend will validate against.
 */
export function StockTransfert() {
  const locations = useLocations();
  const situation = useResource<readonly StockRow[]>('/api/stock/situation');
  const [selection, setSelection] = useState('');
  const [destinationLocationId, setDestinationLocationId] = useState('');
  const [quantityKg, setQuantityKg] = useState('');
  const [occurredAt, setOccurredAt] = useState(nowLocalInput());
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const lines = useMemo<readonly StockLine[]>(() => {
    const byCode = new Map((locations.data ?? []).map((location) => [location.code, location.id]));
    return (situation.data ?? []).map((row) => ({
      ...row,
      locationId: byCode.get(row.locationCode) ?? '',
    }));
  }, [situation.data, locations.data]);

  const selected = lines.find((line) => `${line.lotId}|${line.locationId}` === selection) ?? null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected) {
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const movement = await apiPost<{ movementCode: string }>('/api/stock/transfers', {
        lotId: selected.lotId,
        sourceLocationId: selected.locationId,
        destinationLocationId,
        quantityKg,
        occurredAt: new Date(occurredAt).toISOString(),
        notes: notes.trim() === '' ? null : notes.trim(),
      });
      setSuccess(`Transfert enregistré (mouvement ${movement.movementCode}).`);
      setQuantityKg('');
      situation.reload();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Transfert de stock"
        subtitle="Déplacement d'une quantité entre deux emplacements"
        actions={null}
      />

      <Message kind="erreur" text={error} />
      <Message kind="succes" text={success} />

      <form onSubmit={submit}>
        <Card title="Origine">
          <div className="grille-champs">
            <Field label="Lot et emplacement source" hint="La liste affiche le stock réel.">
              <select
                value={selection}
                onChange={(event) => setSelection(event.target.value)}
                required
              >
                <option value="">Sélectionner...</option>
                {lines.map((line) => (
                  <option
                    key={`${line.lotId}|${line.locationId}`}
                    value={`${line.lotId}|${line.locationId}`}
                  >
                    {line.lotCode} — {line.locationName} — {formatQuantity(line.physicalQuantityKg)} kg
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Stock physique de la ligne" hint={null}>
              <input
                readOnly
                value={selected ? `${formatQuantity(selected.physicalQuantityKg)} kg` : '-'}
              />
            </Field>
          </div>
          {selected?.isBlocked ? (
            <div className="message info" style={{ marginTop: 14 }}>
              Ce lot est bloqué par le service Qualité. Le transfert entre emplacements de stockage
              reste autorisé, mais la consommation et la sous-traitance sont interdites.
            </div>
          ) : null}
        </Card>

        <Card title="Destination">
          <div className="grille-champs">
            <Field label="Emplacement de destination" hint={null}>
              <select
                value={destinationLocationId}
                onChange={(event) => setDestinationLocationId(event.target.value)}
                required
              >
                <option value="">Sélectionner...</option>
                {(locations.data ?? [])
                  .filter((location) => location.canReceive && location.id !== selected?.locationId)
                  .map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name} ({location.stockType === 'INTERNE' ? 'Interne' : 'Externe'})
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Quantité (kg)" hint={null}>
              <input
                value={quantityKg}
                onChange={(event) => setQuantityKg(event.target.value)}
                inputMode="decimal"
                placeholder="2000.000"
                required
              />
            </Field>
            <Field label="Date et heure" hint={null}>
              <input
                type="datetime-local"
                value={occurredAt}
                onChange={(event) => setOccurredAt(event.target.value)}
                required
              />
            </Field>
            <Field label="Observations" hint={null}>
              <input value={notes} onChange={(event) => setNotes(event.target.value)} />
            </Field>
          </div>
        </Card>

        <div className="ligne-boutons">
          <button type="submit" disabled={busy || selected === null}>
            {busy ? 'Enregistrement...' : 'Valider le transfert'}
          </button>
        </div>
      </form>
    </>
  );
}
