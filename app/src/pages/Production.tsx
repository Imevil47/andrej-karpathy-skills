/**
 * Écrans — Zone Traitement (section 5), Machines Filet (section 6),
 * Cuisson (section 7).
 *
 * Ces trois postes suivent le même schéma ENTRÉE → SORTIE → PERTES → ÉCART,
 * avec temps de fonctionnement et arrêts imputés.
 */

import {
  dureeMinutes,
  ecartMatiere,
  fmt,
  fmtDuree,
  fmtInt,
  rendement,
} from '../domain/calculations';
import { indicateursOperation } from '../domain/selectors';
import {
  DESTINATIONS,
  EQUIPES,
  type CuissonOperation,
  type Database,
  type FiletOperation,
  type TreatmentOperation,
} from '../domain/types';
import { EcranExploitation } from '../ui/crud';
import type { Champ, ChampCalcule } from '../ui/forms';
import {
  dateDuJour,
  heure,
  libelleLigne,
  libelleLot,
  libelleMachine,
  maintenant,
  optionsEmployes,
  optionsEnum,
  optionsLignes,
  optionsLots,
  optionsMachines,
  optionsProduits,
} from '../ui/options';
import { Badge, Kpi } from '../ui/primitives';

/** Champs partagés par toute opération de transformation. */
function champsFlux<T extends { quantiteEntree: number; quantiteSortie: number; pertes: number }>(
  db: Database,
): Champ<T>[] {
  return [
    { nom: 'lotId', label: 'Lot', type: 'select', requis: true, options: optionsLots(db) },
    { nom: 'productId', label: 'Produit', type: 'select', options: optionsProduits(db) },
    { nom: 'date', label: 'Date', type: 'date', requis: true },
    { nom: 'equipe', label: 'Équipe', type: 'select', options: optionsEnum(EQUIPES) },
    { nom: 'heureDebut', label: 'Heure début', type: 'datetime', requis: true },
    { nom: 'heureFin', label: 'Heure fin', type: 'datetime' },
    { nom: 'quantiteEntree', label: 'Quantité entrée', type: 'nombre', suffixe: 'kg', requis: true },
    { nom: 'quantiteSortie', label: 'Quantité sortie', type: 'nombre', suffixe: 'kg', requis: true },
    { nom: 'pertes', label: 'Pertes déclarées', type: 'nombre', suffixe: 'kg', requis: true },
    { nom: 'nbPersonnel', label: 'Personnel', type: 'nombre', suffixe: 'pers.' },
    { nom: 'operateurId', label: 'Responsable', type: 'select', options: optionsEmployes(db) },
    { nom: 'observations', label: 'Observations', type: 'zone-texte', large: true },
  ] as Champ<T>[];
}

/** Indicateurs recalculés en direct pendant la saisie. */
function calculesFlux<
  T extends {
    quantiteEntree?: number;
    quantiteSortie?: number;
    pertes?: number;
    heureDebut?: string;
    heureFin?: string;
  },
>(): ChampCalcule<T>[] {
  return [
    {
      label: 'Durée brute',
      valeur: (o) => fmtDuree(dureeMinutes(o.heureDebut, o.heureFin)),
    },
    {
      label: 'Rendement',
      valeur: (o) => {
        const r = rendement(o.quantiteEntree ?? 0, o.quantiteSortie ?? 0);
        return r === null ? '—' : `${fmt(r)} %`;
      },
    },
    {
      label: 'Perte',
      valeur: (o) => `${fmt((o.quantiteEntree ?? 0) - (o.quantiteSortie ?? 0), 0)} kg`,
    },
    {
      label: 'Écart matière',
      valeur: (o) =>
        `${fmt(
          ecartMatiere(o.quantiteEntree ?? 0, o.quantiteSortie ?? 0, o.pertes ?? 0),
          0,
        )} kg`,
      aide: 'entrée − sortie − pertes',
    },
  ];
}

/** Colonnes calculées communes: temps, rendement, cadence, écart. */
function colonnesIndicateurs<
  T extends {
    quantiteEntree: number;
    quantiteSortie: number;
    pertes: number;
    heureDebut: string;
    heureFin?: string;
    nbPersonnel?: number;
  },
