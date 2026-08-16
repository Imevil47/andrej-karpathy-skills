/** Écran — Arrêts (section 16). Module indépendant: chaque arrêt est un événement. */

import { dureeMinutes, fmt, fmtDuree, fmtInt } from '../domain/calculations';
import {
  CATEGORIES_ARRET,
  CATEGORIE_PAR_MOTIF,
  MOTIFS_ARRET,
  ZONES,
  type MotifArret,
  type Stop,
} from '../domain/types';
import { EcranExploitation } from '../ui/crud';
import {
  dateDuJour,
  heure,
  libelleLigne,
  libelleLot,
  libelleMachine,
  maintenant,
  optionsEnum,
  optionsLots,
  optionsProduits,
} from '../ui/options';
import { Badge, Carte, Kpi, Tableau } from '../ui/primitives';

export function PageArrets() {
  return (
    <EcranExploitation<Stop>
      titre="Arrêts"
      sousTitre="Tout arrêt de ligne ou de machine est enregistré comme un événement daté et motivé. Temps net = temps planifié − temps d’arrêt."
      table="stops"
      libelleCreation="Déclarer un arrêt"
      filtresAffiches={['dateDebut', 'dateFin', 'lotId', 'productId', 'lineId', 'machineId', 'zone']}
      valeursParDefaut={() => ({
        date: dateDuJour(),
        heureDebut: maintenant(),
        zone: 'Traitement' as const,
        motif: 'Panne machine' as const,
        categorie: CATEGORIE_PAR_MOTIF['Panne machine'],
      })}
      avantEnregistrement={(s) => ({
        ...s,
        // La catégorie découle du motif standard tant qu'elle n'est pas forcée.
        categorie: s.categorie ?? (s.motif ? CATEGORIE_PAR_MOTIF[s.motif] : undefined),
      })}
      champs={(db) => [
        { nom: 'zone', label: 'Zone', type: 'select', requis: true, options: optionsEnum(ZONES) },
        {
          nom: 'lineId',
          label: 'Ligne',
          type: 'select',
          options: db.lines.map((l) => ({ value: l.id, label: `${l.nom} (${l.zone})` })),
        },
        {
          nom: 'machineId',
          label: 'Machine',
          type: 'select',
          options: db.machines.map((m) => ({ value: m.id, label: `${m.nom} (${m.zone})` })),
        },
        { nom: 'lotId', label: 'Lot', type: 'select', options: optionsLots(db) },
        { nom: 'productId', label: 'Produit', type: 'select', options: optionsProduits(db) },
        { nom: 'date', label: 'Date', type: 'date', requis: true },
        { nom: 'heureDebut', label: 'Heure début', type: 'datetime', requis: true },
        { nom: 'heureFin', label: 'Heure fin', type: 'datetime' },
        { nom: 'motif', label: 'Motif', type: 'select', requis: true, options: optionsEnum(MOTIFS_ARRET) },
        {
          nom: 'categorie',
          label: 'Catégorie',
          type: 'select',
          options: optionsEnum(CATEGORIES_ARRET),
          aide: 'déduite du motif si vide',
        },
        { nom: 'commentaire', label: 'Commentaire', type: 'zone-texte', large: true },
        { nom: 'actionCorrective', label: 'Action corrective', type: 'zone-texte', large: true },
      ]}
      calcules={[
        { label: 'Durée de l’arrêt', valeur: (s) => fmtDuree(dureeMinutes(s.heureDebut, s.heureFin)) },
        {
          label: 'Catégorie déduite',
          valeur: (s) => (s.motif ? CATEGORIE_PAR_MOTIF[s.motif as MotifArret] : '—'),
        },
        {
          label: 'État',
          valeur: (s) => (s.heureFin ? 'Clôturé' : 'En cours'),
        },
      ]}
      colonnes={(db) => [
        { cle: 'zone', entete: 'Zone', rendu: (s) => s.zone },
        {
          cle: 'ressource',
          entete: 'Ligne / machine',
          rendu: (s) => (
            <span className="font-medium">
              {s.machineId
                ? libelleMachine(db, s.machineId)
                : s.lineId
                  ? libelleLigne(db, s.lineId)
                  : '—'}
            </span>
          ),
        },
        { cle: 'lot', entete: 'Lot', rendu: (s) => (s.lotId ? libelleLot(db, s.lotId) : '—'), secondaire: true },
        { cle: 'debut', entete: 'Début', rendu: (s) => heure(s.heureDebut) },
        {
          cle: 'fin',
          entete: 'Fin',
          rendu: (s) =>
            s.heureFin ? heure(s.heureFin) : <Badge ton="critique">en cours</Badge>,
        },
        {
          cle: 'duree',
          entete: 'Durée',
          rendu: (s) => {
            const d = dureeMinutes(s.heureDebut, s.heureFin);
            return (
              <span className={`font-medium ${(d ?? 0) >= 30 ? 'text-rose-600' : ''}`}>
                {fmtDuree(d)}
              </span>
            );
          },
          numerique: true,
        },
        { cle: 'motif', entete: 'Motif', rendu: (s) => s.motif },
        {
          cle: 'categorie',
          entete: 'Catégorie',
          rendu: (s) => (
            <Badge
              ton={
                s.categorie === 'Technique'
                  ? 'critique'
                  : s.categorie === 'Qualité'
                    ? 'alerte'
                    : s.categorie === 'Planifié'
                      ? 'bon'
                      : 'info'
              }
            >
              {s.categorie}
            </Badge>
          ),
        },
        { cle: 'commentaire', entete: 'Commentaire', rendu: (s) => s.commentaire ?? '—', secondaire: true },
        {
          cle: 'action',
          entete: 'Action corrective',
          rendu: (s) => s.actionCorrective ?? '—',
          secondaire: true,
        },
      ]}
      resume={(lignes) => {
        const total = lignes.reduce((t, s) => t + (dureeMinutes(s.heureDebut, s.heureFin) ?? 0), 0);
        const enCours = lignes.filter((s) => !s.heureFin).length;
        return (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi libelle="Nombre d’arrêts" valeur={fmtInt(lignes.length)} />
            <Kpi libelle="Temps d’arrêt total" valeur={fmtDuree(total)} ton="critique" />
            <Kpi
              libelle="Durée moyenne"
              valeur={fmtDuree(lignes.length ? total / lignes.length : null)}
            />
            <Kpi
              libelle="Arrêts en cours"
              valeur={fmtInt(enCours)}
              ton={enCours > 0 ? 'critique' : 'bon'}
            />
          </div>
        );
      }}
      complement={(lignes) => <AnalyseArrets lignes={lignes} />}
    />
  );
}

