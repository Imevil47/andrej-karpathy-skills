import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiPost } from '../api';
import { Card, Field, Message, PageHeader } from '../components/ui';
import { formatQuantity, nowLocalInput } from '../format';
import { useResource } from '../hooks';
import { useLocations, useSpecies, useSubcontractors, useSuppliers } from '../masterdata';

type StockRow = Readonly<{
  lotId: string;
  lotCode: string;
  locationCode: string;
  locationName: string;
  physicalQuantityKg: string;
  availableQuantityKg: string;
  isBlocked: boolean;
}>;

/**
 * Two clearly different modes:
 *  - stock existant : the material leaves a real OCEAMIC location;
 *  - fournisseur    : the material goes straight from the supplier to the
 *                     subcontractor, and no OCEAMIC location is reduced.
 */
export function SousTraitanceNouvelle() {
  const navigate = useNavigate();
  const subcontractors = useSubcontractors();
  const suppliers = useSuppliers();
  const species = useSpecies();
  const locations = useLocations();
  const situation = useResource<readonly StockRow[]>('/api/stock/situation');

  const [sourceType, setSourceType] = useState<'STOCK_EXISTANT' | 'FOURNISSEUR'>('STOCK_EXISTANT');
  const [subcontractorId, setSubcontractorId] = useState('');
  const [selection, setSelection] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [speciesId, setSpeciesId] = useState('');
  const [newLotCode, setNewLotCode] = useState('');
  const [quantitySentKg, setQuantitySentKg] = useState('');
  const [sentAt, setSentAt] = useState(nowLocalInput());
  const [incomingQuality, setIncomingQuality] = useState('');
  const [incomingSizeGrade, setIncomingSizeGrade] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const lines = useMemo(() => {
    const byCode = new Map((locations.data ?? []).map((location) => [location.code, location.id]));
    return (situation.data ?? [])
      .filter((row) => !row.isBlocked)
      .map((row) => ({ ...row, locationId: byCode.get(row.locationCode) ?? '' }));
  }, [situation.data, locations.data]);

  const selected = lines.find((line) => `${line.lotId}|${line.locationId}` === selection) ?? null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await apiPost<{ id: string }>('/api/subcontracting', {
        sentAt: new Date(sentAt).toISOString(),
        subcontractorId,
        sourceType,
        sourceLotId: sourceType === 'STOCK_EXISTANT' ? (selected?.lotId ?? null) : null,
        sourceLocationId: sourceType === 'STOCK_EXISTANT' ? (selected?.locationId ?? null) : null,
        supplierId: supplierId === '' ? null : supplierId,
        speciesId: sourceType === 'FOURNISSEUR' ? speciesId : null,
        newLotCode: newLotCode.trim() === '' ? null : newLotCode.trim(),
        quantitySentKg,
        incomingQuality: incomingQuality.trim() === '' ? null : incomingQuality.trim(),
        incomingSizeGrade: incomingSizeGrade.trim() === '' ? null : incomingSizeGrade.trim(),
        notes: notes.trim() === '' ? null : notes.trim(),
      });
      navigate(`/sous-traitance/${created.id}`);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="Nouvel envoi en sous-traitance" subtitle={null} actions={null} />
      <Message kind="erreur" text={error} />

      <form onSubmit={submit}>
        <Card title="Opération">
          <div className="grille-champs">
            <Field label="Sous-traitant" hint="La marchandise sera stockée à son emplacement.">
              <select
                value={subcontractorId}
                onChange={(event) => setSubcontractorId(event.target.value)}
                required
              >
                <option value="">Sélectionner...</option>
                {(subcontractors.data ?? []).map((subcontractor) => (
                  <option key={subcontractor.id} value={subcontractor.id}>
                    {subcontractor.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Origine de la marchandise" hint={null}>
              <select
                value={sourceType}
                onChange={(event) =>
                  setSourceType(event.target.value as 'STOCK_EXISTANT' | 'FOURNISSEUR')
                }
              >
                <option value="STOCK_EXISTANT">Stock existant OCEAMIC</option>
                <option value="FOURNISSEUR">Livraison directe fournisseur</option>
              </select>
            </Field>
            <Field label="Date et heure d'envoi" hint={null}>
              <input
                type="datetime-local"
                value={sentAt}
                onChange={(event) => setSentAt(event.target.value)}
                required
              />
            </Field>
          </div>
        </Card>

        {sourceType === 'STOCK_EXISTANT' ? (
          <Card title="Stock source">
            <div className="grille-champs">
              <Field label="Lot et emplacement source" hint="Les lots bloqués ne sont pas listés.">
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
                      {line.lotCode} — {line.locationName} —{' '}
                      {formatQuantity(line.availableQuantityKg)} kg
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Stock disponible" hint={null}>
                <input
                  readOnly
                  value={selected ? `${formatQuantity(selected.availableQuantityKg)} kg` : '-'}
                />
              </Field>
            </div>
          </Card>
        ) : (
          <Card title="Livraison directe fournisseur">
            <div className="message info">
              Aucun stock OCEAMIC n'est diminué. La marchandise entre en stock externe chez le
              sous-traitant.
            </div>
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
              <Field label="Code du lot créé" hint="Laisser vide pour une génération automatique.">
                <input
                  value={newLotCode}
                  onChange={(event) => setNewLotCode(event.target.value)}
                  placeholder="Généré automatiquement"
                />
              </Field>
            </div>
          </Card>
        )}

        <Card title="Quantité et qualité à l'entrée">
          <div className="grille-champs">
            <Field label="Quantité envoyée (kg)" hint={null}>
              <input
                value={quantitySentKg}
                onChange={(event) => setQuantitySentKg(event.target.value)}
                inputMode="decimal"
                placeholder="4000.000"
                required
              />
            </Field>
            <Field label="Qualité à l'entrée" hint={null}>
              <input
                value={incomingQuality}
                onChange={(event) => setIncomingQuality(event.target.value)}
              />
            </Field>
            <Field label="Calibre à l'entrée" hint={null}>
              <input
                value={incomingSizeGrade}
                onChange={(event) => setIncomingSizeGrade(event.target.value)}
              />
            </Field>
            <Field label="Observations" hint={null}>
              <input value={notes} onChange={(event) => setNotes(event.target.value)} />
            </Field>
          </div>
        </Card>

        <div className="ligne-boutons">
          <button type="submit" disabled={busy}>
            {busy ? 'Enregistrement...' : "Valider l'envoi"}
          </button>
          <button type="button" className="secondaire" onClick={() => navigate('/sous-traitance')}>
            Annuler
          </button>
        </div>
      </form>
    </>
  );
}
