/** Écran — Dashboard Gestion d'Exploitation (section 20). */

import { Link } from 'react-router-dom';
import { fmt, fmtDuree, fmtInt } from '../domain/calculations';
import { controlerCoherence } from '../domain/coherence';
import { kpisDashboard, performanceParLigne } from '../domain/selectors';
import { BarresHorizontales, Colonnes } from '../ui/charts';
import { BarreFiltres } from '../ui/filtres';
import { Badge, Carte, Kpi, PageHeader, Tableau, Vide } from '../ui/primitives';
import { useDb, useFiltres } from '../ui/state';

export function PageDashboard() {
  const db = useDb();
  const { filtres } = useFiltres();
  const k = kpisDashboard(db, filtres);
  const lignes = performanceParLigne(db, filtres);
  const anomalies = controlerCoherence(db);

  const meilleureLigne = [...lignes].sort((a, b) => (b.cadence ?? 0) - (a.cadence ?? 0))[0];
  const ligneLaPlusArretee = [...lignes].sort((a, b) => b.tempsArretMin - a.tempsArretMin)[0];

  return (
    <>
      <PageHeader
        titre="Gestion d’exploitation"
        sousTitre="Vision complète de la journée: matière, production, temps, arrêts, personnel, pertes et rendement."
      />
      <BarreFiltres />

      {/* Production */}
      <SectionTitre>Production</SectionTitre>
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Kpi libelle="Boîtes produites" valeur={fmtInt(k.boitesProduites)} />
        <Kpi libelle="Boîtes conformes" valeur={fmtInt(k.boitesConformes)} ton="bon" />
        <Kpi
          libelle="Non conformes"
          valeur={fmtInt(k.boitesNonConformes)}
          ton={k.boitesNonConformes > 0 ? 'critique' : 'bon'}
        />
        <Kpi libelle="Rebut" valeur={fmtInt(k.rebut)} unite="bt" ton={k.rebut > 0 ? 'alerte' : 'neutre'} />
        <Kpi libelle="Cartons" valeur={fmtInt(k.cartons)} />
        <Kpi libelle="Palettes" valeur={fmtInt(k.palettes)} />
      </div>

      {/* Performance */}
      <SectionTitre>Performance</SectionTitre>
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi
          libelle="Cadence"
          valeur={fmtInt(k.cadenceBoitesH)}
          unite="bt/h"
          detail="sur temps net"
        />
        <Kpi
          libelle="Rendement matière"
          valeur={k.rendementMatierePct === null ? '—' : fmt(k.rendementMatierePct)}
          unite="%"
          ton={
            k.rendementMatierePct === null
              ? 'neutre'
              : k.rendementMatierePct >= 78
                ? 'bon'
                : k.rendementMatierePct >= 70
                  ? 'alerte'
                  : 'critique'
          }
        />
        <Kpi
          libelle="Productivité"
          valeur={fmtInt(k.productiviteBoitesHPers)}
          unite="bt/h/pers."
        />
        <Kpi
          libelle="Taux de perte"
          valeur={k.tauxPertePct === null ? '—' : fmt(k.tauxPertePct)}
          unite="%"
          ton={k.tauxPertePct !== null && k.tauxPertePct > 25 ? 'critique' : 'alerte'}
        />
        <Kpi libelle="Temps net" valeur={fmtDuree(k.tempsNetMin)} detail="hors arrêts" />
      </div>

      <div className="mb-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Carte titre="Production par ligne">
          <BarresHorizontales
            donnees={k.productionParLigne}
            unite="bt"
            messageVide="Aucune production enregistrée."
          />
        </Carte>
        <Carte titre="Production par produit">
          <BarresHorizontales
            donnees={k.productionParProduit}
            unite="bt"
            messageVide="Aucune production enregistrée."
          />
        </Carte>
      </div>

      <div className="mb-5">
        <Carte titre="Production par heure de démarrage">
          <Colonnes
            donnees={k.productionParHeure}
            unite="bt"
            messageVide="Aucune production enregistrée."
          />
        </Carte>
      </div>

      {/* Arrêts */}
      <SectionTitre>Arrêts</SectionTitre>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi libelle="Temps d’arrêt total" valeur={fmtDuree(k.tempsArretMin)} ton="critique" />
        <Kpi libelle="Nombre d’arrêts" valeur={fmtInt(k.nbArrets)} />
        <Kpi
          libelle="Durée moyenne"
          valeur={fmtDuree(k.nbArrets ? k.tempsArretMin / k.nbArrets : null)}
        />
        <Kpi
          libelle="Ligne la plus arrêtée"
          valeur={ligneLaPlusArretee?.nom ?? '—'}
          detail={ligneLaPlusArretee ? fmtDuree(ligneLaPlusArretee.tempsArretMin) : undefined}
          ton="alerte"
        />
      </div>

      <div className="mb-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Carte titre="Top causes d’arrêt">
          <BarresHorizontales
            donnees={k.topCauses}
            teinte="alerte"
            formater={(v) => fmtDuree(v)}
            messageVide="Aucun arrêt déclaré."
          />
        </Carte>
        <Carte titre="Arrêts par ligne">
          <BarresHorizontales
            donnees={k.arretsParLigne}
            teinte="alerte"
            formater={(v) => fmtDuree(v)}
            messageVide="Aucun arrêt de ligne."
          />
        </Carte>
        <Carte titre="Arrêts par machine">
          <BarresHorizontales
            donnees={k.arretsParMachine}
            teinte="alerte"
            formater={(v) => fmtDuree(v)}
            messageVide="Aucun arrêt machine."
          />
        </Carte>
      </div>

      {/* Matière */}
      <SectionTitre>Matière</SectionTitre>
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi libelle="Entrée matière" valeur={fmtInt(k.matiereEntreeKg)} unite="kg" />
        <Kpi libelle="Consommation" valeur={fmtInt(k.matiereConsommeeKg)} unite="kg" />
        <Kpi libelle="Pertes" valeur={fmtInt(k.pertesKg)} unite="kg" ton="alerte" />
        <Kpi
          libelle="Stock chambre"
          valeur={fmtInt(k.stockKg)}
          unite="kg"
          ton={k.stockKg < 0 ? 'critique' : 'bon'}
        />
        <Kpi
          libelle="Écart matière"
          valeur={fmtInt(k.ecartMatiereKg)}
          unite="kg"
          detail="sorti − retrouvé − pertes"
          ton={
            Math.abs(k.ecartMatiereKg) > k.matiereConsommeeKg * 0.02 ? 'critique' : 'bon'
          }
        />
      </div>

      {/* Classement des lignes */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Carte titre="Performance par ligne" className="xl:col-span-2">
          <Tableau
            lignes={lignes}
            clef={(l) => l.nom}
            messageVide="Aucune activité sur la période."
            colonnes={[
              { cle: 'nom', entete: 'Ligne', rendu: (l) => <span className="font-medium">{l.nom}</span> },
              { cle: 'zone', entete: 'Zone', rendu: (l) => <Badge>{l.zone}</Badge> },
              { cle: 'prod', entete: 'Production', rendu: (l) => fmtInt(l.production), numerique: true },
              {
                cle: 'rendement',
                entete: 'Rendement',
                rendu: (l) => (l.rendementPct === null ? '—' : `${fmt(l.rendementPct)} %`),
                numerique: true,
              },
              {
                cle: 'cadence',
                entete: 'Cadence',
                rendu: (l) => <span className="font-medium">{fmtInt(l.cadence)}</span>,
                numerique: true,
              },
              {
                cle: 'arrets',
                entete: 'Arrêts',
                rendu: (l) => (
                  <span className={l.tempsArretMin > 0 ? 'text-rose-600' : 'text-ardoise-400'}>
                    {l.tempsArretMin > 0 ? fmtDuree(l.tempsArretMin) : '—'}
                  </span>
                ),
                numerique: true,
              },
              {
                cle: 'nb',
                entete: 'Nb arrêts',
                rendu: (l) => fmtInt(l.nbArrets),
                numerique: true,
                secondaire: true,
              },
            ]}
          />
        </Carte>

        <div className="space-y-4">
          <Carte titre="Ce que disent les chiffres">
            <ul className="space-y-3 text-sm">
              <Constat
                libelle="Ligne la plus performante"
                valeur={meilleureLigne?.nom ?? '—'}
                detail={
                  meilleureLigne?.cadence
                    ? `${fmtInt(meilleureLigne.cadence)} unités/h`
                    : 'cadence non calculable'
                }
              />
              <Constat
                libelle="Ligne la plus arrêtée"
                valeur={ligneLaPlusArretee?.nom ?? '—'}
                detail={
                  ligneLaPlusArretee
                    ? `${fmtDuree(ligneLaPlusArretee.tempsArretMin)} sur ${ligneLaPlusArretee.nbArrets} arrêt(s)`
                    : undefined
                }
                alerte
              />
              <Constat
                libelle="Première cause de temps perdu"
                valeur={k.topCauses[0]?.nom ?? '—'}
                detail={k.topCauses[0] ? fmtDuree(k.topCauses[0].valeur) : undefined}
                alerte
              />
              <Constat
                libelle="Perte matière"
                valeur={`${fmtInt(k.pertesKg)} kg`}
                detail={
                  k.tauxPertePct === null ? undefined : `${fmt(k.tauxPertePct)} % de la matière traitée`
                }
                alerte
              />
            </ul>
          </Carte>

          <Carte titre="Contrôle de cohérence">
            {anomalies.length === 0 ? (
              <p className="py-4 text-center text-sm text-emerald-700">
                Aucune anomalie détectée sur les données saisies.
              </p>
            ) : (
              <>
                <p className="mb-2 text-sm text-ardoise-600">
                  <strong className="text-rose-700">{anomalies.length}</strong> anomalie
                  {anomalies.length > 1 ? 's' : ''} détectée{anomalies.length > 1 ? 's' : ''}.
                </p>
                <ul className="space-y-1.5 text-sm">
                  {anomalies.slice(0, 4).map((a) => (
                    <li key={a.id} className="flex gap-2">
                      <Badge ton={a.severite === 'critique' ? 'critique' : 'alerte'}>
                        {a.regle}
                      </Badge>
                    </li>
                  ))}
                </ul>
                <Link
                  to="/rapports"
                  className="mt-3 inline-block text-sm text-mer-600 underline underline-offset-2"
                >
                  Voir le détail dans Rapports →
                </Link>
              </>
            )}
          </Carte>
        </div>
      </div>

      {db.lots.length === 0 && (
        <Vide message="Aucun lot enregistré. Commencez par créer un lot dans Paramètres, puis saisissez une réception." />
      )}
    </>
  );
}

function SectionTitre({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ardoise-400">
      {children}
    </h2>
  );
}

function Constat({
  libelle,
  valeur,
  detail,
  alerte,
}: {
  libelle: string;
  valeur: string;
  detail?: string;
  alerte?: boolean;
}) {
  return (
    <li>
      <p className="text-xs text-ardoise-500">{libelle}</p>
      <p className={`font-medium ${alerte ? 'text-rose-700' : 'text-emerald-700'}`}>{valeur}</p>
      {detail && <p className="text-xs text-ardoise-500">{detail}</p>}
    </li>
  );
}
