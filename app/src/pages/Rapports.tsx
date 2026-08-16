/** Écran — Rapports: anomalies de cohérence, synthèses et export. */

import { fmt, fmtDuree, fmtInt } from '../domain/calculations';
import { controlerCoherence } from '../domain/coherence';
import {
  bilanLot,
  kpisDashboard,
  performanceOperatrices,
  performanceParLigne,
} from '../domain/selectors';
import { BarreFiltres } from '../ui/filtres';
import { libelleProduit } from '../ui/options';
import { Badge, Bouton, Carte, Kpi, PageHeader, Tableau } from '../ui/primitives';
import { useDb, useFiltres } from '../ui/state';

/** Convertit un tableau d'objets en CSV téléchargeable. */
function versCsv(lignes: Record<string, unknown>[]): string {
  if (lignes.length === 0) return '';
  const colonnes = Object.keys(lignes[0]);
  const echapper = (v: unknown) => {
    const texte = v === null || v === undefined ? '' : String(v);
    return /[";\n]/.test(texte) ? `"${texte.replace(/"/g, '""')}"` : texte;
  };
  return [
    colonnes.join(';'),
    ...lignes.map((l) => colonnes.map((c) => echapper(l[c])).join(';')),
  ].join('\n');
}

function telecharger(nom: string, contenu: string) {
  const lien = document.createElement('a');
  lien.href = URL.createObjectURL(new Blob([`﻿${contenu}`], { type: 'text/csv;charset=utf-8' }));
  lien.download = nom;
  lien.click();
  URL.revokeObjectURL(lien.href);
}

export function PageRapports() {
  const db = useDb();
  const { filtres } = useFiltres();
  const anomalies = controlerCoherence(db);
  const k = kpisDashboard(db, filtres);
  const lignes = performanceParLigne(db, filtres);
  const operatrices = performanceOperatrices(db, filtres);

  const bilans = db.lots.map((lot) => ({ lot, bilan: bilanLot(db, lot.id) }));

  const exporterSynthese = () =>
    telecharger(
      `synthese-lots-${new Date().toISOString().slice(0, 10)}.csv`,
      versCsv(
        bilans.map(({ lot, bilan }) => ({
          Lot: lot.code,
          Date: lot.date,
          Espèce: lot.espece,
          Produit: libelleProduit(db, lot.productId),
          Statut: lot.statut,
          'Reçu (kg)': bilan.recuKg,
          'Entré chambre (kg)': bilan.entreeChambreKg,
          'Sorti chambre (kg)': bilan.sortieChambreKg,
          'Stock chambre (kg)': bilan.stockChambreKg,
          'Traité entrée (kg)': bilan.traiteEntreeKg,
          'Traité sortie (kg)': bilan.traiteSortieKg,
          'Pertes déclarées (kg)': bilan.pertesDeclareesKg,
          'Rendement (%)': bilan.rendementGlobalPct?.toFixed(1) ?? '',
          'Écart matière (kg)': bilan.ecartMatiereKg.toFixed(1),
          'Boîtes remplies': bilan.boitesRemplies,
          'Boîtes serties': bilan.boitesSerties,
          'Boîtes emballées': bilan.boitesEmballees,
          Cartons: bilan.cartons,
          Palettes: bilan.palettes,
        })),
      ),
    );

  const exporterArrets = () =>
    telecharger(
      `arrets-${new Date().toISOString().slice(0, 10)}.csv`,
      versCsv(
        db.stops.map((s) => ({
          Zone: s.zone,
          Ligne: db.lines.find((l) => l.id === s.lineId)?.nom ?? '',
          Machine: db.machines.find((m) => m.id === s.machineId)?.nom ?? '',
          Lot: db.lots.find((l) => l.id === s.lotId)?.code ?? '',
          Date: s.date,
          Début: s.heureDebut,
          Fin: s.heureFin ?? '',
          Motif: s.motif,
          Catégorie: s.categorie,
          Commentaire: s.commentaire ?? '',
          'Action corrective': s.actionCorrective ?? '',
        })),
      ),
    );

  return (
    <>
      <PageHeader
        titre="Rapports"
        sousTitre="Contrôles de cohérence, synthèse par lot et export des données d’exploitation."
        actions={
          <>
            <Bouton onClick={exporterSynthese}>Exporter la synthèse (CSV)</Bouton>
            <Bouton onClick={exporterArrets}>Exporter les arrêts (CSV)</Bouton>
            <Bouton onClick={() => window.print()}>Imprimer</Bouton>
          </>
        }
      />
      <BarreFiltres />

      <Carte titre="Contrôle de cohérence des données" className="mb-4">
        {anomalies.length === 0 ? (
          <p className="py-6 text-center text-sm text-emerald-700">
            Aucune anomalie: entrées, sorties, pertes, stocks et horaires sont cohérents.
          </p>
        ) : (
          <Tableau
            lignes={anomalies}
            clef={(a) => a.id}
            colonnes={[
              {
                cle: 'severite',
                entete: 'Sévérité',
                rendu: (a) => (
                  <Badge ton={a.severite === 'critique' ? 'critique' : 'alerte'}>
                    {a.severite}
                  </Badge>
                ),
              },
              { cle: 'regle', entete: 'Règle', rendu: (a) => <span className="font-medium">{a.regle}</span> },
              { cle: 'zone', entete: 'Zone', rendu: (a) => a.zone ?? '—' },
              { cle: 'lot', entete: 'Lot', rendu: (a) => a.lotCode ?? '—' },
              { cle: 'message', entete: 'Détail', rendu: (a) => a.message },
              {
                cle: 'ecart',
                entete: 'Écart',
                rendu: (a) => (a.ecart === undefined ? '—' : fmt(a.ecart)),
                numerique: true,
              },
            ]}
          />
        )}
      </Carte>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi libelle="Boîtes produites" valeur={fmtInt(k.boitesProduites)} />
        <Kpi libelle="Cadence" valeur={fmtInt(k.cadenceBoitesH)} unite="bt/h" />
        <Kpi
          libelle="Rendement"
          valeur={k.rendementMatierePct === null ? '—' : fmt(k.rendementMatierePct)}
          unite="%"
        />
        <Kpi libelle="Temps d’arrêt" valeur={fmtDuree(k.tempsArretMin)} ton="critique" />
        <Kpi libelle="Pertes matière" valeur={fmtInt(k.pertesKg)} unite="kg" ton="alerte" />
      </div>

      <Carte titre="Synthèse par lot" className="mb-4">
        <Tableau
          lignes={bilans}
          clef={({ lot }) => lot.id}
          messageVide="Aucun lot enregistré."
          colonnes={[
            { cle: 'lot', entete: 'Lot', rendu: ({ lot }) => <span className="font-medium">{lot.code}</span> },
            { cle: 'espece', entete: 'Espèce', rendu: ({ lot }) => lot.espece },
            {
              cle: 'produit',
              entete: 'Produit',
              rendu: ({ lot }) => libelleProduit(db, lot.productId),
              secondaire: true,
            },
            {
              cle: 'statut',
              entete: 'Statut',
              rendu: ({ lot }) => (
                <Badge ton={lot.statut === 'Clôturé' ? 'bon' : 'info'}>{lot.statut}</Badge>
              ),
            },
            { cle: 'recu', entete: 'Reçu (kg)', rendu: ({ bilan }) => fmtInt(bilan.recuKg), numerique: true },
            {
              cle: 'sorti',
              entete: 'Sorti chambre (kg)',
              rendu: ({ bilan }) => fmtInt(bilan.sortieChambreKg),
              numerique: true,
            },
            {
              cle: 'stock',
              entete: 'Stock (kg)',
              rendu: ({ bilan }) => fmtInt(bilan.stockChambreKg),
              numerique: true,
            },
            {
              cle: 'pertes',
              entete: 'Pertes (kg)',
              rendu: ({ bilan }) => fmtInt(bilan.pertesDeclareesKg),
              numerique: true,
            },
            {
              cle: 'rendement',
              entete: 'Rendement',
              rendu: ({ bilan }) =>
                bilan.rendementGlobalPct === null ? '—' : `${fmt(bilan.rendementGlobalPct)} %`,
              numerique: true,
            },
            {
              cle: 'ecart',
              entete: 'Écart (kg)',
              rendu: ({ bilan }) => (
                <span
                  className={
                    Math.abs(bilan.ecartMatiereKg) > 10 ? 'font-medium text-rose-600' : ''
                  }
                >
                  {fmtInt(bilan.ecartMatiereKg)}
                </span>
              ),
              numerique: true,
            },
            {
              cle: 'boites',
              entete: 'Boîtes finies',
              rendu: ({ bilan }) => fmtInt(bilan.boitesEmballees),
              numerique: true,
            },
            {
              cle: 'palettes',
              entete: 'Palettes',
              rendu: ({ bilan }) => fmtInt(bilan.palettes),
              numerique: true,
              secondaire: true,
            },
          ]}
        />
      </Carte>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Carte titre="Performance par ligne">
          <Tableau
            lignes={lignes}
            clef={(l) => l.nom}
            messageVide="Aucune activité."
            colonnes={[
              { cle: 'nom', entete: 'Ligne', rendu: (l) => l.nom },
              { cle: 'prod', entete: 'Production', rendu: (l) => fmtInt(l.production), numerique: true },
              {
                cle: 'rendement',
                entete: 'Rendement',
                rendu: (l) => (l.rendementPct === null ? '—' : `${fmt(l.rendementPct)} %`),
                numerique: true,
              },
              { cle: 'cadence', entete: 'Cadence', rendu: (l) => fmtInt(l.cadence), numerique: true },
              {
                cle: 'arrets',
                entete: 'Arrêts',
                rendu: (l) => fmtDuree(l.tempsArretMin),
                numerique: true,
              },
            ]}
          />
        </Carte>

        <Carte titre="Production par opératrice">
          <Tableau
            lignes={operatrices}
            clef={(p) => `${p.matricule}-${p.ligne}`}
            messageVide="Aucune production individuelle."
            colonnes={[
              { cle: 'matricule', entete: 'Matricule', rendu: (p) => p.matricule },
              { cle: 'nom', entete: 'Nom', rendu: (p) => p.nom },
              { cle: 'ligne', entete: 'Ligne', rendu: (p) => p.ligne, secondaire: true },
              { cle: 'boites', entete: 'Boîtes', rendu: (p) => fmtInt(p.boites), numerique: true },
              {
                cle: 'cadence',
                entete: 'Cadence (bt/h)',
                rendu: (p) => <span className="font-medium">{fmtInt(p.cadenceBoitesH)}</span>,
                numerique: true,
              },
            ]}
          />
        </Carte>
      </div>
    </>
  );
}
