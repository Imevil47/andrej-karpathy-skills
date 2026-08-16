/**
 * Écran — Traçabilité (section 19).
 *
 * Le Lot ID accompagne la matière du camion à la palette. Cet écran restitue
 * le parcours dans les deux sens et le bilan matière associé.
 */

import { useState } from 'react';
import { fmt, fmtInt } from '../domain/calculations';
import { bilanLot, traceLot } from '../domain/selectors';
import { heure, libelleProduit } from '../ui/options';
import { Badge, Bouton, Carte, Kpi, PageHeader, Vide } from '../ui/primitives';
import { useDb } from '../ui/state';

export function PageTracabilite() {
  const db = useDb();
  const [lotId, setLotId] = useState<string>(db.lots[0]?.id ?? '');
  const [sens, setSens] = useState<'amont' | 'aval'>('aval');

  const lot = db.lots.find((l) => l.id === lotId);
  const etapes = lotId ? traceLot(db, lotId) : [];
  const parcours = sens === 'aval' ? etapes : [...etapes].reverse();
  const bilan = lotId ? bilanLot(db, lotId) : null;

  return (
    <>
      <PageHeader
        titre="Traçabilité du lot"
        sousTitre="Parcours complet de la matière. Dans le sens aval: de la réception au produit fini. Dans le sens amont: du produit fini au camion."
      />

      <Carte className="mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-56 flex-1">
            <span className="mb-1 block text-xs font-medium text-ardoise-600">Lot</span>
            <select
              value={lotId}
              onChange={(e) => setLotId(e.target.value)}
              className="w-full min-h-11 rounded-lg border border-ardoise-300 bg-white px-3 text-sm outline-none focus:border-mer-500"
            >
              {db.lots.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.code} — {l.espece} ({l.statut})
                </option>
              ))}
            </select>
          </label>
          <div className="flex gap-2">
            <Bouton
              variante={sens === 'aval' ? 'primaire' : 'secondaire'}
              onClick={() => setSens('aval')}
            >
              Réception → Produit fini
            </Bouton>
            <Bouton
              variante={sens === 'amont' ? 'primaire' : 'secondaire'}
              onClick={() => setSens('amont')}
            >
              Produit fini → Réception
            </Bouton>
          </div>
        </div>

        {lot && (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-ardoise-100 pt-3 text-sm">
            <Badge ton="info">{lot.code}</Badge>
            <span className="text-ardoise-600">{lot.espece}</span>
            <span className="text-ardoise-400">•</span>
            <span className="text-ardoise-600">{libelleProduit(db, lot.productId)}</span>
            <span className="text-ardoise-400">•</span>
            <span className="text-ardoise-600">{lot.date}</span>
            {lot.equipe && (
              <>
                <span className="text-ardoise-400">•</span>
                <span className="text-ardoise-600">Équipe {lot.equipe}</span>
              </>
            )}
            <Badge ton={lot.statut === 'Clôturé' ? 'bon' : 'alerte'}>{lot.statut}</Badge>
          </div>
        )}
      </Carte>

      {bilan && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-6">
          <Kpi libelle="Reçu" valeur={fmtInt(bilan.recuKg)} unite="kg" />
          <Kpi libelle="Entré en chambre" valeur={fmtInt(bilan.entreeChambreKg)} unite="kg" />
          <Kpi libelle="Sorti en production" valeur={fmtInt(bilan.sortieChambreKg)} unite="kg" />
          <Kpi
            libelle="Rendement traitement"
            valeur={bilan.rendementGlobalPct === null ? '—' : fmt(bilan.rendementGlobalPct)}
            unite="%"
            ton={
              bilan.rendementGlobalPct === null
                ? 'neutre'
                : bilan.rendementGlobalPct >= 78
                  ? 'bon'
                  : 'alerte'
            }
          />
          <Kpi
            libelle="Écart matière"
            valeur={fmtInt(bilan.ecartMatiereKg)}
            unite="kg"
            detail={
              lot?.statut === 'Clôturé'
                ? 'sortie chambre − matière retrouvée − pertes'
                : 'inclut la matière encore en cours'
            }
            ton={
              // Sur un lot en production, l'écart contient l'en-cours: il ne
              // devient une alerte qu'une fois le lot clôturé.
              lot?.statut !== 'Clôturé'
                ? 'neutre'
                : Math.abs(bilan.ecartMatiereKg) > bilan.sortieChambreKg * 0.02
                  ? 'critique'
                  : 'bon'
            }
          />
          <Kpi
            libelle="Produit fini"
            valeur={fmtInt(bilan.boitesEmballees)}
            unite="boîtes"
            detail={`${fmtInt(bilan.cartons)} cartons · ${fmtInt(bilan.palettes)} palettes`}
            ton="bon"
          />
        </div>
      )}

      <Carte titre={sens === 'aval' ? 'Parcours: réception → produit fini' : 'Parcours: produit fini → réception'}>
        {parcours.length === 0 ? (
          <Vide message="Aucune opération enregistrée pour ce lot." />
        ) : (
          <ol className="relative space-y-0">
            {parcours.map((etape, index) => (
              <li key={`${etape.etape}-${index}`} className="relative flex gap-4 pb-6 last:pb-0">
                {/* Fil du parcours */}
                <div className="flex flex-col items-center">
                  <span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-mer-600 text-xs font-semibold text-white">
                    {index + 1}
                  </span>
                  {index < parcours.length - 1 && (
                    <span className="mt-1 w-px flex-1 bg-ardoise-200" />
                  )}
                </div>

                <div className="min-w-0 flex-1 rounded-lg border border-ardoise-200 bg-white p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-ardoise-900">{etape.etape}</p>
                    {etape.ressource && <Badge>{etape.ressource}</Badge>}
                    {etape.zone && <span className="text-xs text-ardoise-400">{etape.zone}</span>}
                  </div>

                  <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
                    {etape.heureDebut && (
                      <Champ libelle="Début" valeur={heure(etape.heureDebut)} />
                    )}
                    {etape.heureFin && <Champ libelle="Fin" valeur={heure(etape.heureFin)} />}
                    {etape.entree && <Champ libelle="Entrée" valeur={etape.entree} />}
                    {etape.sortie && <Champ libelle="Sortie" valeur={etape.sortie} />}
                    {etape.pertes && <Champ libelle="Pertes" valeur={etape.pertes} alerte />}
                  </div>

                  {etape.detail && (
                    <p className="mt-2 border-t border-ardoise-100 pt-2 text-xs text-ardoise-500">
                      {etape.detail}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </Carte>

      {bilan && (
        <div className="mt-4">
          <Carte titre="Bilan boîtes du lot">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <Etape libelle="Grattage / remplissage" valeur={bilan.boitesRemplies} />
              <Etape libelle="Sertissage" valeur={bilan.boitesSerties} precedent={bilan.boitesRemplies} />
              <Etape libelle="Stérilisation" valeur={bilan.boitesSterilisees} precedent={bilan.boitesSerties} />
              <Etape libelle="Emballage" valeur={bilan.boitesEmballees} precedent={bilan.boitesSterilisees} />
              <Etape
                libelle="Rendement boîtes"
                valeur={bilan.boitesEmballees}
                pourcentage={
                  bilan.boitesRemplies
                    ? (bilan.boitesEmballees / bilan.boitesRemplies) * 100
                    : null
                }
              />
            </div>
          </Carte>
        </div>
      )}
    </>
  );
}

function Champ({
  libelle,
  valeur,
  alerte,
}: {
  libelle: string;
  valeur: string;
  alerte?: boolean;
}) {
  return (
    <div>
      <p className="text-xs text-ardoise-400">{libelle}</p>
      <p className={`tabulaire ${alerte ? 'text-amber-700' : 'text-ardoise-800'}`}>{valeur}</p>
    </div>
  );
}

/** Une étape du bilan boîtes, avec la perte par rapport à l'étape précédente. */
function Etape({
  libelle,
  valeur,
  precedent,
  pourcentage,
}: {
  libelle: string;
  valeur: number;
  precedent?: number;
  pourcentage?: number | null;
}) {
  const perte = precedent !== undefined ? precedent - valeur : null;
  return (
    <div className="rounded-lg bg-ardoise-50 p-3">
      <p className="text-xs text-ardoise-500">{libelle}</p>
      <p className="mt-0.5 text-xl font-semibold tabulaire text-ardoise-900">
        {pourcentage !== undefined && pourcentage !== null
          ? `${fmt(pourcentage)} %`
          : fmtInt(valeur)}
      </p>
      {perte !== null && (
        <p className={`text-xs ${perte > 0 ? 'text-rose-600' : 'text-ardoise-400'}`}>
          {perte > 0 ? `− ${fmtInt(perte)} boîtes` : 'sans perte'}
        </p>
      )}
    </div>
  );
}
