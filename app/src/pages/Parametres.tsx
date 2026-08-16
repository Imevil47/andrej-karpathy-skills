/** Écran — Paramètres: lots, référentiels et gestion des données. */

import { useState } from 'react';
import { store } from '../data/store';
import type { Database } from '../domain/types';
import { EQUIPES, ETATS_MACHINE, TYPES_LIQUIDE, ZONES } from '../domain/types';
import { EcranExploitation } from '../ui/crud';
import { dateDuJour, optionsEnum, optionsProduits } from '../ui/options';
import { Badge, Bouton, Carte, PageHeader } from '../ui/primitives';
import { useDb } from '../ui/state';
import type { Employee, Line, Lot, Machine, Product, Recipe } from '../domain/types';

type Onglet = 'lots' | 'produits' | 'lignes' | 'machines' | 'personnel' | 'recettes' | 'donnees';

const ONGLETS: { clef: Onglet; libelle: string }[] = [
  { clef: 'lots', libelle: 'Lots' },
  { clef: 'produits', libelle: 'Produits' },
  { clef: 'lignes', libelle: 'Lignes' },
  { clef: 'machines', libelle: 'Machines' },
  { clef: 'personnel', libelle: 'Personnel' },
  { clef: 'recettes', libelle: 'Recettes / liquides' },
  { clef: 'donnees', libelle: 'Données' },
];

export function PageParametres() {
  const [onglet, setOnglet] = useState<Onglet>('lots');

  return (
    <>
      <PageHeader
        titre="Paramètres"
        sousTitre="Référentiels de l’usine. Toute opération saisie s’appuie sur ces listes."
      />

      <div className="mb-4 flex flex-wrap gap-2 sans-impression">
        {ONGLETS.map((o) => (
          <button
            key={o.clef}
            type="button"
            onClick={() => setOnglet(o.clef)}
            className={`min-h-10 rounded-lg px-3.5 text-sm font-medium transition ${
              onglet === o.clef
                ? 'bg-mer-600 text-white'
                : 'border border-ardoise-300 bg-white text-ardoise-700 hover:bg-ardoise-50'
            }`}
          >
            {o.libelle}
          </button>
        ))}
      </div>

      {onglet === 'lots' && <OngletLots />}
      {onglet === 'produits' && <OngletProduits />}
      {onglet === 'lignes' && <OngletLignes />}
      {onglet === 'machines' && <OngletMachines />}
      {onglet === 'personnel' && <OngletPersonnel />}
      {onglet === 'recettes' && <OngletRecettes />}
      {onglet === 'donnees' && <OngletDonnees />}
    </>
  );
}

/* ------------------------------------------------------------------ */

function OngletLots() {
  return (
    <EcranExploitation<Lot>
      titre="Lots"
      sousTitre="Le Lot ID accompagne la matière du camion à la palette. Créez-le avant la réception."
      table="lots"
      libelleCreation="Nouveau lot"
      filtresAffiches={['dateDebut', 'dateFin', 'espece', 'productId', 'equipe']}
      valeursParDefaut={(db) => ({
        code: `LOT-${dateDuJour().slice(0, 7)}-${String(db.lots.length + 1).padStart(3, '0')}`,
        date: dateDuJour(),
        statut: 'Ouvert' as const,
      })}
      champs={(db) => [
        { nom: 'code', label: 'Code lot', type: 'texte', requis: true, aide: 'ex: LOT-2026-08-001' },
        { nom: 'date', label: 'Date', type: 'date', requis: true },
        { nom: 'espece', label: 'Espèce', type: 'texte', requis: true },
        { nom: 'productId', label: 'Produit', type: 'select', options: optionsProduits(db) },
        { nom: 'equipe', label: 'Équipe', type: 'select', options: optionsEnum(EQUIPES) },
        {
          nom: 'statut',
          label: 'Statut',
          type: 'select',
          requis: true,
          options: optionsEnum(['Ouvert', 'En production', 'Clôturé'] as const),
        },
        { nom: 'observations', label: 'Observations', type: 'zone-texte', large: true },
      ]}
      colonnes={(db) => [
        { cle: 'code', entete: 'Code', rendu: (l) => <span className="font-medium">{l.code}</span> },
        { cle: 'date', entete: 'Date', rendu: (l) => l.date },
        { cle: 'espece', entete: 'Espèce', rendu: (l) => l.espece },
        {
          cle: 'produit',
          entete: 'Produit',
          rendu: (l) => db.products.find((p) => p.id === l.productId)?.nom ?? '—',
        },
        { cle: 'equipe', entete: 'Équipe', rendu: (l) => l.equipe ?? '—' },
        {
          cle: 'statut',
          entete: 'Statut',
          rendu: (l) => (
            <Badge ton={l.statut === 'Clôturé' ? 'bon' : l.statut === 'En production' ? 'info' : 'neutre'}>
              {l.statut}
            </Badge>
          ),
        },
      ]}
    />
  );
}

