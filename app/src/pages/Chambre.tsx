/** Écrans — Chambre positive (entrées) et Sortie matière (section 4). */

import { fmtInt } from '../domain/calculations';
import { appliquerFiltres, stockDisponible } from '../domain/selectors';
import { DESTINATIONS, type Database, type StockMovement } from '../domain/types';
import { EcranExploitation } from '../ui/crud';
import type { Champ } from '../ui/forms';
import {
  dateDuJour,
  heure,
  libelleLot,
  maintenant,
  optionsEmployes,
  optionsEnum,
  optionsLots,
  optionsProduits,
} from '../ui/options';
import { Badge, Kpi } from '../ui/primitives';

const champsCommuns = (db: Database): Champ<StockMovement>[] => [
  { nom: 'lotId', label: 'Lot', type: 'select', requis: true, options: optionsLots(db) },
  { nom: 'productId', label: 'Produit', type: 'select', options: optionsProduits(db) },
  { nom: 'espece', label: 'Espèce', type: 'texte', requis: true },
  { nom: 'chambre', label: 'Chambre', type: 'texte', requis: true },
  { nom: 'quantite', label: 'Quantité', type: 'nombre', suffixe: 'kg', requis: true },
  { nom: 'date', label: 'Date', type: 'date', requis: true },
  { nom: 'heure', label: 'Heure', type: 'datetime', requis: true },
  { nom: 'operateurId', label: 'Opérateur', type: 'select', options: optionsEmployes(db) },
  { nom: 'observations', label: 'Observations', type: 'zone-texte', large: true },
];

const colonnesCommunes = (db: Database) => [
  { cle: 'heure', entete: 'Heure', rendu: (m: StockMovement) => heure(m.heure) },
  {
    cle: 'lot',
    entete: 'Lot',
    rendu: (m: StockMovement) => <span className="font-medium">{libelleLot(db, m.lotId)}</span>,
  },
  { cle: 'espece', entete: 'Espèce', rendu: (m: StockMovement) => m.espece },
  { cle: 'chambre', entete: 'Chambre', rendu: (m: StockMovement) => m.chambre },
  {
    cle: 'quantite',
    entete: 'Quantité (kg)',
    rendu: (m: StockMovement) => fmtInt(m.quantite),
    numerique: true,
  },
];

export function PageChambre() {
  return (
    <EcranExploitation<StockMovement>
      titre="Chambre positive — entrées"
      sousTitre="Entrée de la matière réceptionnée en chambre positive. Le stock d’un lot est la différence entre ses entrées et ses sorties."
      table="stockMovements"
      libelleCreation="Entrée matière"
      filtresAffiches={['dateDebut', 'dateFin', 'lotId', 'espece', 'productId']}
      filtrer={(lignes, filtres) =>
        appliquerFiltres(lignes, filtres).filter((m) => m.sens === 'ENTREE')
      }
      valeursParDefaut={() => ({
        sens: 'ENTREE' as const,
        date: dateDuJour(),
        heure: maintenant(),
        chambre: 'CP-1',
        quantite: 0,
      })}
      champs={(db) => [
        ...champsCommuns(db),
        { nom: 'reference', label: 'Origine (n° réception)', type: 'texte' },
      ]}
      colonnes={(db) => [
        ...colonnesCommunes(db),
        {
          cle: 'origine',
          entete: 'Origine',
          rendu: (m) => m.reference ?? '—',
          secondaire: true,
        },
        {
          cle: 'stock',
          entete: 'Stock du lot (kg)',
          rendu: (m) => fmtInt(stockDisponible(db, m.lotId)),
          numerique: true,
        },
      ]}
      resume={(lignes) => (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <Kpi libelle="Entrées" valeur={fmtInt(lignes.length)} detail="mouvements" />
          <Kpi
            libelle="Quantité entrée"
            valeur={fmtInt(lignes.reduce((t, m) => t + m.quantite, 0))}
            unite="kg"
          />
          <Kpi
            libelle="Lots concernés"
            valeur={fmtInt(new Set(lignes.map((m) => m.lotId)).size)}
          />
        </div>
      )}
    />
  );
}

export function PageSortieMatiere() {
  return (
    <EcranExploitation<StockMovement>
      titre="Sortie matière"
      sousTitre="Sortie de la chambre positive vers la zone de traitement ou la zone filet. Aucune sortie ne doit dépasser le stock disponible du lot."
      table="stockMovements"
      libelleCreation="Sortie matière"
      filtresAffiches={['dateDebut', 'dateFin', 'lotId', 'espece', 'destination']}
      filtrer={(lignes, filtres) =>
        appliquerFiltres(lignes, filtres).filter((m) => m.sens === 'SORTIE')
      }
      valeursParDefaut={() => ({
        sens: 'SORTIE' as const,
        date: dateDuJour(),
        heure: maintenant(),
        chambre: 'CP-1',
        quantite: 0,
      })}
      champs={(db) => [
        ...champsCommuns(db),
        {
          nom: 'destination',
          label: 'Destination',
          type: 'select',
          requis: true,
          options: optionsEnum(DESTINATIONS),
        },
        { nom: 'reference', label: 'Ligne / machine destinataire', type: 'texte' },
      ]}
      colonnes={(db) => [
        ...colonnesCommunes(db),
        {
          cle: 'destination',
          entete: 'Destination',
          rendu: (m) => (m.destination ? <Badge ton="info">{m.destination}</Badge> : '—'),
        },
        {
          cle: 'reste',
          entete: 'Reste en chambre (kg)',
          rendu: (m) => {
            const reste = stockDisponible(db, m.lotId);
            return (
              <span className={reste < 0 ? 'font-semibold text-rose-600' : ''}>
                {fmtInt(reste)}
              </span>
            );
          },
          numerique: true,
        },
      ]}
      resume={(lignes, db) => {
        const sorti = lignes.reduce((t, m) => t + m.quantite, 0);
        const lotsNegatifs = [...new Set(lignes.map((m) => m.lotId))].filter(
          (lotId) => stockDisponible(db, lotId) < 0,
        ).length;
        return (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <Kpi libelle="Sorties" valeur={fmtInt(lignes.length)} detail="mouvements" />
            <Kpi libelle="Quantité sortie" valeur={fmtInt(sorti)} unite="kg" />
            <Kpi
              libelle="Lots en stock négatif"
              valeur={fmtInt(lotsNegatifs)}
              ton={lotsNegatifs > 0 ? 'critique' : 'bon'}
              detail={lotsNegatifs > 0 ? 'sortie supérieure au stock' : 'aucun dépassement'}
            />
          </div>
        );
      }}
    />
  );
}
