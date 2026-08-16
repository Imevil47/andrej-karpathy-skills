/**
 * Écrans — Remplissage (10), Liquides (11), Sertissage (12), Marquage (13),
 * Stérilisation (14), Emballage (15).
 */

import {
  consommationParBoite,
  consommationTheorique,
  dureeMinutes,
  ecartLiquide,
  ecartPoidsMoyen,
  fmt,
  fmtDuree,
  fmtInt,
  surconsommationKg,
  tauxConformite,
} from '../domain/calculations';
import { appliquerFiltres, indicateursTemps } from '../domain/selectors';
import {
  EQUIPES,
  TYPES_LIQUIDE,
  type FillingOperation,
  type LiquidConsumption,
  type MarquageOperation,
  type PackagingOperation,
  type SertissageOperation,
  type SterilisationCycle,
} from '../domain/types';
import { EcranExploitation } from '../ui/crud';
import type { Champ } from '../ui/forms';
import {
  dateDuJour,
  heure,
  libelleLigne,
  libelleLot,
  libelleMachine,
  libelleProduit,
  maintenant,
  optionsEmployes,
  optionsEnum,
  optionsLignes,
  optionsLots,
  optionsMachines,
  optionsProduits,
} from '../ui/options';
import { Badge, Carte, Kpi, Tableau } from '../ui/primitives';
import { useDb, useFiltres } from '../ui/state';

/** Champs d'identification communs à toutes les opérations de conditionnement. */
const champsOperation = <T,>(db: ReturnType<typeof useDb>): Champ<T>[] =>
  [
    { nom: 'lotId', label: 'Lot', type: 'select', requis: true, options: optionsLots(db) },
    { nom: 'productId', label: 'Produit', type: 'select', options: optionsProduits(db) },
    { nom: 'date', label: 'Date', type: 'date', requis: true },
    { nom: 'equipe', label: 'Équipe', type: 'select', options: optionsEnum(EQUIPES) },
    { nom: 'heureDebut', label: 'Heure début', type: 'datetime', requis: true },
    { nom: 'heureFin', label: 'Heure fin', type: 'datetime' },
  ] as Champ<T>[];

/* ------------------------------------------------------------------ */
/* Remplissage                                                         */
/* ------------------------------------------------------------------ */

