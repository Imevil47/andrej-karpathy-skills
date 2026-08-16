/**
 * Écran — Zone Grattage (sections 8 et 9).
 *
 * Écran dédié: chaque session de grattage porte la production individuelle des
 * opératrices, ce que le formulaire générique ne sait pas représenter.
 */

import { useMemo, useState } from 'react';
import { store } from '../data/store';
import {
  cadenceHoraire,
  dureeMinutes,
  fmt,
  fmtDuree,
  fmtInt,
  productivite,
} from '../domain/calculations';
import {
  appliquerFiltres,
  indicateursTemps,
  performanceOperatrices,
} from '../domain/selectors';
import { EQUIPES, type GrattageOperation, type OperatriceProduction } from '../domain/types';
import { BarreFiltres } from '../ui/filtres';
import { Modale } from '../ui/forms';
import {
  dateDuJour,
  heure,
  libelleLigne,
  libelleLot,
  maintenant,
  optionsEmployes,
  optionsLignes,
  optionsLots,
  optionsProduits,
} from '../ui/options';
import { Bouton, Carte, Kpi, PageHeader, Tableau, Vide } from '../ui/primitives';
import { useDb, useFiltres } from '../ui/state';

const CLASSE_SAISIE =
  'w-full min-h-11 rounded-lg border border-ardoise-300 bg-white px-3 text-sm outline-none focus:border-mer-500 focus:ring-2 focus:ring-mer-500/20';