function OngletProduits() {
  return (
    <EcranExploitation<Product>
      titre="Produits"
      sousTitre="Références fabriquées, avec leur poids cible et leur conditionnement."
      table="products"
      libelleCreation="Nouveau produit"
      filtresAffiches={[]}
      valeursParDefaut={() => ({ boitesParCarton: 50, cartonsParPalette: 60 })}
      champs={() => [
        { nom: 'code', label: 'Code', type: 'texte', requis: true },
        { nom: 'nom', label: 'Désignation', type: 'texte', requis: true },
        { nom: 'espece', label: 'Espèce', type: 'texte', requis: true },
        { nom: 'formatBoite', label: 'Format de boîte', type: 'texte' },
        { nom: 'poidsCibleG', label: 'Poids cible', type: 'nombre', suffixe: 'g', pas: 0.1 },
        { nom: 'boitesParCarton', label: 'Boîtes / carton', type: 'nombre' },
        { nom: 'cartonsParPalette', label: 'Cartons / palette', type: 'nombre' },
      ]}
      colonnes={() => [
        { cle: 'code', entete: 'Code', rendu: (p) => <span className="font-medium">{p.code}</span> },
        { cle: 'nom', entete: 'Désignation', rendu: (p) => p.nom },
        { cle: 'espece', entete: 'Espèce', rendu: (p) => p.espece },
        { cle: 'format', entete: 'Format', rendu: (p) => p.formatBoite ?? '—' },
        { cle: 'poids', entete: 'Poids cible (g)', rendu: (p) => p.poidsCibleG ?? '—', numerique: true },
        { cle: 'carton', entete: 'Bt/carton', rendu: (p) => p.boitesParCarton ?? '—', numerique: true },
        { cle: 'palette', entete: 'Cartons/palette', rendu: (p) => p.cartonsParPalette ?? '—', numerique: true },
      ]}
    />
  );
}

function OngletLignes() {
  return (
    <EcranExploitation<Line>
      titre="Lignes"
      sousTitre="Lignes de traitement, de grattage, de remplissage et d’emballage."
      table="lines"
      libelleCreation="Nouvelle ligne"
      filtresAffiches={['zone']}
      valeursParDefaut={() => ({ active: true, zone: 'Traitement' as const })}
      champs={() => [
        { nom: 'nom', label: 'Nom', type: 'texte', requis: true },
        { nom: 'zone', label: 'Zone', type: 'select', requis: true, options: optionsEnum(ZONES) },
        {
          nom: 'active',
          label: 'Active',
          type: 'select',
          options: [
            { value: 'true', label: 'Oui' },
            { value: 'false', label: 'Non' },
          ],
        },
      ]}
      avantEnregistrement={(l) => ({ ...l, active: String(l.active) !== 'false' })}
      colonnes={() => [
        { cle: 'nom', entete: 'Nom', rendu: (l) => <span className="font-medium">{l.nom}</span> },
        { cle: 'zone', entete: 'Zone', rendu: (l) => <Badge>{l.zone}</Badge> },
        {
          cle: 'active',
          entete: 'État',
          rendu: (l) => (l.active ? <Badge ton="bon">Active</Badge> : <Badge>Inactive</Badge>),
        },
      ]}
    />
  );
}