export function PageRemplissage() {
  return (
    <>
      <EcranExploitation<FillingOperation>
        titre="Remplissage & dosage"
        sousTitre="Remplissage des boîtes après grattage ou somerage. Le poids moyen, l’écart, le taux de conformité et la surconsommation sont calculés automatiquement."
        table="fillingOperations"
        libelleCreation="Nouveau remplissage"
        filtresAffiches={['dateDebut', 'dateFin', 'equipe', 'lotId', 'productId', 'lineId']}
        valeursParDefaut={() => ({
          date: dateDuJour(),
          heureDebut: maintenant(),
          nombreBoites: 0,
          poidsCibleG: 90,
          poidsReelMoyenG: 90,
          boitesSousPoids: 0,
          boitesSurPoids: 0,
          rebut: 0,
          quantiteMatiereConsommee: 0,
        })}
        champs={(db) => [
          {
            nom: 'lineId',
            label: 'Ligne de remplissage',
            type: 'select',
            requis: true,
            options: optionsLignes(db, 'Remplissage'),
          },
          ...champsOperation<FillingOperation>(db),
          { nom: 'nombreBoites', label: 'Nombre de boîtes', type: 'nombre', requis: true },
          { nom: 'poidsCibleG', label: 'Poids cible', type: 'nombre', suffixe: 'g', requis: true, pas: 0.1 },
          { nom: 'poidsReelMoyenG', label: 'Poids réel moyen', type: 'nombre', suffixe: 'g', requis: true, pas: 0.1 },
          { nom: 'poidsMinG', label: 'Minimum toléré', type: 'nombre', suffixe: 'g', pas: 0.1 },
          { nom: 'poidsMaxG', label: 'Maximum toléré', type: 'nombre', suffixe: 'g', pas: 0.1 },
          { nom: 'boitesSousPoids', label: 'Boîtes sous-poids', type: 'nombre', requis: true },
          { nom: 'boitesSurPoids', label: 'Boîtes surpoids', type: 'nombre', requis: true },
          { nom: 'rebut', label: 'Rebut', type: 'nombre', suffixe: 'boîtes', requis: true },
          {
            nom: 'quantiteMatiereConsommee',
            label: 'Matière consommée',
            type: 'nombre',
            suffixe: 'kg',
            requis: true,
          },
          { nom: 'nbPersonnel', label: 'Personnel', type: 'nombre', suffixe: 'pers.' },
          { nom: 'operateurId', label: 'Responsable', type: 'select', options: optionsEmployes(db) },
          { nom: 'observations', label: 'Observations', type: 'zone-texte', large: true },
        ]}
        calcules={[
          { label: 'Durée', valeur: (o) => fmtDuree(dureeMinutes(o.heureDebut, o.heureFin)) },
          {
            label: 'Écart de poids moyen',
            valeur: (o) =>
              `${fmt(ecartPoidsMoyen(o.poidsReelMoyenG ?? 0, o.poidsCibleG ?? 0), 2)} g`,
          },
          {
            label: 'Taux de conformité',
            valeur: (o) => {
              const t = tauxConformite(
                o.nombreBoites ?? 0,
                o.boitesSousPoids ?? 0,
                o.boitesSurPoids ?? 0,
                o.rebut ?? 0,
              );
              return t === null ? '—' : `${fmt(t)} %`;
            },
          },
          {
            label: 'Surconsommation',
            valeur: (o) =>
              `${fmt(
                surconsommationKg(o.nombreBoites ?? 0, o.poidsReelMoyenG ?? 0, o.poidsCibleG ?? 0),
              )} kg`,
            aide: 'liée au surpoids',
          },
          {
            label: 'Perte matière',
            valeur: (o) =>
              `${fmt(((o.rebut ?? 0) * (o.poidsReelMoyenG ?? 0)) / 1000)} kg`,
            aide: 'boîtes rebutées',
          },
        ]}
        colonnes={(db) => [
          {
            cle: 'ligne',
            entete: 'Ligne',
            rendu: (o) => <span className="font-medium">{libelleLigne(db, o.lineId)}</span>,
          },
          { cle: 'lot', entete: 'Lot', rendu: (o) => libelleLot(db, o.lotId) },
          { cle: 'produit', entete: 'Produit', rendu: (o) => libelleProduit(db, o.productId), secondaire: true },
          { cle: 'boites', entete: 'Boîtes', rendu: (o) => fmtInt(o.nombreBoites), numerique: true },
          { cle: 'cible', entete: 'Cible (g)', rendu: (o) => fmt(o.poidsCibleG), numerique: true },
          {
            cle: 'reel',
            entete: 'Réel (g)',
            rendu: (o) => <span className="font-medium">{fmt(o.poidsReelMoyenG)}</span>,
            numerique: true,
          },
          {
            cle: 'ecartPoids',
            entete: 'Écart (g)',
            rendu: (o) => {
              const e = ecartPoidsMoyen(o.poidsReelMoyenG, o.poidsCibleG);
              return (
                <span className={Math.abs(e) > 1 ? 'font-medium text-amber-600' : ''}>
                  {e > 0 ? '+' : ''}
                  {fmt(e, 2)}
                </span>
              );
            },
            numerique: true,
          },
          {
            cle: 'sous',
            entete: 'Sous-poids',
            rendu: (o) => fmtInt(o.boitesSousPoids),
            numerique: true,
            secondaire: true,
          },
          {
            cle: 'sur',
            entete: 'Surpoids',
            rendu: (o) => fmtInt(o.boitesSurPoids),
            numerique: true,
            secondaire: true,
          },
          {
            cle: 'conformite',
            entete: 'Conformité',
            rendu: (o) => {
              const t = tauxConformite(o.nombreBoites, o.boitesSousPoids, o.boitesSurPoids, o.rebut);
              return (
                <span
                  className={`font-medium ${
                    t === null ? '' : t >= 98 ? 'text-emerald-700' : t >= 95 ? 'text-amber-700' : 'text-rose-600'
                  }`}
                >
                  {t === null ? '—' : `${fmt(t)} %`}
                </span>
              );
            },
            numerique: true,
          },
          {
            cle: 'surconso',
            entete: 'Surconso. (kg)',
            rendu: (o) => fmt(surconsommationKg(o.nombreBoites, o.poidsReelMoyenG, o.poidsCibleG)),
            numerique: true,
          },
          { cle: 'matiere', entete: 'Matière (kg)', rendu: (o) => fmtInt(o.quantiteMatiereConsommee), numerique: true },
          { cle: 'rebut', entete: 'Rebut', rendu: (o) => fmtInt(o.rebut), numerique: true },
          {
            cle: 'cadence',
            entete: 'Cadence (bt/h)',
            rendu: (o) => {
              const i = indicateursTemps(db, { ...o, lineId: o.lineId });
              return fmtInt(
                i.tempsNetMin ? o.nombreBoites / (i.tempsNetMin / 60) : null,
              );
            },
            numerique: true,
          },
        ]}
        resume={(lignes) => {
          const boites = lignes.reduce((t, o) => t + o.nombreBoites, 0);
          const sous = lignes.reduce((t, o) => t + o.boitesSousPoids, 0);
          const sur = lignes.reduce((t, o) => t + o.boitesSurPoids, 0);
          const rebut = lignes.reduce((t, o) => t + o.rebut, 0);
          const surconso = lignes.reduce(
            (t, o) => t + surconsommationKg(o.nombreBoites, o.poidsReelMoyenG, o.poidsCibleG),
            0,
          );
          const conformite = tauxConformite(boites, sous, sur, rebut);
          return (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              <Kpi libelle="Boîtes remplies" valeur={fmtInt(boites)} />
              <Kpi libelle="Sous-poids" valeur={fmtInt(sous)} ton={sous > 0 ? 'alerte' : 'neutre'} />
              <Kpi libelle="Surpoids" valeur={fmtInt(sur)} ton={sur > 0 ? 'alerte' : 'neutre'} />
              <Kpi
                libelle="Taux de conformité"
                valeur={conformite === null ? '—' : fmt(conformite)}
                unite="%"
                ton={conformite === null ? 'neutre' : conformite >= 98 ? 'bon' : 'alerte'}
              />
              <Kpi
                libelle="Surconsommation"
                valeur={fmt(surconso)}
                unite="kg"
                detail="matière donnée en trop"
                ton={surconso > 0 ? 'alerte' : 'bon'}
              />
            </div>
          );
        }}
      />
      <div className="mt-6">
        <SectionLiquides />
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Liquides (huile / sauce / eau)                                      */
/* ------------------------------------------------------------------ */

function SectionLiquides() {
  const db = useDb();
  const { filtres } = useFiltres();
  const consommations = appliquerFiltres(db.liquidConsumptions, filtres);

  return (
    <Carte titre="Huile / sauce / eau — dosage théorique et consommation réelle">
      <Tableau
        lignes={consommations}
        clef={(c) => c.id}
        messageVide="Aucune consommation de liquide enregistrée."
        colonnes={[
          { cle: 'lot', entete: 'Lot', rendu: (c) => libelleLot(db, c.lotId) },
          { cle: 'type', entete: 'Type', rendu: (c) => <Badge ton="info">{c.typeLiquide}</Badge> },
          { cle: 'ref', entete: 'Référence', rendu: (c) => c.reference ?? '—', secondaire: true },
          { cle: 'boites', entete: 'Boîtes', rendu: (c) => fmtInt(c.nombreBoites), numerique: true },
          {
            cle: 'dosage',
            entete: 'Dosage',
            rendu: (c) => `${fmt(c.dosageTheorique, 0)} ${c.unite}/bt`,
            numerique: true,
          },
          {
            cle: 'theorique',
            entete: `Théorique`,
            rendu: (c) =>
              `${fmt(consommationTheorique(c.nombreBoites, c.dosageTheorique))} ${c.unite === 'ml' ? 'L' : 'kg'}`,
            numerique: true,
          },
          {
            cle: 'reel',
            entete: 'Réel',
            rendu: (c) => (
              <span className="font-medium">
                {fmt(c.quantiteReelle)} {c.unite === 'ml' ? 'L' : 'kg'}
              </span>
            ),
            numerique: true,
          },
          {
            cle: 'ecart',
            entete: 'Écart',
            rendu: (c) => {
              const e = ecartLiquide(c.nombreBoites, c.dosageTheorique, c.quantiteReelle);
              return (
                <span className={e > 0 ? 'font-medium text-rose-600' : 'text-emerald-700'}>
                  {e > 0 ? '+' : ''}
                  {fmt(e)} {c.unite === 'ml' ? 'L' : 'kg'}
                </span>
              );
            },
            numerique: true,
          },
          {
            cle: 'parBoite',
            entete: 'Conso./boîte',
            rendu: (c) =>
              `${fmt(consommationParBoite(c.quantiteReelle, c.nombreBoites))} ${c.unite}`,
            numerique: true,
          },
        ]}
      />
      <p className="mt-3 text-xs text-ardoise-500">
        Consommation théorique = nombre de boîtes × dosage. Un écart positif signale une
        surconsommation à corriger sur la doseuse.
      </p>
    </Carte>
  );
}

/** Écran de saisie des consommations de liquide, accessible depuis les paramètres. */
export function PageLiquides() {
  return (
    <EcranExploitation<LiquidConsumption>
      titre="Consommation de liquides"
      sousTitre="Huile, sauce ou eau ajoutée après remplissage. L’écart entre dosage théorique et consommation réelle est calculé automatiquement."
      table="liquidConsumptions"
      libelleCreation="Nouvelle consommation"
      filtresAffiches={['dateDebut', 'dateFin', 'lotId', 'productId', 'lineId']}
      valeursParDefaut={() => ({
        date: dateDuJour(),
        typeLiquide: 'Huile' as const,
        unite: 'ml' as const,
        nombreBoites: 0,
        dosageTheorique: 25,
        quantiteReelle: 0,
      })}
      champs={(db) => [
        { nom: 'lotId', label: 'Lot', type: 'select', requis: true, options: optionsLots(db) },
        { nom: 'productId', label: 'Produit', type: 'select', options: optionsProduits(db) },
        { nom: 'date', label: 'Date', type: 'date', requis: true },
        { nom: 'lineId', label: 'Ligne', type: 'select', options: optionsLignes(db, 'Remplissage') },
        {
          nom: 'typeLiquide',
          label: 'Type de liquide',
          type: 'select',
          requis: true,
          options: optionsEnum(TYPES_LIQUIDE),
        },
        { nom: 'reference', label: 'Référence', type: 'texte' },
        { nom: 'nombreBoites', label: 'Nombre de boîtes', type: 'nombre', requis: true },
        { nom: 'dosageTheorique', label: 'Dosage théorique / boîte', type: 'nombre', requis: true },
        {
          nom: 'unite',
          label: 'Unité de dosage',
          type: 'select',
          requis: true,
          options: [
            { value: 'ml', label: 'ml (suivi en L)' },
            { value: 'g', label: 'g (suivi en kg)' },
          ],
        },
        { nom: 'quantiteReelle', label: 'Quantité réellement utilisée', type: 'nombre', suffixe: 'L ou kg', requis: true },
        { nom: 'observations', label: 'Observations', type: 'zone-texte', large: true },
      ]}
      calcules={[
        {
          label: 'Consommation théorique',
          valeur: (c) => fmt(consommationTheorique(c.nombreBoites ?? 0, c.dosageTheorique ?? 0)),
        },
        {
          label: 'Écart',
          valeur: (c) =>
            fmt(ecartLiquide(c.nombreBoites ?? 0, c.dosageTheorique ?? 0, c.quantiteReelle ?? 0)),
        },
        {
          label: 'Consommation par boîte',
          valeur: (c) =>
            `${fmt(consommationParBoite(c.quantiteReelle ?? 0, c.nombreBoites ?? 0))} ${c.unite ?? ''}`,
        },
      ]}
      colonnes={(db) => [
        { cle: 'lot', entete: 'Lot', rendu: (c) => libelleLot(db, c.lotId) },
        { cle: 'type', entete: 'Type', rendu: (c) => <Badge ton="info">{c.typeLiquide}</Badge> },
        { cle: 'boites', entete: 'Boîtes', rendu: (c) => fmtInt(c.nombreBoites), numerique: true },
        {
          cle: 'theorique',
          entete: 'Théorique',
          rendu: (c) => fmt(consommationTheorique(c.nombreBoites, c.dosageTheorique)),
          numerique: true,
        },
        { cle: 'reel', entete: 'Réel', rendu: (c) => fmt(c.quantiteReelle), numerique: true },
        {
          cle: 'ecart',
          entete: 'Écart',
          rendu: (c) => {
            const e = ecartLiquide(c.nombreBoites, c.dosageTheorique, c.quantiteReelle);
            return (
              <span className={e > 0 ? 'font-medium text-rose-600' : 'text-emerald-700'}>
                {e > 0 ? '+' : ''}
                {fmt(e)}
              </span>
            );
          },
          numerique: true,
        },
      ]}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Sertissage                                                          */
/* ------------------------------------------------------------------ */

export function PageSertissage() {
  return (
    <EcranExploitation<SertissageOperation>
      titre="Sertissage"
      sousTitre="Fermeture des boîtes. L’écart entre boîtes entrantes et boîtes serties révèle les pertes machine."
      table="sertissageOperations"
      libelleCreation="Nouvelle opération"
      filtresAffiches={['dateDebut', 'dateFin', 'equipe', 'lotId', 'productId', 'machineId']}
      valeursParDefaut={() => ({
        date: dateDuJour(),
        heureDebut: maintenant(),
        boitesAvant: 0,
        boitesApres: 0,
        boitesConformes: 0,
        boitesNonConformes: 0,
        rebut: 0,
      })}
      champs={(db) => [
        {
          nom: 'machineId',
          label: 'Sertisseuse',
          type: 'select',
          requis: true,
          options: optionsMachines(db, 'Sertissage'),
        },
        ...champsOperation<SertissageOperation>(db),
        { nom: 'boitesAvant', label: 'Boîtes avant sertissage', type: 'nombre', requis: true },
        { nom: 'boitesApres', label: 'Boîtes après sertissage', type: 'nombre', requis: true },
        { nom: 'boitesConformes', label: 'Boîtes conformes', type: 'nombre', requis: true },
        { nom: 'boitesNonConformes', label: 'Boîtes non conformes', type: 'nombre', requis: true },
        { nom: 'rebut', label: 'Rebut', type: 'nombre', requis: true },
        { nom: 'operateurId', label: 'Responsable', type: 'select', options: optionsEmployes(db) },
        { nom: 'reglages', label: 'Réglages', type: 'zone-texte', large: true },
        { nom: 'observations', label: 'Observations', type: 'zone-texte', large: true },
      ]}
      calcules={[
        { label: 'Durée', valeur: (o) => fmtDuree(dureeMinutes(o.heureDebut, o.heureFin)) },
        {
          label: 'Perte machine',
          valeur: (o) => `${fmtInt((o.boitesAvant ?? 0) - (o.boitesApres ?? 0))} boîtes`,
        },
        {
          label: 'Taux de conformité',
          valeur: (o) =>
            o.boitesApres
              ? `${fmt(((o.boitesConformes ?? 0) / o.boitesApres) * 100)} %`
              : '—',
        },
      ]}
      colonnes={(db) => [
        {
          cle: 'machine',
          entete: 'Machine',
          rendu: (o) => <span className="font-medium">{libelleMachine(db, o.machineId)}</span>,
        },
        { cle: 'lot', entete: 'Lot', rendu: (o) => libelleLot(db, o.lotId) },
        { cle: 'debut', entete: 'Début', rendu: (o) => heure(o.heureDebut), secondaire: true },
        { cle: 'fin', entete: 'Fin', rendu: (o) => heure(o.heureFin), secondaire: true },
        { cle: 'avant', entete: 'Avant', rendu: (o) => fmtInt(o.boitesAvant), numerique: true },
        {
          cle: 'apres',
          entete: 'Après',
          rendu: (o) => <span className="font-medium">{fmtInt(o.boitesApres)}</span>,
          numerique: true,
        },
        {
          cle: 'perte',
          entete: 'Perte',
          rendu: (o) => {
            const p = o.boitesAvant - o.boitesApres;
            return <span className={p > 0 ? 'text-rose-600' : ''}>{fmtInt(p)}</span>;
          },
          numerique: true,
        },
        { cle: 'conformes', entete: 'Conformes', rendu: (o) => fmtInt(o.boitesConformes), numerique: true },
        {
          cle: 'nc',
          entete: 'Non conformes',
          rendu: (o) => (
            <span className={o.boitesNonConformes > 0 ? 'font-medium text-rose-600' : ''}>
              {fmtInt(o.boitesNonConformes)}
            </span>
          ),
          numerique: true,
        },
        { cle: 'rebut', entete: 'Rebut', rendu: (o) => fmtInt(o.rebut), numerique: true },
        {
          cle: 'arrets',
          entete: 'Arrêts',
          rendu: (o) => {
            const i = indicateursTemps(db, { ...o, machineId: o.machineId });
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
          rendu: (o) => fmtDuree(indicateursTemps(db, { ...o, machineId: o.machineId }).tempsNetMin),
          numerique: true,
        },
        {
          cle: 'cadence',
          entete: 'Cadence (bt/h)',
          rendu: (o) => {
            const i = indicateursTemps(db, { ...o, machineId: o.machineId });
            return fmtInt(i.tempsNetMin ? o.boitesApres / (i.tempsNetMin / 60) : null);
          },
          numerique: true,
        },
      ]}
      resume={(lignes) => {
        const avant = lignes.reduce((t, o) => t + o.boitesAvant, 0);
        const apres = lignes.reduce((t, o) => t + o.boitesApres, 0);
        const nc = lignes.reduce((t, o) => t + o.boitesNonConformes, 0);
        return (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi libelle="Boîtes entrantes" valeur={fmtInt(avant)} />
            <Kpi libelle="Boîtes serties" valeur={fmtInt(apres)} ton="bon" />
            <Kpi
              libelle="Perte machine"
              valeur={fmtInt(avant - apres)}
              ton={avant - apres > 0 ? 'alerte' : 'neutre'}
            />
            <Kpi
              libelle="Non conformes"
              valeur={fmtInt(nc)}
              ton={nc > 0 ? 'critique' : 'bon'}
              detail={apres ? `${fmt((nc / apres) * 100)} % des serties` : undefined}
            />
          </div>
        );
      }}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Marquage                                                            */
/* ------------------------------------------------------------------ */

export function PageMarquage() {
  return (
    <EcranExploitation<MarquageOperation>
      titre="Marquage"
      sousTitre="Codification des boîtes: code de marquage, date de production et date réglementaire selon la spécification produit."
      table="marquageOperations"
      libelleCreation="Nouveau marquage"
      filtresAffiches={['dateDebut', 'dateFin', 'equipe', 'lotId', 'productId', 'machineId']}
      valeursParDefaut={() => ({
        date: dateDuJour(),
        heureDebut: maintenant(),
        dateProduction: dateDuJour(),
        nombreBoites: 0,
        erreursMarquage: 0,
        rebut: 0,
      })}
      champs={(db) => [
        { nom: 'machineId', label: 'Marqueuse', type: 'select', options: optionsMachines(db, 'Marquage') },
        ...champsOperation<MarquageOperation>(db),
        { nom: 'codeMarquage', label: 'Code de marquage', type: 'texte', requis: true },
        { nom: 'dateProduction', label: 'Date de production', type: 'date', requis: true },
        {
          nom: 'dateReglementaire',
          label: 'Date réglementaire (DLC/DDM)',
          type: 'date',
          aide: 'selon spécification produit',
        },
        { nom: 'nombreBoites', label: 'Nombre de boîtes', type: 'nombre', requis: true },
        { nom: 'erreursMarquage', label: 'Erreurs de marquage', type: 'nombre', requis: true },
        { nom: 'rebut', label: 'Rebut', type: 'nombre', requis: true },
        { nom: 'operateurId', label: 'Responsable', type: 'select', options: optionsEmployes(db) },
        { nom: 'observations', label: 'Observations', type: 'zone-texte', large: true },
      ]}
      calcules={[
        { label: 'Durée', valeur: (o) => fmtDuree(dureeMinutes(o.heureDebut, o.heureFin)) },
        {
          label: 'Taux d’erreur',
          valeur: (o) =>
            o.nombreBoites ? `${fmt(((o.erreursMarquage ?? 0) / o.nombreBoites) * 100, 2)} %` : '—',
        },
        {
          label: 'Boîtes conformes',
          valeur: (o) => fmtInt((o.nombreBoites ?? 0) - (o.erreursMarquage ?? 0)),
        },
      ]}
      colonnes={(db) => [
        { cle: 'lot', entete: 'Lot', rendu: (o) => <span className="font-medium">{libelleLot(db, o.lotId)}</span> },
        { cle: 'code', entete: 'Code marquage', rendu: (o) => o.codeMarquage },
        { cle: 'machine', entete: 'Marqueuse', rendu: (o) => libelleMachine(db, o.machineId), secondaire: true },
        { cle: 'production', entete: 'Date production', rendu: (o) => o.dateProduction },
        {
          cle: 'reglementaire',
          entete: 'Date réglementaire',
          rendu: (o) => o.dateReglementaire ?? '—',
        },
        { cle: 'boites', entete: 'Boîtes', rendu: (o) => fmtInt(o.nombreBoites), numerique: true },
        {
          cle: 'erreurs',
          entete: 'Erreurs',
          rendu: (o) => (
            <span className={o.erreursMarquage > 0 ? 'font-medium text-rose-600' : ''}>
              {fmtInt(o.erreursMarquage)}
            </span>
          ),
          numerique: true,
        },
        { cle: 'rebut', entete: 'Rebut', rendu: (o) => fmtInt(o.rebut), numerique: true },
        {
          cle: 'arrets',
          entete: 'Arrêts',
          rendu: (o) => {
            const i = indicateursTemps(db, { ...o, machineId: o.machineId });
            return i.tempsArretMin > 0 ? fmtDuree(i.tempsArretMin) : '—';
          },
          numerique: true,
        },
      ]}
      resume={(lignes) => {
        const boites = lignes.reduce((t, o) => t + o.nombreBoites, 0);
        const erreurs = lignes.reduce((t, o) => t + o.erreursMarquage, 0);
        return (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <Kpi libelle="Boîtes marquées" valeur={fmtInt(boites)} />
            <Kpi
              libelle="Erreurs de marquage"
              valeur={fmtInt(erreurs)}
              ton={erreurs > 0 ? 'alerte' : 'bon'}
            />
            <Kpi
              libelle="Taux d’erreur"
              valeur={boites ? fmt((erreurs / boites) * 100, 2) : '—'}
              unite="%"
            />
          </div>
        );
      }}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Stérilisation                                                       */
/* ------------------------------------------------------------------ */

export function PageSterilisation() {
  return (
    <EcranExploitation<SterilisationCycle>
      titre="Stérilisation"
      sousTitre="Chaque cycle d’autoclave porte un numéro unique, ses paramètres et son résultat."
      table="sterilisationCycles"
      libelleCreation="Nouveau cycle"
      filtresAffiches={['dateDebut', 'dateFin', 'equipe', 'lotId', 'productId', 'machineId']}
      valeursParDefaut={(db) => ({
        numeroCycle: `CYC-${dateDuJour().replace(/-/g, '')}-${String(db.sterilisationCycles.length + 1).padStart(2, '0')}`,
        date: dateDuJour(),
        heureDebut: maintenant(),
        nombreBoites: 0,
        resultat: 'En cours' as const,
        rejets: 0,
      })}
      champs={(db) => [
        { nom: 'numeroCycle', label: 'N° de cycle', type: 'texte', requis: true },
        {
          nom: 'autoclaveId',
          label: 'Autoclave',
          type: 'select',
          requis: true,
          options: optionsMachines(db, 'Stérilisation'),
        },
        ...champsOperation<SterilisationCycle>(db),
        { nom: 'nombreBoites', label: 'Nombre de boîtes', type: 'nombre', requis: true },
        { nom: 'temperature', label: 'Température', type: 'nombre', suffixe: '°C', pas: 0.1 },
        { nom: 'pression', label: 'Pression', type: 'nombre', suffixe: 'bar', pas: 0.1 },
        { nom: 'valeurSterilisatrice', label: 'Valeur stérilisatrice F0', type: 'nombre', suffixe: 'min', pas: 0.1 },
        {
          nom: 'resultat',
          label: 'Résultat',
          type: 'select',
          requis: true,
          options: optionsEnum(['Conforme', 'Non conforme', 'En cours'] as const),
        },
        { nom: 'rejets', label: 'Rejets', type: 'nombre', requis: true },
        { nom: 'nonConformites', label: 'Non-conformités', type: 'zone-texte', large: true },
        { nom: 'operateurId', label: 'Responsable', type: 'select', options: optionsEmployes(db) },
      ]}
      calcules={[
        { label: 'Durée du cycle', valeur: (c) => fmtDuree(dureeMinutes(c.heureDebut, c.heureFin)) },
        {
          label: 'Boîtes conformes',
          valeur: (c) => fmtInt((c.nombreBoites ?? 0) - (c.rejets ?? 0)),
        },
        {
          label: 'Taux de rejet',
          valeur: (c) => (c.nombreBoites ? `${fmt(((c.rejets ?? 0) / c.nombreBoites) * 100, 2)} %` : '—'),
        },
      ]}
      colonnes={(db) => [
        { cle: 'cycle', entete: 'N° cycle', rendu: (c) => <span className="font-medium">{c.numeroCycle}</span> },
        { cle: 'autoclave', entete: 'Autoclave', rendu: (c) => libelleMachine(db, c.autoclaveId) },
        { cle: 'lot', entete: 'Lot', rendu: (c) => libelleLot(db, c.lotId) },
        { cle: 'boites', entete: 'Boîtes', rendu: (c) => fmtInt(c.nombreBoites), numerique: true },
        { cle: 'debut', entete: 'Début', rendu: (c) => heure(c.heureDebut) },
        { cle: 'fin', entete: 'Fin', rendu: (c) => heure(c.heureFin) },
        {
          cle: 'duree',
          entete: 'Durée',
          rendu: (c) => fmtDuree(dureeMinutes(c.heureDebut, c.heureFin)),
          numerique: true,
        },
        {
          cle: 'params',
          entete: 'Paramètres',
          rendu: (c) =>
            `${c.temperature ?? '—'} °C / ${c.pression ?? '—'} bar / F0 ${c.valeurSterilisatrice ?? '—'}`,
          secondaire: true,
        },
        {
          cle: 'resultat',
          entete: 'Résultat',
          rendu: (c) => (
            <Badge
              ton={
                c.resultat === 'Conforme' ? 'bon' : c.resultat === 'Non conforme' ? 'critique' : 'neutre'
              }
            >
              {c.resultat}
            </Badge>
          ),
        },
        {
          cle: 'rejets',
          entete: 'Rejets',
          rendu: (c) => (
            <span className={c.rejets > 0 ? 'text-rose-600' : ''}>{fmtInt(c.rejets)}</span>
          ),
          numerique: true,
        },
      ]}
      resume={(lignes) => {
        const boites = lignes.reduce((t, c) => t + c.nombreBoites, 0);
        const rejets = lignes.reduce((t, c) => t + c.rejets, 0);
        const nc = lignes.filter((c) => c.resultat === 'Non conforme').length;
        return (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi libelle="Cycles" valeur={fmtInt(lignes.length)} />
            <Kpi libelle="Boîtes stérilisées" valeur={fmtInt(boites - rejets)} ton="bon" />
            <Kpi libelle="Rejets" valeur={fmtInt(rejets)} ton={rejets > 0 ? 'alerte' : 'neutre'} />
            <Kpi
              libelle="Cycles non conformes"
              valeur={fmtInt(nc)}
              ton={nc > 0 ? 'critique' : 'bon'}
            />
          </div>
        );
      }}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Emballage                                                           */
/* ------------------------------------------------------------------ */

export function PageEmballage() {
  return (
    <EcranExploitation<PackagingOperation>
      titre="Emballage & produit fini"
      sousTitre="Dernière étape: mise en cartons et en palettes. Le nombre de cartons et de palettes découle du nombre de boîtes."
      table="packagingOperations"
      libelleCreation="Nouvel emballage"
      filtresAffiches={['dateDebut', 'dateFin', 'equipe', 'lotId', 'productId', 'lineId']}
      valeursParDefaut={() => ({
        date: dateDuJour(),
        heureDebut: maintenant(),
        nombreBoites: 0,
        boitesParCarton: 50,
        cartonsParPalette: 60,
        nombreCartons: 0,
        nombrePalettes: 0,
        rebut: 0,
      })}
      avantEnregistrement={(o) => {
        // Cartons et palettes se déduisent du nombre de boîtes: jamais saisis.
        const cartons = o.boitesParCarton
          ? Math.floor((o.nombreBoites ?? 0) / o.boitesParCarton)
          : 0;
        return {
          ...o,
          nombreCartons: cartons,
          nombrePalettes: o.cartonsParPalette ? Math.ceil(cartons / o.cartonsParPalette) : 0,
        };
      }}
      champs={(db) => [
        { nom: 'lineId', label: 'Ligne d’emballage', type: 'select', options: optionsLignes(db, 'Emballage') },
        ...champsOperation<PackagingOperation>(db),
        { nom: 'nombreBoites', label: 'Nombre de boîtes', type: 'nombre', requis: true },
        { nom: 'boitesParCarton', label: 'Boîtes / carton', type: 'nombre', requis: true },
        { nom: 'cartonsParPalette', label: 'Cartons / palette', type: 'nombre', requis: true },
        { nom: 'rebut', label: 'Rebut', type: 'nombre', requis: true },
        { nom: 'nbPersonnel', label: 'Personnel', type: 'nombre', suffixe: 'pers.' },
        { nom: 'operateurId', label: 'Responsable', type: 'select', options: optionsEmployes(db) },
        { nom: 'observations', label: 'Observations', type: 'zone-texte', large: true },
      ]}
      calcules={[
        { label: 'Durée', valeur: (o) => fmtDuree(dureeMinutes(o.heureDebut, o.heureFin)) },
        {
          label: 'Cartons',
          valeur: (o) =>
            o.boitesParCarton
              ? fmtInt(Math.floor((o.nombreBoites ?? 0) / o.boitesParCarton))
              : '—',
        },
        {
          label: 'Palettes',
          valeur: (o) =>
            o.boitesParCarton && o.cartonsParPalette
              ? fmtInt(
                  Math.ceil(
                    Math.floor((o.nombreBoites ?? 0) / o.boitesParCarton) / o.cartonsParPalette,
                  ),
                )
              : '—',
        },
        {
          label: 'Boîtes hors carton',
          valeur: (o) =>
            o.boitesParCarton ? fmtInt((o.nombreBoites ?? 0) % o.boitesParCarton) : '—',
          aide: 'reste non palettisé',
        },
      ]}
      colonnes={(db) => [
        { cle: 'lot', entete: 'Lot', rendu: (o) => <span className="font-medium">{libelleLot(db, o.lotId)}</span> },
        { cle: 'produit', entete: 'Produit', rendu: (o) => libelleProduit(db, o.productId), secondaire: true },
        { cle: 'boites', entete: 'Boîtes', rendu: (o) => fmtInt(o.nombreBoites), numerique: true },
        { cle: 'parCarton', entete: 'Bt/carton', rendu: (o) => fmtInt(o.boitesParCarton), numerique: true, secondaire: true },
        { cle: 'cartons', entete: 'Cartons', rendu: (o) => fmtInt(o.nombreCartons), numerique: true },
        { cle: 'palettes', entete: 'Palettes', rendu: (o) => fmtInt(o.nombrePalettes), numerique: true },
        { cle: 'rebut', entete: 'Rebut', rendu: (o) => fmtInt(o.rebut), numerique: true },
        {
          cle: 'reste',
          entete: 'Hors carton',
          rendu: (o) => {
            const reste = o.boitesParCarton ? o.nombreBoites % o.boitesParCarton : 0;
            return (
              <span className={reste > 0 ? 'text-amber-600' : 'text-ardoise-400'}>
                {fmtInt(reste)}
              </span>
            );
          },
          numerique: true,
        },
        { cle: 'fin', entete: 'Fin', rendu: (o) => heure(o.heureFin), secondaire: true },
      ]}
      resume={(lignes) => (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi
            libelle="Boîtes emballées"
            valeur={fmtInt(lignes.reduce((t, o) => t + o.nombreBoites, 0))}
            ton="bon"
          />
          <Kpi libelle="Cartons" valeur={fmtInt(lignes.reduce((t, o) => t + o.nombreCartons, 0))} />
          <Kpi libelle="Palettes" valeur={fmtInt(lignes.reduce((t, o) => t + o.nombrePalettes, 0))} />
          <Kpi
            libelle="Rebut"
            valeur={fmtInt(lignes.reduce((t, o) => t + o.rebut, 0))}
            ton="alerte"
          />
        </div>
      )}
    />
  );
}
