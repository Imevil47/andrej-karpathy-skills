# Cadences MO Grattage — Rapport de livraison v2.0

Fichier de depart : `Cadences MO Grattage v1.3` (conserve intact sous
`Cadences MO Grattage v1.3 - ORIGINAL.xlsx`).

## Fichiers livres

| Fichier | Usage |
|---|---|
| `Cadences MO Grattage v2.0.xlsx` | **Fichier de production.** Structure complete, aucune donnee de test. |
| `Cadences MO Grattage v2.0 - DEMO.xlsx` | Meme fichier, rempli avec les scenarios de validation A a E. Sert a verifier le comportement, pas a produire. |
| `Cadences MO Grattage v1.3 - ORIGINAL.xlsx` | Sauvegarde du fichier d'origine, non modifie. |
| `scripts/` | Code Python (openpyxl) qui genere le classeur, pour maintenance ulterieure. |

## 1. Feuilles creees

1. **PARAMETRES** — seuils et libelles de statut configurables, 13 listes de reference
   (LIGNE, ESPECE, PRODUIT, MARQUE, FORMAT, PREPARATION, MOULE, ACTIVITE, TOUR,
   MOTIF ARRET, TYPE DE TEST, STATUT RUN, OUI/NON), table STANDARDS a 7 dimensions,
   table EMPLOYES.
2. **RUNS** — un run = une configuration de production ; l'activite de chaque ligne
   L1 a L8 appartient au run (GRATTAGE / REMPLISSAGE / GRATTAGE + REMPLISSAGE / INACTIVE).
   Colonne de controle de coherence (ID en doublon, champ manquant, aucune ligne active).
3. **SAISIE CONTROLE** — feuille terrain. Le controleur choisit RUN / TOUR / LIGNE,
   saisit l'heure et l'effectif une seule fois, puis MATRICULE + NB BOITES par femme.
4. **BASE CONTROLES** — base historique permanente, une ligne = un controle d'une femme.
5. **SYNTHESE CONTROLES** — synthese L1 a L8 pour un RUN + TOUR.
6. **RECHERCHE MATRICULE** — historique et statistiques par employe, avec filtres.
7. **TEST RENDEMENT** — tests ponctuels de rendement matiere, historises.
8. **ARRETS** — journal d'arrets simplifie.

## 2. Feuilles remplacees

| v1.3 | Devenue |
|---|---|
| `Fiche Jour` (4 lignes en dur, saisie par ligne) | `SAISIE CONTROLE` + `SYNTHESE CONTROLES` + `ARRETS` |
| `Suivi Mensuel` (300 lignes de formules, aucune donnee) | `BASE CONTROLES` |
| `PARAMETRES` | `PARAMETRES` (enrichie) |

`Suivi Mensuel` et `Fiche Jour` ne contenaient **aucune donnee historique reelle** :
seules des formules et un jeu de demonstration du 17/08/2026. Rien n'a donc ete perdu.
Les elements utiles ont ete repris :

- standard 112 boites/h/femme pour FMHOEV BIO (ligne migree dans la table STANDARDS,
  **a confirmer** : espece, preparation et activite ont ete deduites) ;
- seuil d'alerte 0,90 (devenu `SeuilSurveiller`, le nom `SeuilAlerte` reste valide) ;
- liste des motifs d'arret (reprise et completee) ;
- identite visuelle (Arial, bandeau `0A0F1A`, en-tetes orange / turquoise,
  cellules de saisie creme et police bleue, codes couleur des statuts).

## 3. Logique corrigee

| Probleme v1.3 | Correction |
|---|---|
| `ListeLignes` = `#REF!` (liste des lignes cassee) | Nom recree sur la table `T_LIGNES`, L1 a L8 |
| `Fiche Jour!F29` (cadence MO globale) pointait sur `J25:K28`, colonnes **vides** : la cadence globale restait toujours vide | Cadence MO recalculee partout comme `TOTAL BOITES / TOTAL HEURES-FEMMES MESUREES` |
| Cadence de ligne = moyenne arithmetique implicite | Productivite ponderee reelle (`SYNTHESE CONTROLES`, colonne CADENCE MO) |
| Duree supposee par tour, effectif saisi ligne par ligne | Duree = intervalle reel entre deux controles du **meme matricule** |
| Aucun controle de doublon | Detection sur RUN + TOUR + LIGNE + MATRICULE, exclusion des totaux |
| Standard saisi/recopie manuellement | Recherche automatique sur 7 dimensions depuis PARAMETRES |
| Plages figees `A3:M302` | Tables Excel (`T_BASE`, `T_RUNS`, `T_TESTS`, `T_ARRETS`, ...) qui s'etendent |
| Calcul iteratif active (`iterateDelta`) | Supprime |

Passage de minuit gere dans `BASE CONTROLES` (duree mesuree) et dans `ARRETS` (duree).

## 4. Noms definis

Repare : `ListeLignes`. Conserves : `ListeProduits`, `ListeMotifs`, `SeuilAlerte`.
Ajoutes : `ListeEspeces`, `ListeMarques`, `ListeFormats`, `ListePreparations`,
`ListeMoules`, `ListeActivites`, `ListeTours`, `ListeTypesTest`, `ListeStatutsRun`,
`ListeOuiNon`, `ListeMatricules`, `ListeRuns`, `NomsEmployes`, `MatriculesEmployes`,
`SeuilConforme`, `SeuilSurveiller`, et les six libelles de statut
(`StatutConforme`, `StatutSurveiller`, `StatutSousStandard`, `StatutInitial`,
`StatutStandardManquant`, `StatutDoublon`).

Aucun `#REF!`, aucun lien externe, aucune macro.