>(db: Database, ressource: (o: T) => { lineId?: string; machineId?: string }) {
  const ind = (o: T) => indicateursOperation(db, { ...o, ...ressource(o) });
  return [
    {
      cle: 'entree',
      entete: 'Entrée (kg)',
      rendu: (o: T) => fmtInt(o.quantiteEntree),
      numerique: true,
    },
    {
      cle: 'sortie',
      entete: 'Sortie (kg)',
      rendu: (o: T) => fmtInt(o.quantiteSortie),
      numerique: true,
    },
    {
      cle: 'pertes',
      entete: 'Pertes (kg)',
      rendu: (o: T) => fmtInt(o.pertes),
      numerique: true,
    },
    {
      cle: 'rendement',
      entete: 'Rendement',
      rendu: (o: T) => {
        const r = ind(o).rendementPct;
        const ton = r === null ? '' : r >= 78 ? 'text-emerald-700' : r >= 70 ? '' : 'text-rose-600';
        return <span className={`font-medium ${ton}`}>{r === null ? '—' : `${fmt(r)} %`}</span>;
      },
      numerique: true,
    },
    {
      cle: 'ecart',
      entete: 'Écart (kg)',
      rendu: (o: T) => {
        const e = ind(o).ecartKg;
        return (
          <span className={Math.abs(e) > 0.5 ? 'font-medium text-amber-600' : 'text-ardoise-400'}>
            {fmtInt(e)}
          </span>
        );
      },
      numerique: true,
    },
    {
      cle: 'brut',
      entete: 'Durée',
      rendu: (o: T) => fmtDuree(ind(o).dureeBruteMin),
      numerique: true,
      secondaire: true,
    },
    {
      cle: 'arret',
      entete: 'Arrêts',
      rendu: (o: T) => {
        const i = ind(o);
        return i.tempsArretMin > 0 ? (
          <span className="text-rose-600">
            {fmtDuree(i.tempsArretMin)} <span className="text-ardoise-400">({i.nbArrets})</span>
          </span>
        ) : (
          <span className="text-ardoise-400">—</span>
        );
      },
      numerique: true,
    },
    {
      cle: 'net',
      entete: 'Temps net',
      rendu: (o: T) => fmtDuree(ind(o).tempsNetMin),
      numerique: true,
    },
    {
      cle: 'cadence',
      entete: 'Cadence (kg/h)',
      rendu: (o: T) => fmtInt(ind(o).cadenceKgH),
      numerique: true,
      secondaire: true,
    },
  ];
}

/** Bandeau d'indicateurs agrégés, commun aux trois écrans. */
function resumeFlux<
  T extends { quantiteEntree: number; quantiteSortie: number; pertes: number },
