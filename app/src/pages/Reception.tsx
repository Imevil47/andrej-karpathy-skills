/** Écran — Réception camion (section 3). */

import { fmt, fmtInt } from '../domain/calculations';
import type { Reception } from '../domain/types';
import { EcranExploitation } from '../ui/crud';
import { dateDuJour, heure, maintenant, optionsEmployes, optionsLots } from '../ui/options';
import { Kpi } from '../ui/primitives';

/** Quantité nette = quantité reçue − tare. */
const net = (r: Partial<Reception>) => (r.quantiteRecue ?? 0) - (r.tare ?? 0);

/** Écart = net − (accepté + refusé). Non nul ⇒ pesée à revoir. */
const ecart = (r: Partial<Reception>) =>
  net(r) - ((r.quantiteAcceptee ?? 0) + (r.quantiteRefusee ?? 0));

export function PageReception() {
  return (
    <EcranExploitation<Reception>
      titre="Réception camion"
      sousTitre="Matière première réceptionnée par camion, contrôlée puis dirigée vers la chambre positive."
      table="receptions"
      libelleCreation="Nouvelle réception"
      filtresAffiches={['dateDebut', 'dateFin', 'lotId', 'espece', 'operateurId']}
      valeursParDefaut={(db) => ({
        numero: `REC-${String(db.receptions.length + 1).padStart(3, '0')}`,
        date: dateDuJour(),
        heureArrivee: maintenant(),
        quantiteRecue: 0,
        quantiteAcceptee: 0,
        quantiteRefusee: 0,
        chambreDestination: 'CP-1',
      })}
      champs={(db) => [
        { nom: 'numero', label: 'N° réception', type: 'texte', requis: true },
        { nom: 'lotId', label: 'N° lot', type: 'select', requis: true, options: optionsLots(db) },
        { nom: 'date', label: 'Date', type: 'date', requis: true },
        { nom: 'heureArrivee', label: 'Heure d’arrivée', type: 'datetime', requis: true },
        { nom: 'camion', label: 'Camion', type: 'texte', requis: true },
        { nom: 'fournisseur', label: 'Fournisseur / origine', type: 'texte', requis: true },
        { nom: 'espece', label: 'Espèce', type: 'texte', requis: true },
        { nom: 'quantiteRecue', label: 'Quantité reçue', type: 'nombre', suffixe: 'kg', requis: true },
        { nom: 'tare', label: 'Tare', type: 'nombre', suffixe: 'kg' },
        { nom: 'temperature', label: 'Température', type: 'nombre', suffixe: '°C', pas: 0.1 },
        { nom: 'quantiteAcceptee', label: 'Quantité acceptée', type: 'nombre', suffixe: 'kg', requis: true },
        { nom: 'quantiteRefusee', label: 'Quantité refusée', type: 'nombre', suffixe: 'kg', requis: true },
        { nom: 'chambreDestination', label: 'Chambre destination', type: 'texte', requis: true },
        { nom: 'operateurId', label: 'Opérateur responsable', type: 'select', options: optionsEmployes(db) },
        { nom: 'observations', label: 'Observations', type: 'zone-texte', large: true },
      ]}
      calcules={[
        { label: 'Quantité nette reçue', valeur: (r) => `${fmt(net(r), 0)} kg` },
        {
          label: 'Écart de pesée',
          valeur: (r) => `${fmt(ecart(r), 0)} kg`,
          aide: 'net − (accepté + refusé)',
        },
        {
          label: 'Taux de refus',
          valeur: (r) => (net(r) ? `${fmt(((r.quantiteRefusee ?? 0) / net(r)) * 100)} %` : '—'),
        },
      ]}
      colonnes={() => [
        { cle: 'numero', entete: 'N°', rendu: (r) => <span className="font-medium">{r.numero}</span> },
        { cle: 'heure', entete: 'Arrivée', rendu: (r) => heure(r.heureArrivee) },
        { cle: 'camion', entete: 'Camion', rendu: (r) => r.camion, secondaire: true },
        { cle: 'fournisseur', entete: 'Fournisseur', rendu: (r) => r.fournisseur, secondaire: true },
        { cle: 'espece', entete: 'Espèce', rendu: (r) => r.espece },
        { cle: 'temp', entete: '°C', rendu: (r) => fmt(r.temperature), numerique: true, secondaire: true },
        { cle: 'recue', entete: 'Reçu (kg)', rendu: (r) => fmtInt(r.quantiteRecue), numerique: true },
        { cle: 'nette', entete: 'Net (kg)', rendu: (r) => fmtInt(net(r)), numerique: true, secondaire: true },
        { cle: 'acceptee', entete: 'Accepté (kg)', rendu: (r) => fmtInt(r.quantiteAcceptee), numerique: true },
        {
          cle: 'refusee',
          entete: 'Refusé (kg)',
          rendu: (r) => (
            <span className={r.quantiteRefusee > 0 ? 'font-medium text-rose-600' : ''}>
              {fmtInt(r.quantiteRefusee)}
            </span>
          ),
          numerique: true,
        },
        {
          cle: 'ecart',
          entete: 'Écart (kg)',
          rendu: (r) => (
            <span
              className={
                Math.abs(ecart(r)) > 0.5 ? 'font-medium text-amber-600' : 'text-ardoise-400'
              }
            >
              {fmtInt(ecart(r))}
            </span>
          ),
          numerique: true,
        },
        { cle: 'chambre', entete: 'Chambre', rendu: (r) => r.chambreDestination, secondaire: true },
      ]}
      resume={(lignes) => {
        const recu = lignes.reduce((t, r) => t + r.quantiteRecue, 0);
        const accepte = lignes.reduce((t, r) => t + r.quantiteAcceptee, 0);
        const refuse = lignes.reduce((t, r) => t + r.quantiteRefusee, 0);
        return (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi libelle="Camions" valeur={fmtInt(lignes.length)} />
            <Kpi libelle="Quantité reçue" valeur={fmtInt(recu)} unite="kg" />
            <Kpi libelle="Quantité acceptée" valeur={fmtInt(accepte)} unite="kg" ton="bon" />
            <Kpi
              libelle="Quantité refusée"
              valeur={fmtInt(refuse)}
              unite="kg"
              ton={refuse > 0 ? 'alerte' : 'neutre'}
              detail={recu ? `${fmt((refuse / recu) * 100)} % du reçu` : undefined}
            />
          </div>
        );
      }}
    />
  );
}