## 5. Calculs cles

- `DUREE MESUREE MIN = (HEURE - HEURE CONTROLE PRECEDENT) x 1440`, passage de minuit gere.
- `CADENCE = NB BOITES x 60 / DUREE MESUREE MIN` (boites/h/femme).
- `ATTEINTE % = CADENCE / STANDARD`.
- `CADENCE MO LIGNE = TOTAL BOITES CONTROLEES / TOTAL HEURES-FEMMES MESUREES`.
- `COUVERTURE % = FEMMES CONTROLEES / EFFECTIF PRESENT`.
- `RENDEMENT % = QUANTITE SORTIE KG / QUANTITE MP KG`.

Le premier controle d'un matricule n'a pas d'intervalle : statut `CONTROLE INITIAL`,
aucune cadence inventee.

## 6. Validation effectuee

34 533 formules recalculees, **0 erreur** (aucun `#REF!`, `#DIV/0!`, `#N/A`, `#VALUE!`).

| Scenario | Resultat obtenu |
|---|---|
| A — Sardine FMHOEV BIO / HGT, 3 lignes, 3 tours | Tour 01 = `CONTROLE INITIAL` ; tour 02 duree 58 min ; M001 : 112 x 60 / 58 = **115,9** boites/h/femme, atteinte 103,4 %, `CONFORME` |
| B — Maquereau, MOULE 1, lignes separees | L1/L2 `GRATTAGE` -> standard **90** ; L3/L4 `REMPLISSAGE` -> standard **130** ; l'analyse grattage ne retient que L1 et L2 |
| C — Matricule saisi deux fois (M005, meme run/tour/ligne) | Signale `MATRICULE DEJA CONTROLE`, statut `DOUBLON`, **exclu** du total (1 244 boites, pas 1 339) |
| D — Ligne incomplete (L2, tour 02) | `10 / 12`, couverture **83,3 %** |
| E — Test rendement 10,000 kg -> 7,800 kg | **78,0 %** |

## 7. Limites connues

1. **Horodatage.** Sans macro ni Apps Script, un horodatage fige et automatique est
   impossible dans un `.xlsx`. Aucun `NOW()` volatil n'a ete utilise. L'heure est
   saisie **une fois par TOUR et par LIGNE** dans `SAISIE CONTROLE` et se reporte sur
   toutes les femmes de la ligne : l'intervalle entre deux tours reste donc reel.
   La structure est prete pour un horodatage automatique en Google Sheets / Apps Script.
2. **Transfert vers la base.** Sans macro, le passage de `SAISIE CONTROLE` vers
   `BASE CONTROLES` se fait par copie du bloc de transfert puis
   *Collage special > Valeurs* (meme principe que le bloc EXPORT de la v1.3).
   Aucune information n'est ressaisie.
3. **Recherche du standard : correspondance exacte** des 7 dimensions
   (ESPECE, PRODUIT, MARQUE, FORMAT, PREPARATION, MOULE, ACTIVITE). Il faut une ligne
   STANDARDS par configuration reellement produite ; sinon le statut affiche
   `STANDARD MANQUANT` plutot qu'un chiffre approximatif.
4. **Volume.** 2 000 lignes de `BASE CONTROLES` sont pre-formulees, les formules de
   synthese balayent jusqu'a 50 000 lignes. La recherche du controle precedent et la
   detection de doublon regardent les **900 derniers controles** (largement plus d'une
   journee : 8 lignes x 13 femmes x 8 tours = 832). Au-dela de 50 000 controles,
   archiver par annee dans un nouveau fichier.
5. **Cellules calculees non protegees**, conformement a la demande : la protection
   sera posee apres les essais terrain.
6. Le classeur ne contient **aucune valeur mise en cache** : Excel recalcule tout a
   l'ouverture (`fullCalcOnLoad`). Un apercu hors Excel peut afficher des cellules vides.

## 8. Etapes manuelles restantes

1. **PARAMETRES > EMPLOYES** : saisir la liste reelle des matricules et des noms.
   Tant qu'elle est vide, les listes deroulantes de matricule sont vides.
2. **PARAMETRES > LISTES DE REFERENCE** : completer MARQUE, FORMAT et MOULE
   (laissees vides, aucune valeur reelle n'etait disponible dans la v1.3).
3. **PARAMETRES > STANDARDS** : confirmer la ligne migree
   `SARDINE / FMHOEV BIO / GRATTAGE + REMPLISSAGE / 112` (espece, preparation et
   activite ont ete deduites) et ajouter une ligne par configuration produite.
4. **PARAMETRES > SEUILS** : valider `SEUIL CONFORME = 100 %` et
   `SEUIL A SURVEILLER = 90 %`.
5. **RUNS** : creer le premier run avec un `ID RUN` unique et stable
   (ex. `RUN-20260905-01`) ; cet identifiant relie tout l'historique, ne jamais le modifier apres coup.

## 9. Ameliorations recommandees (non realisees, hors perimetre)

1. Migration vers Google Sheets + Apps Script pour l'horodatage automatique fige et
   l'ecriture directe de `SAISIE CONTROLE` vers `BASE CONTROLES` (supprime le collage special).
2. Saisie sur telephone via un formulaire (Google Forms / AppSheet) alimentant
   directement `BASE CONTROLES`.
3. Vue hebdomadaire ou mensuelle par employe et par produit, une fois quelques
   semaines d'historique accumulees.
4. Rapprochement `ARRETS` / `BASE CONTROLES` pour deduire les arrets de la duree
   mesuree (aujourd'hui la duree est brute).
5. Protection des feuilles et des cellules calculees apres validation terrain.