>(lignes: T[]) {
  const entree = lignes.reduce((t, o) => t + o.quantiteEntree, 0);
  const sortie = lignes.reduce((t, o) => t + o.quantiteSortie, 0);
  const pertes = lignes.reduce((t, o) => t + o.pertes, 0);
  const r = rendement(entree, sortie);
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Kpi libelle="Matière entrée" valeur={fmtInt(entree)} unite="kg" />
      <Kpi libelle="Matière sortie" valeur={fmtInt(sortie)} unite="kg" />
      <Kpi
        libelle="Rendement"
        valeur={r === null ? '—' : fmt(r)}
        unite="%"
        ton={r === null ? 'neutre' : r >= 78 ? 'bon' : r >= 70 ? 'alerte' : 'critique'}
      />
      <Kpi
        libelle="Écart matière"
        valeur={fmtInt(ecartMatiere(entree, sortie, pertes))}
        unite="kg"
        detail="entrée − sortie − pertes"
        ton={Math.abs(ecartMatiere(entree, sortie, pertes)) > 1 ? 'alerte' : 'bon'}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */

export function PageTraitement() {
  return (
    <EcranExploitation<TreatmentOperation>
      titre="Zone Traitement"
      sousTitre="Coupe et préparation sur les 4 lignes de traitement. Chaque opération est dirigée vers le somerage, le grattage ou la zone filet."
      table="treatmentOperations"
      libelleCreation="Nouvelle opération"
      filtresAffiches={['dateDebut', 'dateFin', 'equipe', 'lotId', 'productId', 'lineId', 'destination', 'operateurId']}
      valeursParDefaut={() => ({
        date: dateDuJour(),
        heureDebut: maintenant(),
        quantiteEntree: 0,
        quantiteSortie: 0,
        pertes: 0,
      })}
      champs={(db) => [
        {
          nom: 'lineId',
          label: 'Ligne de traitement',
          type: 'select',
          requis: true,
          options: optionsLignes(db, 'Traitement'),
        },
        {
          nom: 'destination',
          label: 'Destination après coupe',
          type: 'select',
          requis: true,
          options: optionsEnum(DESTINATIONS),
        },
        ...champsFlux<TreatmentOperation>(db),
      ]}
      calcules={calculesFlux<TreatmentOperation>()}
      colonnes={(db) => [
        { cle: 'ligne', entete: 'Ligne', rendu: (o) => <span className="font-medium">{libelleLigne(db, o.lineId)}</span> },
        { cle: 'lot', entete: 'Lot', rendu: (o) => libelleLot(db, o.lotId) },
        { cle: 'dest', entete: 'Destination', rendu: (o) => <Badge ton="info">{o.destination}</Badge> },
        { cle: 'debut', entete: 'Début', rendu: (o) => heure(o.heureDebut), secondaire: true },
        { cle: 'fin', entete: 'Fin', rendu: (o) => heure(o.heureFin), secondaire: true },
        ...colonnesIndicateurs<TreatmentOperation>(db, (o) => ({ lineId: o.lineId })),
      ]}
      resume={(lignes) => resumeFlux(lignes)}
    />
  );
}

export function PageFilet() {
  return (
    <EcranExploitation<FiletOperation>
      titre="Machines Filet"
      sousTitre="Zone filet: chaque machine est suivie comme une ressource distincte des lignes de traitement."
      table="filetOperations"
      libelleCreation="Nouvelle opération"
      filtresAffiches={['dateDebut', 'dateFin', 'equipe', 'lotId', 'productId', 'machineId', 'operateurId']}
      valeursParDefaut={() => ({
        date: dateDuJour(),
        heureDebut: maintenant(),
        quantiteEntree: 0,
        quantiteSortie: 0,
        pertes: 0,
      })}
      champs={(db) => [
        {
          nom: 'machineId',
          label: 'Machine filet',
          type: 'select',
          requis: true,
          options: optionsMachines(db, 'Filet'),
        },
        ...champsFlux<FiletOperation>(db),
      ]}
      calcules={calculesFlux<FiletOperation>()}
      colonnes={(db) => [
        { cle: 'machine', entete: 'Machine', rendu: (o) => <span className="font-medium">{libelleMachine(db, o.machineId)}</span> },
        { cle: 'lot', entete: 'Lot', rendu: (o) => libelleLot(db, o.lotId) },
        { cle: 'debut', entete: 'Début', rendu: (o) => heure(o.heureDebut), secondaire: true },
        { cle: 'fin', entete: 'Fin', rendu: (o) => heure(o.heureFin), secondaire: true },
        ...colonnesIndicateurs<FiletOperation>(db, (o) => ({ machineId: o.machineId })),
      ]}
      resume={(lignes) => resumeFlux(lignes)}
      complement={(lignes, db) => <EtatMachinesFilet lignes={lignes} db={db} />}
    />
  );
}

/** État courant de chaque machine filet (section 6). */
function EtatMachinesFilet({ lignes, db }: { lignes: FiletOperation[]; db: Database }) {
  const machines = db.machines.filter((m) => m.zone === 'Filet' && m.actif);
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {machines.map((machine) => {
        const ops = lignes.filter((o) => o.machineId === machine.id);
        const entree = ops.reduce((t, o) => t + o.quantiteEntree, 0);
        const sortie = ops.reduce((t, o) => t + o.quantiteSortie, 0);
        const arrets = db.stops.filter((s) => s.machineId === machine.id);
        const arretMin = arrets.reduce((t, s) => t + (dureeMinutes(s.heureDebut, s.heureFin) ?? 0), 0);
        const fonctionnementMin = ops.reduce(
          (t, o) => t + (dureeMinutes(o.heureDebut, o.heureFin) ?? 0),
          0,
        );
        const r = rendement(entree, sortie);
        return (
          <div key={machine.id} className="rounded-xl border border-ardoise-200 bg-white p-4 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
              <p className="font-medium text-ardoise-900">{machine.nom}</p>
              <Badge ton={arretMin > 0 ? 'alerte' : 'bon'}>{machine.etat}</Badge>
            </div>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
              <dt className="text-ardoise-500">Entrée</dt>
              <dd className="text-right tabulaire">{fmtInt(entree)} kg</dd>
              <dt className="text-ardoise-500">Sortie</dt>
              <dd className="text-right tabulaire">{fmtInt(sortie)} kg</dd>
              <dt className="text-ardoise-500">Pertes</dt>
              <dd className="text-right tabulaire">{fmtInt(entree - sortie)} kg</dd>
              <dt className="text-ardoise-500">Rendement</dt>
              <dd className="text-right tabulaire font-medium">
                {r === null ? '—' : `${fmt(r)} %`}
              </dd>
              <dt className="text-ardoise-500">Fonctionnement</dt>
              <dd className="text-right tabulaire">{fmtDuree(fonctionnementMin)}</dd>
              <dt className="text-ardoise-500">Arrêts</dt>
              <dd className="text-right tabulaire">
                {arretMin > 0 ? (
                  <span className="text-rose-600">{fmtDuree(arretMin)}</span>
                ) : (
                  '—'
                )}
              </dd>
            </dl>
            {arrets.length > 0 && (
              <p className="mt-2 border-t border-ardoise-100 pt-2 text-xs text-ardoise-500">
                Dernier motif: {arrets[arrets.length - 1].motif}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function PageCuisson() {
  return (
    <EcranExploitation<CuissonOperation>
      titre="Mise en grille & cuisson"
      sousTitre="Matière destinée au grattage: mise en grille, cuisson puis égouttage. Le rendement intègre la perte d’égouttage."
      table="cuissonOperations"
      libelleCreation="Nouvelle cuisson"
      filtresAffiches={['dateDebut', 'dateFin', 'equipe', 'lotId', 'productId', 'machineId']}
      valeursParDefaut={() => ({
        date: dateDuJour(),
        heureDebut: maintenant(),
        nombreGrilles: 0,
        quantiteEntree: 0,
        quantiteSortie: 0,
        pertes: 0,
      })}
      champs={(db) => [
        { nom: 'machineId', label: 'Cuiseur', type: 'select', options: optionsMachines(db, 'Cuisson') },
        { nom: 'nombreGrilles', label: 'Nombre de grilles', type: 'nombre', requis: true },
        { nom: 'temperature', label: 'Température', type: 'nombre', suffixe: '°C', pas: 0.5 },
        { nom: 'dureeConsigneMin', label: 'Durée de consigne', type: 'nombre', suffixe: 'min' },
        ...champsFlux<CuissonOperation>(db),
      ]}
      calcules={calculesFlux<CuissonOperation>()}
      colonnes={(db) => [
        { cle: 'cuiseur', entete: 'Cuiseur', rendu: (o) => <span className="font-medium">{libelleMachine(db, o.machineId)}</span> },
        { cle: 'lot', entete: 'Lot', rendu: (o) => libelleLot(db, o.lotId) },
        { cle: 'grilles', entete: 'Grilles', rendu: (o) => fmtInt(o.nombreGrilles), numerique: true },
        { cle: 'debut', entete: 'Entrée cuisson', rendu: (o) => heure(o.heureDebut) },
        { cle: 'fin', entete: 'Sortie cuisson', rendu: (o) => heure(o.heureFin) },
        {
          cle: 'params',
          entete: 'Paramètres',
          rendu: (o) =>
            `${o.temperature ?? '—'} °C / ${o.dureeConsigneMin ?? '—'} min`,
          secondaire: true,
        },
        ...colonnesIndicateurs<CuissonOperation>(db, (o) => ({ machineId: o.machineId })),
      ]}
      resume={(lignes) => (
        <>
          <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi
              libelle="Grilles cuites"
              valeur={fmtInt(lignes.reduce((t, o) => t + o.nombreGrilles, 0))}
            />
            <Kpi
              libelle="Durée moyenne"
              valeur={fmtDuree(
                lignes.length
                  ? lignes.reduce((t, o) => t + (dureeMinutes(o.heureDebut, o.heureFin) ?? 0), 0) /
                      lignes.length
                  : null,
              )}
            />
            <Kpi
              libelle="Cycles"
              valeur={fmtInt(lignes.length)}
            />
            <Kpi
              libelle="Perte égouttage"
              valeur={fmtInt(lignes.reduce((t, o) => t + (o.quantiteEntree - o.quantiteSortie), 0))}
              unite="kg"
              ton="alerte"
            />
          </div>
          {resumeFlux(lignes)}
        </>
      )}
    />
  );
}
