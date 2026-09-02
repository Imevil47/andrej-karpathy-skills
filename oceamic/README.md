# OCEAMIC — Système Qualité, Stock & Sous-traitance

Classeur Excel unique, reconstruit de zéro, **sans VBA, sans macro, sans script,
sans bouton et sans protection de cellule**.

| Fichier | Usage |
|---|---|
| `OCEAMIC_Systeme_Qualite_Stock_Sous-traitance.xlsx` | Classeur de production — une ligne `LIGNE EXEMPLE` par onglet de saisie, à supprimer avant mise en service |
| `OCEAMIC_Systeme_Qualite_Stock_Sous-traitance_RECETTE.xlsx` | Même classeur, rempli avec les 15 scénarios obligatoires + onglet `TESTS` (29 contrôles, tous PASS) |
| `build_oceamic_workbook.py` | Générateur (openpyxl) des deux fichiers — `python3 build_oceamic_workbook.py sortie.xlsx [demo]` |

## Architecture

```
PARAM  ──►  listes déroulantes dynamiques (OFFSET/COUNTA) + réglages système
LOTS   ──►  identité du lot — saisie UNE SEULE fois
   │
   ├─ OPERATIONS      RECEPTION / TRANSFERT / CONSOMMATION
   ├─ SOUS_TRAITANCE  envois  (FOURNISSEUR direct | STOCK EXISTANT)
   ├─ ST_RESULTATS    1..N résultats par envoi
   └─ QUALITE         contrôles — aucun impact stock
                 │
                 ▼
          MOUVEMENTS  ──  grand livre unique, 100 % formules, aucune saisie
                 │
        ┌────────┴────────┐
      STOCK           RECHERCHE
  matrice lot ×      fiche lot 360°
   emplacement
```

11 onglets : `ACCUEIL`, `LOTS`, `OPERATIONS`, `SOUS_TRAITANCE`, `ST_RESULTATS`,
`QUALITE`, `STOCK`, `RECHERCHE`, `MOUVEMENTS`, `PARAM`, `GUIDE`
(+ `TESTS` dans le fichier de recette).

## Le moteur de stock

`MOUVEMENTS` porte **deux** colonnes de quantité signée :

- **QTE DECLAREE** — la ligne telle que saisie, dès qu'elle est structurellement
  complète. Elle sert à calculer le *disponible avant opération*.
- **QTE EN STOCK** — vaut `0` dès que la ligne est en anomalie. C'est elle, et
  elle seule, qui alimente les stocks.

`DISPO AVANT` (feuille de saisie) dépend de QTE DECLAREE ; QTE EN STOCK dépend du
statut, donc de DISPO AVANT. Le graphe de dépendances reste **acyclique** : aucune
référence circulaire, et une sortie supérieure au disponible est **exclue du
stock** au lieu de le rendre négatif.

C'est la réponse « sans macro » aux exigences *never allow negative stock* et
*invalid entries must not affect stock* : Excel ne peut pas empêcher la frappe,
mais le classeur la neutralise et la signale — ligne rouge, statut
`STOCK INSUFFISANT`, compteur bloquant sur `ACCUEIL`. Le contrôle
`ECART MATRICE / GRAND LIVRE` doit rester à 0 kg en permanence.

## Identité du lot : interne + externe

Comme dans la V2, un lot porte **deux** numéros :

- **`LOT INTERNE`** — la clé du stock. Obligatoire, unique, **définitive**. Si
  aucun numéro interne n'est encore attribué (marchandise en entrepôt externe),
  on reprend le numéro externe et on ne le change plus.
- **`LOT EXTERNE`** — le numéro du fournisseur. Attribut cherchable et traçable,
  qui peut être partagé par plusieurs lots internes.

`RECHERCHE` accepte **l'un ou l'autre** : saisir un numéro externe le résout vers
le lot interne correspondant, et un bloc dédié liste tous les autres lots
internes portant ce même numéro externe (lots issus de sous-traitance compris).

## Aucune double saisie

Seul le **code lot** est ressaisi. Produit, fournisseur, origine,
immatriculation, état et conservation viennent de `LOTS` par `INDEX/MATCH`.