function OngletMachines() {
  return (
    <EcranExploitation<Machine>
      titre="Machines"
      sousTitre="Machines filet, cuiseurs, sertisseuses, marqueuses et autoclaves."
      table="machines"
      libelleCreation="Nouvelle machine"
      filtresAffiches={['zone']}
      valeursParDefaut={() => ({ actif: true, zone: 'Filet' as const, etat: 'Disponible' as const })}
      champs={() => [
        { nom: 'nom', label: 'Nom', type: 'texte', requis: true },
        { nom: 'zone', label: 'Zone', type: 'select', requis: true, options: optionsEnum(ZONES) },
        { nom: 'etat', label: 'État', type: 'select', requis: true, options: optionsEnum(ETATS_MACHINE) },
        {
          nom: 'actif',
          label: 'En service',
          type: 'select',
          options: [
            { value: 'true', label: 'Oui' },
            { value: 'false', label: 'Non' },
          ],
        },
      ]}
      avantEnregistrement={(m) => ({ ...m, actif: String(m.actif) !== 'false' })}
      colonnes={() => [
        { cle: 'nom', entete: 'Nom', rendu: (m) => <span className="font-medium">{m.nom}</span> },
        { cle: 'zone', entete: 'Zone', rendu: (m) => <Badge>{m.zone}</Badge> },
        { cle: 'etat', entete: 'État', rendu: (m) => m.etat },
        {
          cle: 'actif',
          entete: 'Service',
          rendu: (m) => (m.actif ? <Badge ton="bon">En service</Badge> : <Badge>Hors service</Badge>),
        },
      ]}
    />
  );
}

function OngletPersonnel() {
  return (
    <EcranExploitation<Employee>
      titre="Personnel"
      sousTitre="Opératrices et responsables. Le matricule identifie la production individuelle."
      table="employees"
      libelleCreation="Nouvel employé"
      filtresAffiches={['equipe']}
      valeursParDefaut={() => ({ actif: true })}
      champs={() => [
        { nom: 'matricule', label: 'Matricule', type: 'texte', requis: true },
        { nom: 'nom', label: 'Nom', type: 'texte', requis: true },
        { nom: 'poste', label: 'Poste', type: 'texte' },
        { nom: 'equipe', label: 'Équipe', type: 'select', options: optionsEnum(EQUIPES) },
        {
          nom: 'actif',
          label: 'Actif',
          type: 'select',
          options: [
            { value: 'true', label: 'Oui' },
            { value: 'false', label: 'Non' },
          ],
        },
      ]}
      avantEnregistrement={(e) => ({ ...e, actif: String(e.actif) !== 'false' })}
      colonnes={() => [
        { cle: 'matricule', entete: 'Matricule', rendu: (e) => <span className="font-medium">{e.matricule}</span> },
        { cle: 'nom', entete: 'Nom', rendu: (e) => e.nom },
        { cle: 'poste', entete: 'Poste', rendu: (e) => e.poste ?? '—' },
        { cle: 'equipe', entete: 'Équipe', rendu: (e) => e.equipe ?? '—' },
        {
          cle: 'actif',
          entete: 'Statut',
          rendu: (e) => (e.actif ? <Badge ton="bon">Actif</Badge> : <Badge>Inactif</Badge>),
        },
      ]}
    />
  );
}

function OngletRecettes() {
  return (
    <EcranExploitation<Recipe>
      titre="Recettes / liquides"
      sousTitre="Dosage théorique de liquide par produit. Sert au calcul de la consommation théorique."
      table="recipes"
      libelleCreation="Nouvelle recette"
      filtresAffiches={['productId']}
      valeursParDefaut={() => ({ typeLiquide: 'Huile' as const, unite: 'ml' as const, dosageTheorique: 25 })}
      champs={(db) => [
        { nom: 'productId', label: 'Produit', type: 'select', requis: true, options: optionsProduits(db) },
        {
          nom: 'typeLiquide',
          label: 'Type de liquide',
          type: 'select',
          requis: true,
          options: optionsEnum(TYPES_LIQUIDE),
        },
        { nom: 'reference', label: 'Référence', type: 'texte', requis: true },
        { nom: 'dosageTheorique', label: 'Dosage théorique / boîte', type: 'nombre', requis: true },
        {
          nom: 'unite',
          label: 'Unité',
          type: 'select',
          requis: true,
          options: [
            { value: 'ml', label: 'ml' },
            { value: 'g', label: 'g' },
          ],
        },
      ]}
      colonnes={(db) => [
        {
          cle: 'produit',
          entete: 'Produit',
          rendu: (r) => (
            <span className="font-medium">
              {db.products.find((p) => p.id === r.productId)?.nom ?? '—'}
            </span>
          ),
        },
        { cle: 'type', entete: 'Type', rendu: (r) => <Badge ton="info">{r.typeLiquide}</Badge> },
        { cle: 'ref', entete: 'Référence', rendu: (r) => r.reference },
        {
          cle: 'dosage',
          entete: 'Dosage',
          rendu: (r) => `${r.dosageTheorique} ${r.unite}/boîte`,
          numerique: true,
        },
      ]}
    />
  );
}