export function PageGrattage() {
  const db = useDb();
  const { filtres } = useFiltres();
  const [edition, setEdition] = useState<Partial<GrattageOperation> | null>(null);

  const lignes = useMemo(
    () => [...appliquerFiltres(db.grattageOperations, filtres)].reverse(),
    [db.grattageOperations, filtres],
  );

  const totalBoites = lignes.reduce((t, o) => t + o.nombreBoites, 0);
  const totalEntree = lignes.reduce((t, o) => t + o.quantiteEntree, 0);
  const totalRejet = lignes.reduce((t, o) => t + o.quantiteRejetee, 0);
  const totalOperatrices = lignes.reduce((t, o) => t + o.operatrices.length, 0);

  // Moyenne des cadences de chaque ligne — et non la production totale rapportée
  // au temps d'une seule ligne, qui la multiplierait par le nombre de lignes.
  const cadencesParLigne = lignes
    .map((o) =>
      cadenceHoraire(o.nombreBoites, indicateursTemps(db, { ...o, lineId: o.lineId }).tempsNetMin),
    )
    .filter((c): c is number => c !== null);
  const cadenceMoyenne = cadencesParLigne.length
    ? cadencesParLigne.reduce((t, c) => t + c, 0) / cadencesParLigne.length
    : null;

  const enregistrer = (valeurs: Partial<GrattageOperation>) => {
    if (valeurs.id) store.update('grattageOperations', valeurs.id, valeurs);
    else store.insert('grattageOperations', valeurs as never);
    setEdition(null);
  };

  return (
    <>
      <PageHeader
        titre="Zone Grattage"
        sousTitre="4 lignes suivies séparément, avec la production individuelle de chaque opératrice et la cadence qui en découle."
        actions={
          <Bouton
            variante="primaire"
            onClick={() =>
              setEdition({
                date: dateDuJour(),
                heureDebut: maintenant(),
                quantiteEntree: 0,
                nombreBoites: 0,
                quantiteRejetee: 0,
                poidsMoyenG: 90,
                operatrices: [],
              })
            }
          >
            + Nouvelle session
          </Bouton>
        }
      />

      <BarreFiltres
        criteres={['dateDebut', 'dateFin', 'equipe', 'lotId', 'productId', 'lineId', 'operateurId']}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi libelle="Boîtes produites" valeur={fmtInt(totalBoites)} />
        <Kpi libelle="Matière entrée" valeur={fmtInt(totalEntree)} unite="kg" />
        <Kpi
          libelle="Rejet"
          valeur={fmtInt(totalRejet)}
          unite="kg"
          ton={totalRejet > 0 ? 'alerte' : 'neutre'}
        />
        <Kpi libelle="Opératrices" valeur={fmtInt(totalOperatrices)} />
        <Kpi
          libelle="Cadence moyenne"
          valeur={fmtInt(cadenceMoyenne)}
          unite="bt/h"
          detail="par ligne"
        />
      </div>

      <Carte titre={`${lignes.length} session${lignes.length > 1 ? 's' : ''} de grattage`}>
        <Tableau
          lignes={lignes}
          clef={(o) => o.id}
          messageVide="Aucune session pour les filtres actifs."
          colonnes={[
            {
              cle: 'ligne',
              entete: 'Ligne',
              rendu: (o) => <span className="font-medium">{libelleLigne(db, o.lineId)}</span>,
            },
            { cle: 'lot', entete: 'Lot', rendu: (o) => libelleLot(db, o.lotId) },
            { cle: 'debut', entete: 'Début', rendu: (o) => heure(o.heureDebut) },
            { cle: 'fin', entete: 'Fin', rendu: (o) => heure(o.heureFin) },
            {
              cle: 'entree',
              entete: 'Entrée (kg)',
              rendu: (o) => fmtInt(o.quantiteEntree),
              numerique: true,
            },
            {
              cle: 'boites',
              entete: 'Boîtes',
              rendu: (o) => <span className="font-medium">{fmtInt(o.nombreBoites)}</span>,
              numerique: true,
            },
            {
              cle: 'poids',
              entete: 'Poids moyen (g)',
              rendu: (o) => fmt(o.poidsMoyenG),
              numerique: true,
              secondaire: true,
            },
            {
              cle: 'rejet',
              entete: 'Rejet (kg)',
              rendu: (o) => fmtInt(o.quantiteRejetee),
              numerique: true,
            },
            {
              cle: 'operatrices',
              entete: 'Opératrices',
              rendu: (o) => fmtInt(o.operatrices.length),
              numerique: true,
            },
            {
              cle: 'arrets',
              entete: 'Arrêts',
              rendu: (o) => {
                const i = indicateursTemps(db, { ...o, lineId: o.lineId });
                return i.tempsArretMin > 0 ? (
                  <span className="text-rose-600">{fmtDuree(i.tempsArretMin)}</span>
                ) : (
                  <span className="text-ardoise-400">—</span>
                );
              },
              numerique: true,
            },
            {
              cle: 'net',
              entete: 'Temps net',
              rendu: (o) => fmtDuree(indicateursTemps(db, { ...o, lineId: o.lineId }).tempsNetMin),
              numerique: true,
            },
            {
              cle: 'cadence',
              entete: 'Cadence (bt/h)',
              rendu: (o) => {
                const i = indicateursTemps(db, { ...o, lineId: o.lineId });
                return (
                  <span className="font-medium">
                    {fmtInt(cadenceHoraire(o.nombreBoites, i.tempsNetMin))}
                  </span>
                );
              },
              numerique: true,
            },
            {
              cle: 'productivite',
              entete: 'Produc. /pers.',
              rendu: (o) => {
                const i = indicateursTemps(db, { ...o, lineId: o.lineId });
                return fmtInt(productivite(o.nombreBoites, o.operatrices.length, i.tempsNetMin));
              },
              numerique: true,
              secondaire: true,
            },
          ]}
          actions={(o) => (
            <div className="flex justify-end gap-1">
              <button
                type="button"
                onClick={() => setEdition(o)}
                className="rounded px-2 py-1 text-xs font-medium text-mer-600 hover:bg-mer-500/10"
              >
                Modifier
              </button>
              <button
                type="button"
                onClick={() => {
                  if (confirm('Supprimer cette session de grattage ?')) {
                    store.remove('grattageOperations', o.id);
                  }
                }}
                className="rounded px-2 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50"
              >
                Supprimer
              </button>
            </div>
          )}
        />
      </Carte>

      <div className="mt-4">
        <SuiviOperatrices />
      </div>

      {edition && (
        <Modale
          titre={edition.id ? 'Session de grattage — modification' : 'Nouvelle session de grattage'}
          onFermer={() => setEdition(null)}
        >
          <FormulaireGrattage
            valeurs={edition}
            onValider={enregistrer}
            onAnnuler={() => setEdition(null)}
          />
        </Modale>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */

function FormulaireGrattage({
  valeurs,
  onValider,
  onAnnuler,
}: {
  valeurs: Partial<GrattageOperation>;
  onValider: (v: Partial<GrattageOperation>) => void;
  onAnnuler: () => void;
}) {
  const db = useDb();
  const [brouillon, setBrouillon] = useState<Partial<GrattageOperation>>(valeurs);
  const operatrices = brouillon.operatrices ?? [];

  const modifier = (nom: keyof GrattageOperation, valeur: unknown) =>
    setBrouillon((b) => ({ ...b, [nom]: valeur }));

  const modifierOperatrice = (index: number, patch: Partial<OperatriceProduction>) =>
    setBrouillon((b) => ({
      ...b,
      operatrices: (b.operatrices ?? []).map((o, i) => (i === index ? { ...o, ...patch } : o)),
    }));

  // Le total des boîtes de la ligne est la somme des productions individuelles:
  // il n'est jamais saisi (règle de la section 23).
  const totalBoites = operatrices.reduce((t, o) => t + (o.nombreBoites || 0), 0);
  const dureeBrute = dureeMinutes(brouillon.heureDebut, brouillon.heureFin);
  const arretMin = brouillon.lineId
    ? indicateursTemps(db, {
        lineId: brouillon.lineId,
        heureDebut: brouillon.heureDebut ?? '',
        heureFin: brouillon.heureFin,
      }).tempsArretMin
    : 0;
  const net = dureeBrute === null ? null : Math.max(0, dureeBrute - arretMin);

  const champ = (
    label: string,
    contenu: React.ReactNode,
    large = false,
  ) => (
    <label className={`block ${large ? 'sm:col-span-2 lg:col-span-3' : ''}`}>
      <span className="mb-1 block text-xs font-medium text-ardoise-600">{label}</span>
      {contenu}
    </label>
  );

  const saisieTexte = (
    nom: keyof GrattageOperation,
    type: 'date' | 'datetime-local' | 'number',
    pas?: string,
  ) => (
    <input
      type={type}
      step={pas}
      className={CLASSE_SAISIE}
      value={(brouillon[nom] as string | number | undefined) ?? ''}
      onChange={(e) =>
        modifier(nom, type === 'number' ? (e.target.value === '' ? undefined : Number(e.target.value)) : e.target.value)
      }
    />
  );

  const saisieSelect = (
    nom: keyof GrattageOperation,
    options: { value: string; label: string }[],
  ) => (
    <select
      className={CLASSE_SAISIE}
      value={(brouillon[nom] as string) ?? ''}
      onChange={(e) => modifier(nom, e.target.value || undefined)}
    >
      <option value="">—</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        onValider({ ...brouillon, nombreBoites: totalBoites });
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {champ('Ligne de grattage', saisieSelect('lineId', optionsLignes(db, 'Grattage')))}
        {champ('Lot', saisieSelect('lotId', optionsLots(db)))}
        {champ('Produit', saisieSelect('productId', optionsProduits(db)))}
        {champ('Date', saisieTexte('date', 'date'))}
        {champ('Équipe', saisieSelect('equipe', EQUIPES.map((e) => ({ value: e, label: e }))))}
        {champ('Responsable', saisieSelect('operateurId', optionsEmployes(db)))}
        {champ('Heure début', saisieTexte('heureDebut', 'datetime-local'))}
        {champ('Heure fin', saisieTexte('heureFin', 'datetime-local'))}
        {champ('Quantité matière entrée (kg)', saisieTexte('quantiteEntree', 'number', 'any'))}
        {champ('Poids moyen par boîte (g)', saisieTexte('poidsMoyenG', 'number', 'any'))}
        {champ('Quantité rejetée (kg)', saisieTexte('quantiteRejetee', 'number', 'any'))}
        {champ(
          'Observations',
          <textarea
            rows={2}
            className={`${CLASSE_SAISIE} py-2`}
            value={brouillon.observations ?? ''}
            onChange={(e) => modifier('observations', e.target.value)}
          />,
          true,
        )}
      </div>

      {/* Suivi individuel des opératrices */}
      <div className="rounded-lg border border-ardoise-200">
        <div className="flex items-center justify-between border-b border-ardoise-100 px-3 py-2">
          <p className="text-sm font-semibold text-ardoise-700">Opératrices de la ligne</p>
          <Bouton
            onClick={() =>
              setBrouillon((b) => ({
                ...b,
                operatrices: [
                  ...(b.operatrices ?? []),
                  {
                    employeeId: '',
                    heureDebut: b.heureDebut,
                    heureFin: b.heureFin,
                    nombreBoites: 0,
                  },
                ],
              }))
            }
          >
            + Ajouter
          </Bouton>
        </div>

        <div className="space-y-2 p-3">
          {operatrices.length === 0 && (
            <p className="py-3 text-center text-sm text-ardoise-400">
              Aucune opératrice enregistrée sur cette session.
            </p>
          )}
          {operatrices.map((op, index) => {
            const brut = dureeMinutes(op.heureDebut ?? brouillon.heureDebut, op.heureFin ?? brouillon.heureFin);
            const netOp = brut === null ? null : Math.max(0, brut - arretMin);
            return (
              <div
                key={index}
                className="grid grid-cols-2 items-end gap-2 rounded-lg bg-ardoise-50 p-2 sm:grid-cols-6"
              >
                <label className="col-span-2 block">
                  <span className="mb-1 block text-[11px] text-ardoise-500">Matricule / nom</span>
                  <select
                    className={CLASSE_SAISIE}
                    value={op.employeeId}
                    onChange={(e) => modifierOperatrice(index, { employeeId: e.target.value })}
                  >
                    <option value="">—</option>
                    {optionsEmployes(db).map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] text-ardoise-500">Début</span>
                  <input
                    type="datetime-local"
                    className={CLASSE_SAISIE}
                    value={op.heureDebut ?? ''}
                    onChange={(e) => modifierOperatrice(index, { heureDebut: e.target.value })}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] text-ardoise-500">Fin</span>
                  <input
                    type="datetime-local"
                    className={CLASSE_SAISIE}
                    value={op.heureFin ?? ''}
                    onChange={(e) => modifierOperatrice(index, { heureFin: e.target.value })}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] text-ardoise-500">Boîtes</span>
                  <input
                    type="number"
                    className={CLASSE_SAISIE}
                    value={op.nombreBoites}
                    onChange={(e) =>
                      modifierOperatrice(index, { nombreBoites: Number(e.target.value) })
                    }
                  />
                </label>
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <span className="block text-[11px] text-ardoise-500">Cadence</span>
                    <span className="text-sm font-semibold tabulaire text-ardoise-800">
                      {fmtInt(cadenceHoraire(op.nombreBoites, netOp))} bt/h
                    </span>
                  </div>
                  <button
                    type="button"
                    aria-label="Retirer l’opératrice"
                    onClick={() =>
                      setBrouillon((b) => ({
                        ...b,
                        operatrices: (b.operatrices ?? []).filter((_, i) => i !== index),
                      }))
                    }
                    className="rounded px-2 py-1 text-lg leading-none text-rose-500 hover:bg-rose-50"
                  >
                    ×
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="rounded-lg border border-dashed border-ardoise-300 bg-ardoise-50 p-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ardoise-500">
          Calculé automatiquement
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Derive libelle="Boîtes produites (ligne)" valeur={fmtInt(totalBoites)} />
          <Derive libelle="Durée brute" valeur={fmtDuree(dureeBrute)} />
          <Derive libelle="Temps d’arrêt" valeur={fmtDuree(arretMin)} />
          <Derive libelle="Temps net" valeur={fmtDuree(net)} />
          <Derive libelle="Cadence ligne" valeur={`${fmtInt(cadenceHoraire(totalBoites, net))} bt/h`} />
          <Derive
            libelle="Productivité"
            valeur={`${fmtInt(productivite(totalBoites, operatrices.length, net))} bt/h/pers.`}
          />
          <Derive
            libelle="Rendement matière"
            valeur={
              brouillon.quantiteEntree && brouillon.poidsMoyenG
                ? `${fmt(((totalBoites * brouillon.poidsMoyenG) / 1000 / brouillon.quantiteEntree) * 100)} %`
                : '—'
            }
          />
          <Derive
            libelle="Moyenne / opératrice"
            valeur={operatrices.length ? fmtInt(totalBoites / operatrices.length) : '—'}
          />
        </div>
      </div>

      <div className="flex justify-end gap-2 border-t border-ardoise-100 pt-3">
        <Bouton onClick={onAnnuler}>Annuler</Bouton>
        <Bouton type="submit" variante="primaire">
          Enregistrer
        </Bouton>
      </div>
    </form>
  );
}

function Derive({ libelle, valeur }: { libelle: string; valeur: string }) {
  return (
    <div>
      <p className="text-xs text-ardoise-500">{libelle}</p>
      <p className="text-sm font-semibold tabulaire text-ardoise-800">{valeur}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */

/** Section 9 — production et cadence individuelles. */
export function SuiviOperatrices() {
  const db = useDb();
  const { filtres } = useFiltres();
  const performances = performanceOperatrices(db, filtres);

  if (performances.length === 0) {
    return (
      <Carte titre="Suivi individuel des opératrices">
        <Vide message="Aucune production individuelle enregistrée." />
      </Carte>
    );
  }

  const moyenne =
    performances.reduce((t, p) => t + (p.cadenceBoitesH ?? 0), 0) / performances.length;

  return (
    <Carte titre="Suivi individuel des opératrices">
      <Tableau
        lignes={performances}
        clef={(p) => `${p.matricule}-${p.ligne}`}
        colonnes={[
          { cle: 'matricule', entete: 'Matricule', rendu: (p) => p.matricule },
          { cle: 'nom', entete: 'Nom', rendu: (p) => <span className="font-medium">{p.nom}</span> },
          { cle: 'ligne', entete: 'Ligne', rendu: (p) => p.ligne },
          { cle: 'boites', entete: 'Boîtes', rendu: (p) => fmtInt(p.boites), numerique: true },
          {
            cle: 'net',
            entete: 'Temps net',
            rendu: (p) => fmtDuree(p.tempsNetMin),
            numerique: true,
            secondaire: true,
          },
          {
            cle: 'cadence',
            entete: 'Cadence (bt/h)',
            rendu: (p) => (
              <span
                className={`font-medium ${
                  (p.cadenceBoitesH ?? 0) >= moyenne ? 'text-emerald-700' : 'text-amber-700'
                }`}
              >
                {fmtInt(p.cadenceBoitesH)}
              </span>
            ),
            numerique: true,
          },
          {
            cle: 'ecart',
            entete: '/ moyenne',
            rendu: (p) => {
              const ecart = (p.cadenceBoitesH ?? 0) - moyenne;
              return (
                <span className={ecart >= 0 ? 'text-emerald-700' : 'text-rose-600'}>
                  {ecart >= 0 ? '+' : ''}
                  {fmtInt(ecart)}
                </span>
              );
            },
            numerique: true,
          },
        ]}
      />
      <p className="mt-3 text-xs text-ardoise-500">
        Cadence moyenne toutes lignes confondues: <strong>{fmtInt(moyenne)} boîtes/h</strong> —
        cadence opératrice = boîtes produites / temps net.
      </p>
    </Carte>
  );
}