/** Répartition des arrêts par motif et par catégorie. */
function AnalyseArrets({ lignes }: { lignes: Stop[] }) {
  const total = lignes.reduce((t, s) => t + (dureeMinutes(s.heureDebut, s.heureFin) ?? 0), 0);

  const parMotif = [...MOTIFS_ARRET]
    .map((motif) => {
      const arrets = lignes.filter((s) => s.motif === motif);
      return {
        motif,
        nombre: arrets.length,
        minutes: arrets.reduce((t, s) => t + (dureeMinutes(s.heureDebut, s.heureFin) ?? 0), 0),
      };
    })
    .filter((m) => m.nombre > 0)
    .sort((a, b) => b.minutes - a.minutes);

  return (
    <Carte titre="Causes d’arrêt — classement par temps perdu">
      <Tableau
        lignes={parMotif}
        clef={(m) => m.motif}
        messageVide="Aucun arrêt sur la période."
        colonnes={[
          { cle: 'motif', entete: 'Motif', rendu: (m) => <span className="font-medium">{m.motif}</span> },
          {
            cle: 'categorie',
            entete: 'Catégorie',
            rendu: (m) => <Badge>{CATEGORIE_PAR_MOTIF[m.motif]}</Badge>,
          },
          { cle: 'nombre', entete: 'Occurrences', rendu: (m) => fmtInt(m.nombre), numerique: true },
          { cle: 'temps', entete: 'Temps perdu', rendu: (m) => fmtDuree(m.minutes), numerique: true },
          {
            cle: 'part',
            entete: 'Part',
            rendu: (m) => (
              <div className="flex items-center justify-end gap-2">
                <span className="tabulaire">{total ? fmt((m.minutes / total) * 100) : '—'} %</span>
                <span className="hidden h-2 w-20 overflow-hidden rounded bg-ardoise-100 sm:block">
                  <span
                    className="block h-full rounded bg-rose-400"
                    style={{ width: `${total ? (m.minutes / total) * 100 : 0}%` }}
                  />
                </span>
              </div>
            ),
            numerique: true,
          },
        ]}
      />
    </Carte>
  );
}