/* ------------------------------------------------------------------ */

function OngletDonnees() {
  const db = useDb();

  const exporter = () => {
    const lien = document.createElement('a');
    lien.href = URL.createObjectURL(
      new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' }),
    );
    lien.download = `sauvegarde-exploitation-${new Date().toISOString().slice(0, 10)}.json`;
    lien.click();
    URL.revokeObjectURL(lien.href);
  };

  const importer = (fichier: File) => {
    const lecteur = new FileReader();
    lecteur.onload = () => {
      try {
        store.replace(JSON.parse(String(lecteur.result)) as Database);
        alert('Sauvegarde importée.');
      } catch {
        alert('Fichier illisible: la sauvegarde doit être un export JSON de cette application.');
      }
    };
    lecteur.readAsText(fichier);
  };

  const compteur = (nom: keyof Database) => db[nom].length;

  return (
    <div className="space-y-4">
      <Carte titre="Volume de données">
        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-5">
          {(
            [
              ['Lots', 'lots'],
              ['Réceptions', 'receptions'],
              ['Mouvements de stock', 'stockMovements'],
              ['Traitement', 'treatmentOperations'],
              ['Filet', 'filetOperations'],
              ['Cuisson', 'cuissonOperations'],
              ['Grattage', 'grattageOperations'],
              ['Remplissage', 'fillingOperations'],
              ['Liquides', 'liquidConsumptions'],
              ['Sertissage', 'sertissageOperations'],
              ['Marquage', 'marquageOperations'],
              ['Stérilisation', 'sterilisationCycles'],
              ['Emballage', 'packagingOperations'],
              ['Arrêts', 'stops'],
              ['Contrôles qualité', 'qualityControls'],
            ] as [string, keyof Database][]
          ).map(([libelle, table]) => (
            <div key={table} className="rounded-lg bg-ardoise-50 p-2.5">
              <p className="text-xs text-ardoise-500">{libelle}</p>
              <p className="text-lg font-semibold tabulaire text-ardoise-900">{compteur(table)}</p>
            </div>
          ))}
        </div>
      </Carte>

      <Carte titre="Sauvegarde et restauration">
        <p className="mb-3 text-sm text-ardoise-600">
          Les données sont enregistrées dans ce navigateur. Exportez régulièrement une sauvegarde
          pour les conserver ou les transférer sur un autre poste.
        </p>
        <div className="flex flex-wrap gap-2">
          <Bouton variante="primaire" onClick={exporter}>
            Exporter la base (JSON)
          </Bouton>
          <label className="inline-flex min-h-10 cursor-pointer items-center rounded-lg border border-ardoise-300 bg-white px-3.5 text-sm font-medium text-ardoise-700 hover:bg-ardoise-50">
            Importer une sauvegarde
            <input
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => {
                const fichier = e.target.files?.[0];
                if (fichier) importer(fichier);
              }}
            />
          </label>
          <Bouton
            onClick={() => {
              if (confirm('Effacer toutes les opérations et conserver les référentiels ?')) {
                store.clearOperations();
              }
            }}
          >
            Vider les opérations
          </Bouton>
          <Bouton
            variante="danger"
            onClick={() => {
              if (confirm('Réinitialiser avec le jeu de démonstration ? Les données actuelles seront perdues.')) {
                store.reset();
              }
            }}
          >
            Réinitialiser (démo)
          </Bouton>
        </div>
      </Carte>
    </div>
  );
}