`LOTS` calcule en plus des colonnes **effectives** (`PRODUIT EFFECTIF`,
`FOURNISSEUR EFFECTIF`, `ORIGINE EFFECTIVE`, `CONSERVATION EFFECTIVE`) : un lot
issu de sous-traitance dont la fiche ne porte pas ces informations les hérite de
son lot parent — parent renseigné à la main, ou retrouvé automatiquement via
`ST_RESULTATS`. `RECHERCHE` affiche alors la mention *« hérité du lot X »*.
Un `LOT RESULTAT` laissé vide conserve simplement le lot source.

## Données de référence

`PARAM` est aligné sur les listes maîtres du système V2 existant :
emplacements réels (OCEAMIC 2 en INTERNE ; SARMA, DAMSA, COFRIGOP, COFRIGOB,
FOURSEASEN, ATLANTIC, WILL FISHING, KJ FISH, OCEAMIC 1 en EXTERNE), espèces,
producteurs, origines, états matière (dont IQF), conservation (FRAIS / CONGELE),
sites de sous-traitance et décisions (ACCEPTER / REFUSER / A RECONTROLER /
BLOQUER). L'histamine est en PPM.

`QUALITE` et `MOULE` acceptent la **saisie libre** : les listes déroulantes ne
sont qu'une aide, et le format réel de distribution (`A=20 B=40 C=40`,
`20/24=14 26/30=55 38/50=31`) passe sans contrainte.

## Statuts

`OK` · `EN COURS` · `DONNEES MANQUANTES` · `STOCK INSUFFISANT` ·
`EMPLACEMENT INCOHERENT` · `A JUSTIFIER` · `BLOQUE` · `LOT EN DOUBLE` ·
`INCOHERENCE`

Seules les lignes `OK` (et `EN COURS` / `A JUSTIFIER` pour un envoi de
sous-traitance, dont la marchandise est bien partie) impactent le stock.

## Recette

Onglet `TESTS` du fichier de recette : 29 contrôles couvrant les 15 scénarios
obligatoires (réception interne et externe, consommation et transfert partiels,
sous-traitance depuis stock et fournisseur direct, `EN COURS`, résultats
multiples, retour OCEAMIC 2, résultat vers stock externe, écart à justifier,
contrôle qualité sans mouvement, sortie supérieure au stock, réutilisation d'un
lot, traçabilité complète), plus des contrôles d'intégrité globale.

Le fichier de recette affiche volontairement
`INTEGRITE DES DONNEES : A CORRIGER` : le scénario 13 y laisse une consommation
refusée. Le fichier de production démarre à `OK`.

## Contraintes techniques respectées

- Formules Excel 2007 uniquement (`INDEX`, `MATCH`, `SUMIFS`, `COUNTIFS`,
  `SUMPRODUCT`, `IFERROR`, `TEXT`) — aucune fonction matricielle dynamique
  (`XLOOKUP`, `FILTER`, `UNIQUE`…), donc compatible Excel 2010+, Excel Online et
  mobile.
- Plages nommées dynamiques, validations de données, mises en forme
  conditionnelles, filtres automatiques, volets figés.
- Classe de stock limitée à `INTERNE` / `EXTERNE` ; `CONSOMMATION` est une
  opération, jamais une classe.
- Quatrième opération : `AJUSTEMENT` — correction d'inventaire à quantité
  signée (négative = perte) avec `MOTIF` obligatoire, seul moyen de corriger un
  stock. Un ajustement négatif ne peut pas dépasser le disponible.

## Synthèses

L'onglet `STOCK` porte, en plus de la matrice lot × emplacement :

- stock **par espèce** et **par état matière** ;
- **stock bloqué qualité** — total des lots dont la *dernière* décision qualité
  est `BLOQUER`. Signalé uniquement : conformément à la règle « un contrôle ne
  change jamais une quantité », aucun mouvement n'est généré ;
- **réconciliation du grand livre** — `ENTREES − SORTIES ± AJUSTEMENTS =
  STOCK ACTUEL`, avec un indicateur `BILAN OK` qui vérifie l'égalité en
  permanence, plus le total des écarts de sous-traitance non justifiés.
- Capacités : 200 lots, 300 opérations, 150 envois, 300 résultats,
  250 contrôles, 1 050 lignes de mouvement, 12 emplacements.
