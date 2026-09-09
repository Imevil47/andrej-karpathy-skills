import { useState } from 'react';
import { apiPost } from '../api';
import { useAuth } from '../auth';
import { Card, DataTable, Field, Message, PageHeader } from '../components/ui';
import { useSpareParts } from '../masterdata';

/** Pièces de rechange (section 38) : inventaire de maintenance, séparé du
 * moteur de calcul de stock matière première. Pas de commande automatique -
 * seulement une alerte "Stock de sécurité atteint". */
export function PiecesDeRechange() {
  const { can } = useAuth();
  const spareParts = useSpareParts();

  const [partCode, setPartCode] = useState('');
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('PIECE');
  const [minimumStock, setMinimumStock] = useState('0');
  const [createError, setCreateError] = useState<string | null>(null);

  const [movementPartId, setMovementPartId] = useState('');
  const [movementQuantity, setMovementQuantity] = useState('');
  const [movementError, setMovementError] = useState<string | null>(null);

  const createPart = async (event: React.FormEvent) => {
    event.preventDefault();
    setCreateError(null);
    try {
      await apiPost('/api/spare-parts', {
        partCode: partCode.trim(),
        name: name.trim(),
        description: null,
        unit,
        minimumStock,
        locationId: null,
      });
      setPartCode('');
      setName('');
      setMinimumStock('0');
      spareParts.reload();
    } catch (failure) {
      setCreateError((failure as Error).message);
    }
  };

  const receive = async () => {
    setMovementError(null);
    try {
      await apiPost(`/api/spare-parts/${movementPartId}/reception`, {
        movementType: 'RECEPTION',
        quantity: movementQuantity,
        reason: 'Réception de stock',
      });
      setMovementQuantity('');
      spareParts.reload();
    } catch (failure) {
      setMovementError((failure as Error).message);
    }
  };

  const adjust = async () => {
    setMovementError(null);
    try {
      await apiPost(`/api/spare-parts/${movementPartId}/ajustement`, {
        quantityDelta: movementQuantity,
        reason: 'Ajustement manuel',
      });
      setMovementQuantity('');
      spareParts.reload();
    } catch (failure) {
      setMovementError((failure as Error).message);
    }
  };

  return (
    <>
      <PageHeader title="Pièces de rechange" subtitle="Inventaire de maintenance" actions={null} />
      <Message kind="erreur" text={createError} />

      {can('equipment:manage') ? (
        <Card title="Nouvelle pièce">
          <form id="creation" onSubmit={createPart}>
            <div className="grille-champs">
              <Field label="Code" hint={null}>
                <input value={partCode} onChange={(event) => setPartCode(event.target.value)} required />
              </Field>
              <Field label="Nom" hint={null}>
                <input value={name} onChange={(event) => setName(event.target.value)} required />
              </Field>
              <Field label="Unité" hint={null}>
                <input value={unit} onChange={(event) => setUnit(event.target.value)} required />
              </Field>
              <Field label="Stock minimum" hint="Seuil déclenchant l'alerte « Stock de sécurité atteint ».">
                <input value={minimumStock} onChange={(event) => setMinimumStock(event.target.value)} required />
              </Field>
            </div>
            <div className="ligne-boutons">
              <button type="submit">Créer</button>
            </div>
          </form>
        </Card>
      ) : null}

      {can('sparepart:consume') ? (
        <Card title="Mouvement de stock">
          <Message kind="erreur" text={movementError} />
          <div className="grille-champs">
            <Field label="Pièce" hint={null}>
              <select value={movementPartId} onChange={(event) => setMovementPartId(event.target.value)}>
                <option value="">Sélectionner...</option>
                {(spareParts.data ?? []).map((part) => (
                  <option key={part.id} value={part.id}>
                    {part.partCode} — {part.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Quantité" hint="Positive pour une réception, signée pour un ajustement.">
              <input value={movementQuantity} onChange={(event) => setMovementQuantity(event.target.value)} />
            </Field>
          </div>
          <div className="ligne-boutons">
            <button type="button" onClick={() => void receive()} disabled={movementPartId === '' || movementQuantity === ''}>
              Réceptionner
            </button>
            {can('sparepart:adjust') ? (
              <button
                type="button"
                className="secondaire"
                onClick={() => void adjust()}
                disabled={movementPartId === '' || movementQuantity === ''}
              >
                Ajuster (RESPONSABLE_MAINTENANCE)
              </button>
            ) : null}
          </div>
        </Card>
      ) : null}

      <Card title={null}>
        {spareParts.error ? <div className="message erreur">{spareParts.error}</div> : null}
        {spareParts.loading ? (
          <p>Chargement...</p>
        ) : (
          <DataTable
            columns={[
              { key: 'code', label: 'Code', numeric: false },
              { key: 'nom', label: 'Nom', numeric: false },
              { key: 'stock', label: 'Stock', numeric: true },
              { key: 'minimum', label: 'Minimum', numeric: true },
              { key: 'alerte', label: '', numeric: false },
            ]}
            isEmpty={(spareParts.data ?? []).length === 0}
            emptyText="Aucune pièce de rechange."
          >
            {(spareParts.data ?? []).map((part) => (
              <tr key={part.id}>
                <td>
                  <strong>{part.partCode}</strong>
                </td>
                <td>{part.name}</td>
                <td className="nombre">
                  {part.currentStock} {part.unit}
                </td>
                <td className="nombre">{part.minimumStock}</td>
                <td>{part.belowMinimum ? <span className="badge alerte">Stock de sécurité atteint</span> : null}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Card>
    </>
  );
}
