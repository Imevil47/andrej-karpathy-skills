import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiPost } from '../api';
import { Card, Field, Message, PageHeader } from '../components/ui';
import { label } from '../format';
import { useResource } from '../hooks';
import { useProductionLines, useProducts } from '../masterdata';

type UserRow = Readonly<{ id: string; fullName: string; role: string }>;

const ACTIVITIES = [
  'GRATTAGE',
  'REMPLISSAGE',
  'GRATTAGE_REMPLISSAGE',
  'TRAITEMENT',
  'AUTRE',
] as const;

/**
 * Creating a run establishes the production context only. Raw material is not
 * selected here: consumption is a physical event recorded during the run.
 */
export function ProductionRunNouveau() {
  const navigate = useNavigate();
  const products = useProducts();
  const lines = useProductionLines();
  const users = useResource<readonly UserRow[]>('/api/users');

  const [productionDate, setProductionDate] = useState(new Date().toISOString().slice(0, 10));
  const [productId, setProductId] = useState('');
  const [format, setFormat] = useState('');
  const [piecesPerCan, setPiecesPerCan] = useState('');
  const [responsibleUserId, setResponsibleUserId] = useState('');
  const [notes, setNotes] = useState('');
  const [selectedLines, setSelectedLines] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const product = (products.data ?? []).find((entry) => entry.id === productId) ?? null;

  const toggleLine = (lineId: string, activity: string) =>
    setSelectedLines((current) => {
      const next = { ...current };
      if (activity === '') {
        delete next[lineId];
      } else {
        next[lineId] = activity;
      }
      return next;
    });

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await apiPost<{ id: string }>('/api/production/runs', {
        productionDate,
        productId,
        format: format.trim() === '' ? null : format.trim(),
        piecesPerCan: piecesPerCan.trim() === '' ? null : Number(piecesPerCan),
        responsibleUserId: responsibleUserId === '' ? null : responsibleUserId,
        lines: Object.entries(selectedLines).map(([productionLineId, activityType]) => ({
          productionLineId,
          activityType,
        })),
        notes: notes.trim() === '' ? null : notes.trim(),
      });
      navigate(`/production/${created.id}`);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Nouveau Run"
        subtitle="La matière première sera ajoutée pendant le Run, au moment de la consommation réelle."
        actions={null}
      />
      <Message kind="erreur" text={error} />

      <form onSubmit={submit}>
        <Card title="Contexte de production">
          <div className="grille-champs">
            <Field label="Date de production" hint={null}>
              <input
                type="date"
                value={productionDate}
                onChange={(event) => setProductionDate(event.target.value)}
                required
              />
            </Field>
            <Field label="Produit" hint="L'espèce est déduite du produit.">
              <select
                value={productId}
                onChange={(event) => {
                  setProductId(event.target.value);
                  setFormat('');
                  setPiecesPerCan('');
                }}
                required
              >
                <option value="">Sélectionner...</option>
                {(products.data ?? []).map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.code} — {entry.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Espèce" hint={null}>
              <input readOnly value={product?.speciesCode ?? '-'} />
            </Field>
            <Field label="Format" hint="Vide = format du produit.">
              <input
                value={format}
                onChange={(event) => setFormat(event.target.value)}
                placeholder={product?.format ?? ''}
              />
            </Field>
            <Field label="Pièces par boîte" hint="Vide = valeur du produit.">
              <input
                value={piecesPerCan}
                onChange={(event) => setPiecesPerCan(event.target.value)}
                inputMode="numeric"
                placeholder={product?.piecesPerCan?.toString() ?? ''}
              />
            </Field>
            <Field label="Responsable" hint={null}>
              <select
                value={responsibleUserId}
                onChange={(event) => setResponsibleUserId(event.target.value)}
              >
                <option value="">Non renseigné</option>
                {(users.data ?? []).map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.fullName}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Observations" hint={null}>
              <input value={notes} onChange={(event) => setNotes(event.target.value)} />
            </Field>
          </div>
          {product ? (
            <div className="message info" style={{ marginTop: 14 }}>
              Un changement de produit, de format ou de pièces par boîte demande un nouveau Run :
              ces attributs définissent l'identité de production.
            </div>
          ) : null}
        </Card>

        <Card title="Lignes actives">
          <p style={{ color: 'var(--texte-doux)', marginTop: 0 }}>
            Sélectionnez l'activité de chaque ligne participant à ce Run. Les lignes laissées vides
            ne participent pas.
          </p>
          <div className="grille-champs">
            {(lines.data ?? []).map((line) => (
              <Field key={line.id} label={line.name} hint={line.area}>
                <select
                  value={selectedLines[line.id] ?? ''}
                  onChange={(event) => toggleLine(line.id, event.target.value)}
                >
                  <option value="">Non utilisée</option>
                  {ACTIVITIES.map((activity) => (
                    <option key={activity} value={activity}>
                      {label(activity)}
                    </option>
                  ))}
                </select>
              </Field>
            ))}
          </div>
        </Card>

        <div className="ligne-boutons">
          <button type="submit" disabled={busy}>
            {busy ? 'Création...' : 'Créer le Run'}
          </button>
          <button type="button" className="secondaire" onClick={() => navigate('/production')}>
            Annuler
          </button>
        </div>
      </form>
    </>
  );
}
