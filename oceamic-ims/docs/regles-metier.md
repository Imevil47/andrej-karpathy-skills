# Règles métier — OCEAMIC IMS Phases 1 à 6

Ce document décrit le comportement attendu du système. Chaque règle est appliquée côté
serveur (service, transaction ou contrainte de base) et non seulement dans l'interface.

---

## 1. Modèle conceptuel

| Concept | Signification | Table |
|---|---|---|
| Lot | Identité de la matière première | `raw_material_lots` |
| Réception | Événement d'entrée | `raw_material_receptions` |
| Mouvement | Changement de quantité ou d'emplacement | `stock_movements` |
| Emplacement | Où se trouve la marchandise | `locations` |
| Contrôle qualité | Observation, mesure | `quality_inspections` |
| Décision qualité | Décision métier | `quality_decisions` |
| Blocage | Restriction opérationnelle | `lot_blocks` |
| Sous-traitance | Opération externe traçable | `subcontracting_operations` |
| Audit | Qui a fait quoi, et quand | `audit_log` |

Ces concepts ne sont jamais fusionnés dans une même table.

---

## 2. Calcul de l'inventaire

Le stock n'est **jamais** stocké dans une colonne. Il est calculé à partir du registre
des mouvements :

```
Stock (LOT, EMPLACEMENT) =
    Σ quantités des mouvements dont destination = EMPLACEMENT
  − Σ quantités des mouvements dont source      = EMPLACEMENT
```

- Une quantité est **toujours positive** ; le sens vient des emplacements source et
  destination, jamais d'un signe saisi.
- Les quantités sont des `NUMERIC(14,3)` kilogrammes, transportées sous forme de chaînes
  et comparées en grammes entiers : aucune valeur d'inventaire ne transite par un nombre
  à virgule flottante.
- Aucun écran ne permet de modifier un « stock actuel ». Une correction passe forcément
  par un mouvement.

Vues utilisées : `current_stock_by_lot_location`, `current_stock_by_lot`,
`available_stock`, `internal_stock_summary`, `external_stock_summary`.

---

## 3. Stock interne et stock externe

Il n'existe **qu'un seul moteur d'inventaire**. Le caractère interne ou externe d'une
quantité est déduit de `locations.stock_type` :

```
LOT-001   OCEAMIC 2   3 000 kg   INTERNE
LOT-001   DAMSA       2 000 kg   EXTERNE
          Total lot   5 000 kg
```

L'opérateur ne saisit jamais « type de stock » sur une transaction : choisir
l'emplacement suffit. Un transfert déplace la quantité, il ne la duplique pas.

---

## 4. Validation des sorties de stock

Avant toute opération sortante :

1. Le service prend un verrou de transaction sur le couple (lot, emplacement source)
   — `pg_advisory_xact_lock`.
2. Il lit le stock disponible **après** le verrou.
3. Si `quantité demandée > stock disponible`, la transaction est annulée et l'erreur
   suivante est renvoyée :

```
Stock insuffisant.
Disponible : 3 000,000 kg
Demandé : 4 000,000 kg
```

Le verrou étant conservé jusqu'à la fin de la transaction, deux opérations concurrentes
sur le même lot et le même emplacement sont sérialisées : elles ne peuvent pas créer
ensemble un stock négatif. Un test automatisé vérifie ce comportement en lançant deux
transferts simultanés.

Autres validations : quantité strictement positive, source différente de la destination,
emplacement de destination actif et autorisé à recevoir.

---

## 5. Réception

La réception est orchestrée en **une seule transaction** :

1. création du lot (ou sélection d'un lot existant) ;
2. création de la réception ;
3. création du mouvement de stock entrant ;
4. création du contrôle qualité rapide, s'il est renseigné ;
5. mise à jour du statut dérivé du lot ;
6. écriture de l'audit.

En cas d'échec d'une étape, l'ensemble est annulé : aucun lot orphelin, aucune réception
sans mouvement, aucun mouvement partiel.

**Règle camion / lot.** L'écran de réception permet de créer le lot sur place : un camion
qui constitue une unité tracée séparément donne un nouveau lot, sans avoir à passer par
un autre écran. Rattacher la réception à un lot existant reste possible quand le cas
métier le justifie. Le code lot peut être saisi ou généré automatiquement.

**Non-duplication.** Fournisseur, bateau et marée sont saisis une seule fois sur l'écran
de réception ; quand un nouveau lot est créé, il en hérite.

---

## 6. Types de mouvements et règles de direction

| Type | Source | Destination | Motif |
|---|---|---|---|
| `RECEPTION` | — | obligatoire | — |
| `TRANSFERT` | obligatoire | obligatoire, ≠ source | — |
| `SOUS_TRAITANCE` | obligatoire | obligatoire | — |
| `RETOUR` | obligatoire | obligatoire | — |
| `CONSOMMATION` | obligatoire | libre | — |
| `PERTE` | obligatoire | — | obligatoire |
| `AJUSTEMENT` | au moins un des deux | | obligatoire |
| `FRACTIONNEMENT` | selon le sens | | — |

`CONSOMMATION` est prévu pour le futur module production : le type et les contrôles
existent, mais aucun flux de consommation n'est construit en Phase 1.

L'ajustement de stock est réservé au rôle ADMIN, exige un motif et est audité. Ce n'est
pas un raccourci de correction quotidienne.

---

## 7. Fractionnement de lot

Un lot parent peut être fractionné en lots enfants (`parent_lot_id`). La quantité n'est
pas dupliquée : le fractionnement produit deux mouvements dans le même registre — une
sortie du lot parent et une entrée du lot enfant, au même emplacement. La généalogie
reste consultable depuis la situation du lot.

---

## 8. Sous-traitance

### Mode `STOCK_EXISTANT`

Le lot source et l'emplacement source sont obligatoires. Le stock disponible est
vérifié, puis un mouvement déplace la quantité de l'emplacement OCEAMIC vers
l'emplacement du sous-traitant :

```
Avant :  OCEAMIC 2      5 000 kg
Envoi :  1 500 kg
Après :  OCEAMIC 2      3 500 kg
         SOUS-TRAITANT  1 500 kg
```

La quantité n'a pas disparu, elle a changé d'emplacement.

### Mode `FOURNISSEUR`

La marchandise va directement du fournisseur au sous-traitant. **Aucun stock OCEAMIC
existant n'est diminué** — la base l'interdit structurellement (`source_location_id` doit
être vide dans ce mode). La marchandise, propriété d'OCEAMIC, entre dans l'inventaire
comme stock externe détenu chez le sous-traitant. Aucun faux mouvement de sortie
d'OCEAMIC 2 n'est créé.

### Résultats

Une opération peut produire plusieurs résultats, chacun avec sa quantité, sa qualité, son
calibre, sa destination et son lot (lot source conservé ou lot enfant créé) :

```
Envoyé :  10 000 kg
Résultats :  A 6 000 kg · B 2 500 kg · C 1 000 kg · PERTE 500 kg
```

Chaque résultat génère ses propres mouvements et est soumis au contrôle de stock
disponible chez le sous-traitant : on ne peut pas déclarer plus de résultats que de
marchandise présente.

### Bilan matière

```
Écart = quantité envoyée − Σ quantités des résultats
```

Le bilan est calculé par la vue `subcontracting_material_balance` et affiché sur
l'opération. En Phase 1 la tolérance est nulle : tant que l'écart n'est pas nul, l'écran
affiche « Écart matière à justifier ». Aucune différence n'est ignorée silencieusement.
Une tolérance paramétrable pourra être ajoutée sans changer le calcul.

---

## 9. Qualité : mesure et décision

Une mesure n'est pas une décision.

- `quality_inspections` enregistre des **observations** : température, histamine, ABVT,
  qualité et calibre observés, résultat CONFORME / NON_CONFORME / A_SURVEILLER. Tous les
  champs de mesure sont facultatifs, car les types de contrôle diffèrent.
- `quality_decisions` enregistre des **décisions** : ACCEPTE, ACCEPTE_SOUS_RESERVE,
  BLOQUE, REJETE, RECONTROLE_REQUIS, LIBERE, avec motif obligatoire, auteur et date.

Une décision ne modifie **jamais** une mesure historique.

---

## 10. Blocage d'un lot

Un lot bloqué reste physiquement présent en stock. Le système distingue donc :

| Notion | Signification |
|---|---|
| Stock physique | Ce qui est réellement présent |
| Stock bloqué | La part immobilisée par la Qualité |
| Stock disponible | Ce qui peut être utilisé |

La Phase 1 bloque le **lot entier** : un lot bloqué a un stock disponible nul.

Opérations refusées sur un lot bloqué :

- `CONSOMMATION`
- `SOUS_TRAITANCE`
- l'expédition, lorsque le module correspondant sera ajouté (aucun type d'expédition
  n'existe en Phase 1)

Message affiché :

```
Opération impossible.
Ce lot est bloqué par le service Qualité.
```

**Transferts entre emplacements de stockage : autorisés.** Un lot bloqué doit rester
physiquement déplaçable (saturation d'une chambre froide, mise en quarantaine physique,
retour d'un entrepôt externe). Le transfert ne consomme ni ne livre la marchandise et ne
lève donc pas la restriction qualité. L'écran de transfert affiche explicitement que le
lot est bloqué. La perte et l'ajustement restent également possibles, la première pour
tracer une destruction, le second sous droit administrateur avec motif et audit.

Aucun contournement silencieux n'est possible : il n'existe pas de bouton « forcer ».

---

## 11. Levée d'un blocage

La levée est un événement auditable, jamais une simple modification de statut :

```
Lot bloqué → contrôle / recontrôle → décision qualité LIBERE → blocage clôturé
```

Dans une seule transaction : la décision qualité est enregistrée, le blocage actif passe
en `LEVE` avec sa date, son auteur et son motif de levée, et le statut dérivé du lot est
recalculé.

L'historique conserve : qui a bloqué, quand, pourquoi, sur quel contrôle, puis qui a levé,
quand et pourquoi. Aucune ligne n'est supprimée.

Seuls les rôles disposant de `quality:release` (QUALITE, ADMIN) peuvent libérer un lot.
Le rôle STOCK reçoit une erreur 403, y compris en appelant directement l'API.

---

## 12. Statut du lot

`raw_material_lots.status` est un **état dérivé**, recalculé après chaque opération :

| Condition | Statut |
|---|---|
| Blocage qualité actif | `BLOQUE` |
| Lots enfants et stock nul | `FRACTIONNE` |
| Mouvements existants et stock nul | `EPUISE` |
| Sinon | `ACTIF` |

La vérité du blocage reste `lot_blocks`, la vérité des quantités reste `stock_movements`.
Le statut ne fait que les refléter, afin que les listes et les filtres restent rapides.

---

## 13. Politique de suppression et de correction

Aucun enregistrement opérationnel n'est supprimé physiquement.

- **Mouvements de stock** : immuables. Une erreur est corrigée par un mouvement
  d'annulation de type `AJUSTEMENT`, de référence `ANNULATION`, qui reprend la quantité
  d'origine en inversant source et destination et qui pointe vers le mouvement annulé
  (`reverses_movement_id`). Un mouvement ne peut être annulé qu'une seule fois ; l'erreur
  et sa correction restent toutes deux visibles dans l'historique du lot. Droit requis :
  `stock:reverse` (ADMIN).
- **Opérations de sous-traitance** : statut `EN_COURS`, `CLOTURE` ou `ANNULE`.
- **Blocages qualité** : statut `ACTIF`, `LEVE` ou `ANNULE`.
- **Données de référence** : désactivées via `is_active`.

Les états de workflow ne sont ajoutés que là où ils ont un sens métier ; les autres tables
n'en portent pas.

---

## 14. Transactions

Toute opération touchant plusieurs tables s'exécute dans une transaction unique :

| Opération | Écritures |
|---|---|
| Réception | lot, réception, mouvement, contrôle facultatif, statut, audit |
| Sous-traitance sur stock existant | vérification du stock, opération, mouvement, statut, audit |
| Résultat de sous-traitance | résultat, lot enfant éventuel, mouvements, statut, audit |
| Décision de blocage | décision, blocage, statut, audit |
| Libération | décision, clôture du blocage, statut, audit |
| Annulation de mouvement | mouvement inverse, audit |

Un échec à n'importe quelle étape annule l'ensemble.

---

## 15. Rôles

| Permission | ADMIN | QUALITE | STOCK | PRODUCTION | LECTURE |
|---|:--:|:--:|:--:|:--:|:--:|
| Consultation (stock, lots, qualité, traçabilité) | ✓ | ✓ | ✓ | ✓ | ✓ |
| Réception | ✓ | | ✓ | | |
| Transfert, perte | ✓ | | ✓ | | |
| Logistique de sous-traitance | ✓ | | ✓ | | |
| Contrôle qualité | ✓ | ✓ | | | |
| Décision qualité, blocage | ✓ | ✓ | | | |
| **Libération d'un lot** | ✓ | ✓ | | | |
| Ajustement de stock | ✓ | | | | |
| Annulation de mouvement | ✓ | | | | |
| Données de référence, utilisateurs | ✓ | | | | |

Les permissions sont vérifiées côté serveur à chaque appel. L'interface masque
simplement ce qui n'est pas autorisé.

---

## 16. Audit

Sont tracés au minimum : ajustements de stock, réceptions, créations et fractionnements
de lot, transferts, pertes, annulations, décisions qualité, blocages, libérations,
opérations et résultats de sous-traitance, créations et désactivations de données de
référence.

Chaque entrée contient l'auteur, la date, l'action, l'entité concernée et les valeurs
utiles au format `JSONB`. Aucun mot de passe, jeton ou secret n'est écrit dans l'audit.


---

# Phase 2 — Production

## 17. Modèle conceptuel de production

| Concept | Signification | Table |
|---|---|---|
| Ordre de production (Run) | Contexte de transformation | `production_runs` |
| Consommation | Quel lot a été consommé, et combien | `production_run_materials` |
| Sortie de production | Matière générée par le Run | `production_outputs` |
| Perte / sous-produit / rework / reclassement | Disposition explicite de la matière | `production_outputs` (typé) |
| Bilan matière | Réconciliation calculée | `production_run_material_balance` |
| Rendement | Indicateur calculé | `production_run_yield` |

Un Run ne contient **ni quantité ni identité de lot**. Un lot de matière première reste
la seule identité de la matière ; le Run ne la duplique jamais.

## 18. Relation Run ↔ lot

La relation est **plusieurs-à-plusieurs** :

- un Run consomme plusieurs lots (LOT-A 3 000 kg + LOT-B 2 500 kg + LOT-C 500 kg) ;
- un lot alimente plusieurs Runs (LOT-A → RUN-001 2 000 kg, RUN-002 1 500 kg).

Chaque consommation est une ligne datée : l'opérateur n'a jamais à consolider
manuellement plusieurs prises de matière.

## 19. Entrée matière

```
Entrée MP du Run = Σ quantités des consommations VALIDÉES
```

Cette quantité n'est jamais saisie. L'écran ne propose aucun champ « Entrée MP » :
la ressaisie d'une valeur déjà connue par les consommations est structurellement
impossible.

## 20. Intégration au stock

La production **n'a pas d'inventaire propre**. Une consommation crée un mouvement
`CONSOMMATION` du registre `stock_movements` de la Phase 1, avec
`reference_type = 'PRODUCTION'` et l'identifiant du Run. Le stock n'est jamais
décrémenté ailleurs.

Une consommation validée exécute, dans **une seule transaction** :

1. validation du Run (un Run terminé ou annulé n'accepte plus de saisie) ;
2. validation du lot ;
3. contrôle du blocage qualité ;
4. contrôle du stock disponible, sous verrou (lot + emplacement) ;
5. création du mouvement de stock ;
6. création de la ligne de consommation ;
7. mise à jour du statut dérivé du lot ;
8. écriture de l'audit.

Un échec à n'importe quelle étape annule l'ensemble : ni ligne de consommation
orpheline, ni mouvement partiel.

## 21. Lots bloqués en production

Le blocage qualité de la Phase 1 s'applique tel quel : `CONSOMMATION` fait partie des
opérations interdites sur un lot bloqué. La production ne dispose d'aucune vérité
qualité parallèle et d'aucun contournement.

```
Opération impossible.
Ce lot est bloqué par le service Qualité.
```

## 22. Stock insuffisant et concurrence

La règle et le message de la Phase 1 s'appliquent sans modification. Le verrou de
transaction pris sur le couple (lot, emplacement) sérialise deux consommations
simultanées : elles ne peuvent pas créer ensemble un stock négatif. Un test automatisé
le vérifie en lançant deux consommations en parallèle.

## 23. Catégories de sortie

Toute matière quittant la transformation est déclarée dans un registre unique et typé.
Ces catégories ne sont **pas** équivalentes :

| Catégorie | Signification |
|---|---|
| `SORTIE_UTILE` | Matière utile pour la suite du flux prévu |
| `SOUS_PRODUIT` | Matière séparée du flux principal, potentiellement valorisable |
| `REWORK` | Matière destinée à réintégrer un process de production |
| `RECLASSEMENT` | Matière toujours utilisable, orientée vers un autre grade ou une autre destination |
| `PERTE_REELLE` | Matière définitivement perdue pour le flux prévu, motif obligatoire |
| `AUTRE` | Disposition marginale, à documenter |

Un reclassement ne devient jamais automatiquement une perte : sa catégorie et sa
destination sont conservées telles quelles.

Le rework est enregistré comme une catégorie distincte, jamais additionné à la sortie
utile. Les colonnes `derived_lot_id` et `destination_location_id` existent pour que la
généalogie d'un rework consommé par un Run ultérieur reste possible sans refonte.

**Un seul registre, pas deux tables.** Les listes « types de sortie » et « types de
perte » de la spécification se recouvrent presque entièrement (sous-produit, rework,
reclassement figurent dans les deux). Deux tables auraient signifié deux sources pour
la même catégorie et deux sommes dans le bilan. Les deux écrans opérationnels restent
distincts — « Enregistrer une sortie » et « Déclarer une perte » — mais écrivent dans
le même registre.

## 24. Bilan matière

```
Écart matière = Entrée MP
              − (Sortie utile + Sous-produits + Rework + Reclassement + Pertes réelles + Autre)
```

L'écart est **calculé**, jamais saisi et jamais enregistré comme une perte. Il est
également exprimé en pourcentage de l'entrée matière.

Statut dérivé du bilan, jamais choisi par un utilisateur :

| Statut | Condition |
|---|---|
| `EQUILIBRE` | Écart exactement nul |
| `A_CONTROLER` | Écart ≤ 0,50 % de l'entrée matière |
| `ECART_A_JUSTIFIER` | Écart > 0,50 %, ou sorties déclarées sans entrée matière |

Le seuil de 0,50 % est défini une seule fois, dans la vue
`production_run_material_balance`.

## 25. Rendement matière

```
Rendement matière = Sortie utile / Entrée MP × 100
```

Exemple : 6 100 kg de sortie utile pour 10 000 kg consommés donnent 61,00 %.

Le dénominateur est la consommation validée, jamais un poids d'entrée ressaisi. Le
numérateur ne compte **que** la sortie utile : sous-produits, rework, reclassements,
pertes réelles et écart inexpliqué en sont exclus. Le calcul est fait en base ; aucun
écran ne permet de saisir un rendement.

Le rendement attendu par produit, calibre ou type de traitement n'est pas encore
paramétré : la formule vit dans une vue dédiée, à laquelle des standards pourront être
rattachés plus tard sans migration des données existantes.

## 26. Clôture d'un Run

Un Run ne se termine pas à l'aveugle. La clôture est refusée lorsque :

- aucune matière première n'a été consommée ;
- le bilan matière est en `ECART_A_JUSTIFIER` et l'écart n'a pas été justifié.

C'est l'option la plus sûre parmi celles proposées par la spécification : la
justification est un enregistrement daté et signé (`difference_justification`,
`justified_by`, `justified_at`), audité, et non une simple case cochée. Une fois
justifié, l'écart reste visible dans le bilan avec son auteur et sa date.

Un Run terminé ou annulé n'accepte plus aucune nouvelle saisie de consommation, de
sortie ou de perte.

## 27. Annulation d'un Run

Un Run validé n'est jamais supprimé. L'annulation :

1. crée un mouvement d'annulation pour **chaque** consommation encore valide, ce qui
   restitue la matière première à son emplacement d'origine ;
2. annule les sorties encore valides ;
3. passe le Run en `ANNULE` avec un motif obligatoire ;
4. écrit l'audit.

L'historique complet reste consultable.

## 28. Correction d'une consommation

Une consommation validée n'est jamais modifiée. La correction :

1. crée un mouvement d'annulation qui restitue la quantité initiale ;
2. marque la ligne d'origine `ANNULE` avec son auteur et son motif ;
3. crée, si une quantité corrigée est fournie, une nouvelle ligne de consommation ;
4. relie les deux lignes (`replaces_id`) et écrit l'audit.

Exemple : 2 000 kg saisis, 1 800 kg réels. L'original reste visible en `ANNULE`, la
consommation effective devient 1 800 kg, le stock est recalculé en conséquence, et
l'audit conserve les deux opérations. La même logique s'applique aux sorties et aux
pertes validées.

## 29. Traçabilité de production

La traçabilité relie les lots d'entrée à l'événement de transformation :

- **Amont** : depuis un Run, l'onglet « Traçabilité » liste tous les lots consommés,
  leur emplacement source et la quantité prise sur chacun.
- **Aval** : depuis la « Situation du lot », la section « Runs consommateurs » liste
  tous les Runs qui ont consommé ce lot, avec la quantité, la date et le produit.

La vue `lot_production_usage` est la source unique de ces deux lectures. La recherche
globale atteint également les codes de Run.

## 30. Audit de production

Sont tracés : création, démarrage, clôture et annulation d'un Run, consommation de
matière, correction de consommation, création et annulation d'une sortie ou d'une
perte, et justification d'un écart matière. Chaque entrée conserve l'auteur, la date et
les valeurs utiles.

## 31. Rôles de production

| Permission | ADMIN | PRODUCTION | STOCK | QUALITE | LECTURE |
|---|:--:|:--:|:--:|:--:|:--:|
| Consultation production | ✓ | ✓ | ✓ | ✓ | ✓ |
| Créer / démarrer / terminer / annuler un Run | ✓ | ✓ | | | |
| Consommer de la matière première | ✓ | ✓ | | | |
| Enregistrer sorties et pertes | ✓ | ✓ | | | |
| Corriger une consommation ou une sortie | ✓ | ✓ | | | |
| Justifier un écart matière | ✓ | ✓ | | | |

Le rôle STOCK voit l'usage de son stock en production mais ne saisit aucun
enregistrement de production. Le rôle QUALITE consulte les Runs et la généalogie
matière ; les contrôles qualité en cours de process viendront plus tard.


---

# Phase 3 — Main-d'œuvre, cadence et arrêts

## 32. Modèle conceptuel de la cadence

| Concept | Signification | Table |
|---|---|---|
| Employée | Personnel de production, identifiée par son matricule | `employees` |
| Affectation | Qui est attendu et présent sur quelle ligne du Run | `production_run_employee_assignments` |
| Tour de contrôle | Un passage du contrôleur sur le terrain | `control_rounds` |
| Contrôle de ligne | Une ligne visitée pendant un tour | `line_controls` |
| Contrôle de cadence | Une mesure individuelle réelle | `employee_cadence_controls` |
| Standard de cadence | Référence de performance attendue | `cadence_standards` |
| Arrêt | Interruption de production | `downtime_events` |

**Une mesure de cadence n'existe jamais hors contexte.** Elle est toujours rattachée à
un Run, une ligne du Run, un tour de contrôle et une employée ; il n'existe aucune
saisie de cadence indépendante.

## 33. Saisie terrain minimale

L'écran de tour de contrôle ne demande jamais deux fois la même information (section 48
de la spécification) : le contrôleur sélectionne le Run puis démarre un tour, choisit une
ligne, saisit un matricule et une quantité, puis passe à l'employée suivante. Produit,
espèce, activité de la ligne, nom de l'employée, standard applicable et horodatage sont
tous déjà connus du système et ne sont jamais ressaisis. Après une saisie valide, le
focus revient automatiquement sur le prochain matricule à contrôler.

## 34. Configuration flexible de l'activité par Run

L'activité de main-d'œuvre n'est **jamais** un modèle unique imposé par l'espèce. Elle
est lue exclusivement via `production_run_lines.activity_type`, configurée par Run (déjà
en Phase 2) :

- process sardine : une seule ligne `GRATTAGE_REMPLISSAGE`, une employée y combine les
  deux gestes — un seul contrôle de cadence par employée, jamais deux ;
- process maquereau : des lignes séparées `GRATTAGE` et `REMPLISSAGE`, chacune avec son
  propre effectif et ses propres contrôles.

Aucune colonne d'activité n'existe sur l'affectation de personnel ni sur le contrôle de
cadence : les deux lisent toujours l'activité de la ligne du Run, ce qui rend une
divergence entre l'activité affichée et l'activité réelle structurellement impossible.

## 35. Personnel du Run

Une employée est affectée à une ligne active du Run, avec un statut de présence courant.
Le nombre de personnes par ligne est **toujours variable**, jamais une constante.

**Déplacement entre lignes.** Affecter une employée déjà ouverte sur une autre ligne du
même Run ferme l'affectation en cours (`assigned_until = now()`) puis en ouvre une
nouvelle : l'historique n'est jamais réécrit. Les contrôles de cadence déjà enregistrés
restent liés à la ligne où ils ont réellement eu lieu, même après le déplacement de
l'employée.

## 36. Tour de contrôle et contrôle de ligne

Un tour de contrôle regroupe les lignes visitées par un contrôleur en une seule passe.
Sélectionner une ligne pour la première fois crée son contrôle de ligne et **fige le
nombre d'employées attendues** (`expected_employee_count`) à partir des affectations
présentes à cet instant ; resélectionner la même ligne reprend son contrôle existant, sans
duplication. Un changement de présence après cet instant ne réécrit jamais ce nombre.

## 37. Formule de cadence individuelle

```
Cadence individuelle (par heure) = Quantité réalisée / (Durée de mesure en secondes / 3600)
```

La quantité et la durée réelle de mesure sont les deux seules valeurs saisies par le
contrôleur ; la cadence est **toujours calculée**, jamais tapée. Deux employées mesurées
sur des durées différentes (par exemple 10 et 5 minutes) restent comparables, chacune
ramenée à sa propre cadence horaire.

Exemple (scénario d'acceptation) : 18 boîtes en 10 minutes (600 s) → 18 / (600 / 3600) =
**108,00 / h**.

## 38. Formule de performance individuelle

```
Performance (%) = Cadence individuelle / Standard applicable × 100
```

Si aucun standard ne s'applique au moment de la mesure, la performance est **toujours
`NULL`**, jamais supposée à 100 % ni à aucune autre valeur par défaut ; l'interface
affiche « Standard non défini ». Le standard appliqué est figé sur la ligne au moment de
la mesure (`standard_cadence_snapshot`) : un changement ultérieur du standard dans les
données de référence ne réécrit **jamais** une performance déjà enregistrée (scénario
d'acceptation dédié).

Exemple : 108,00 / h mesurée contre un standard de 120,00 / h → 108 / 120 × 100 = **90,00 %**.

## 39. Statut de performance

Le statut affiché n'est jamais choisi ni tapé par l'écran ; il est calculé une seule
fois, côté serveur, à partir du pourcentage de performance :

| Statut | Condition |
|---|---|
| `CONFORME` | Performance ≥ 95 % |
| `A_SURVEILLER` | Performance ≥ 85 % et < 95 % |
| `SOUS_STANDARD` | Performance < 85 % |

Sans standard applicable, aucun statut n'est calculé (`NULL`). Les seuils vivent dans
une seule fonction (`performanceStatus`, `server/src/domain/types.ts`) que toutes les
routes réutilisent : aucun écran ne réimplémente la règle.

## 40. Correspondance d'un standard de cadence

La correspondance sélectionne le standard actif **le plus spécifique** au contexte de la
mesure (produit, espèce, activité, unité de mesure, format, pièces par boîte, date de
mesure), jamais le premier trouvé au hasard :

1. `activity_type` et `measurement_unit` doivent correspondre **exactement** — dimensions
   non facultatives de la correspondance ;
2. pour chacune des dimensions `product_id`, `species_id`, `format`, `pieces_per_can` : un
   standard portant `NULL` sur cette dimension s'applique à **toutes** les valeurs
   (générique), un standard portant une valeur ne s'applique qu'à cette valeur précise
   (spécifique) — un standard spécifique dont la valeur ne correspond pas au contexte est
   exclu ;
3. `valid_from` / `valid_to`, si renseignées, doivent couvrir la date de la mesure ;
4. `size_grade` est **toujours exclu** de la correspondance en Phase 3 : un Run peut
   consommer plusieurs lots de calibres différents, donc son contexte ne porte jamais un
   calibre unique et non ambigu ; un standard portant un `size_grade` ne peut donc jamais
   correspondre en Phase 3 ;
5. parmi les standards restants, le plus spécifique gagne, avec une pondération fixe —
   produit (8) > espèce (4) > format (2) > pièces par boîte (1), les points de chaque
   dimension renseignée s'additionnant ;
6. en cas d'égalité de spécificité, le standard **créé le plus récemment** gagne — jamais
   un choix silencieux ou aléatoire.

Cette règle vit dans une seule fonction (`findMatchingStandard`,
`server/src/services/cadence.ts`), jamais dupliquée.

## 41. Unités de mesure

La quantité mesurée peut être exprimée en `BOITES`, `PIECES`, `KG` ou `UNITES`, configurée
par standard. Un contrôle de cadence et le standard auquel il est comparé doivent porter
la **même unité** : la correspondance ne sélectionne jamais un standard d'unité différente.

## 42. Doublon et avertissement inter-lignes

Deux protections distinctes, jamais confondues :

- **Même employée, même ligne, même tour** : rejet **strict** au niveau base (index unique
  partiel `WHERE status = 'VALIDE'`) et service — un doublon ne peut jamais être enregistré,
  message :

  ```
  Ce matricule est déjà enregistré pour cette ligne dans ce tour de contrôle.
  ```

- **Même employée, ligne différente, même tour** : **avertissement confirmable**, jamais un
  blocage permanent — l'opérateur peut confirmer explicitement (une employée peut
  légitimement aider une autre ligne) :

  ```
  Attention.
  Le matricule 1054 est déjà enregistré sur la ligne L2 pour ce tour.
  ```

  Le second appel, avec confirmation explicite, enregistre la mesure normalement.

## 43. Couverture d'un contrôle de ligne

```
Couverture (%) = Employées contrôlées / Employées attendues × 100
```

- Affichée à la fois en fraction (`3 / 4`) et en pourcentage (`75,00 %`).
- `expected_employee_count = 0` : couverture `COMPLET`, sans division par zéro — rien
  n'était attendu, rien ne manque.
- Aucune mesure n'est jamais inventée pour une employée absente ou non contrôlée.
- Une couverture incomplète **ne rend jamais** la production elle-même non conforme :
  c'est un concept propre au contrôle de main-d'œuvre, sans effet sur le statut du Run
  ni sur son bilan matière.
- Une couverture incomplète **ne bloque jamais** la clôture d'une ligne ni d'un tour : le
  résultat incomplet est conservé tel quel, jamais masqué.

## 44. Cadence de ligne

```
Cadence de ligne (par heure) = Σ quantités réalisées du groupe / (Σ durées de mesure du groupe en secondes / 3600)
```

**Jamais** la moyenne des pourcentages ou des cadences individuelles : sommer des
pourcentages perd l'information de durée et de quantité réelle de chaque employée. La
formule ramène la production totale du groupe à ses heures de main-d'œuvre totales, ce qui
la rend directement comparable à un standard individuel même quand chaque employée a été
mesurée sur une durée différente.

## 45. Arrêts de production

Un arrêt est rattaché à un Run et, facultativement, à une seule de ses lignes (arrêt
localisé) ou à aucune (arrêt affectant tout le Run). Un arrêt ouvert a `ended_at = NULL` :
c'est l'**unique** source de vérité de « arrêt actif », il n'existe aucune colonne de
statut séparée qui pourrait s'en désynchroniser.

```
Durée de l'arrêt = Heure de fin − Heure de début
```

La durée est une colonne générée, calculée automatiquement à la clôture — jamais saisie.
Un arrêt encore ouvert n'a pas de durée stockée : l'interface calcule et rafraîchit une
durée écoulée à l'affichage, sans jamais écrire une valeur changeante en base à chaque
seconde.

**Les arrêts restent strictement séparés des contrôles de cadence** (section 40 de la
spécification) : une interruption ne modifie et n'ajuste jamais la quantité mesurée d'une
employée. Les deux registres sont indépendants, préparés pour un futur module d'OEE qui
les combinera sans en modifier le sens.

## 46. Correction d'un contrôle de cadence

Un contrôle de cadence validé n'est jamais modifié. La correction suit exactement la
même politique d'annulation-remplacement que la correction d'une consommation de
production (section 28) :

1. le contrôle d'origine passe `ANNULE`, avec son auteur et son motif — jamais
   supprimé ;
2. un contrôle de remplacement est créé si une quantité et une durée corrigées sont
   fournies, réutilisant le standard et son instantané d'origine ;
3. les deux lignes sont reliées (`replaces_id`), et l'audit conserve les deux
   opérations.

L'original reste consultable dans l'historique, marqué `ANNULE`.

## 47. Historique d'un standard de cadence

Un changement ultérieur d'un standard de cadence (nouvelle valeur, désactivation)
n'affecte **jamais** les performances déjà calculées : chaque contrôle de cadence porte
sa propre copie figée du standard appliqué au moment de la mesure
(`standard_cadence_snapshot`). Les colonnes générées `cadence_per_hour` et
`performance_percent` lisent cette copie, jamais la table `cadence_standards` en direct.

## 48. Historique et traçabilité de la cadence

- **Par employée** : la vue `employee_cadence_history` liste chaque mesure valide avec
  Run, produit, espèce, ligne, activité, cadence et performance déjà résolus.
- **Par ligne** : le résumé de ligne du Run affiche la présence courante, le dernier
  contrôle, la cadence de ligne, la performance et l'arrêt du jour.
- **Par Run** : les onglets « Contrôles horaires », « Cadence » et « Arrêts » de la
  situation du Run donnent la vue complète, en s'appuyant sur les mêmes vues de calcul
  que les écrans dédiés — aucune formule n'est dupliquée entre les écrans.

## 49. Audit de la cadence

Sont tracés : affectation et réaffectation de personnel, changement de présence,
création, clôture et annulation d'un tour de contrôle, clôture d'un contrôle de ligne,
contrôle de cadence et sa correction, démarrage et clôture d'un arrêt. Chaque entrée
conserve l'auteur, la date et les valeurs utiles.

## 50. Rôles de la cadence

| Permission | ADMIN | PRODUCTION | QUALITE | STOCK | LECTURE |
|---|:--:|:--:|:--:|:--:|:--:|
| Consultation (personnel, cadence, arrêts) | ✓ | ✓ | ✓ | ✓ | ✓ |
| Affecter le personnel du Run, changer la présence | ✓ | ✓ | | | |
| Démarrer / clôturer / annuler un tour de contrôle | ✓ | ✓ | | | |
| Saisir un contrôle de cadence, le corriger | ✓ | ✓ | | | |
| Déclarer et clôturer un arrêt | ✓ | ✓ | | | |
| Créer employées, standards de cadence, catégories d'arrêt | ✓ | | | | |

Le rôle QUALITE consulte la performance de main-d'œuvre mais ne saisit ni ne corrige
aucun contrôle de cadence : la cadence reste une responsabilité de production, la
qualité une consultation. Les données de référence (employées, standards, catégories
d'arrêt) suivent la même règle que produits, lignes et motifs de perte : création et
(dés)activation réservées à l'ADMIN.

## 51. Hors périmètre de la Phase 3

Explicitement non construits : OEE complet, paie, pointage RH, calcul de salaire,
produits finis, palettes, expédition, remplissage, sertissage, stérilisation, F0/CCP,
emballage, GMAO/maintenance, SPC avancé, prédiction et prévision par IA, tableaux de
bord complexes. Les tables de contrôle de cadence et d'arrêt sont conçues comme la
donnée source d'un futur module d'OEE, sans en porter le calcul.


---

# Phase 4 — Remplissage, sertissage, marquage, stérilisation, CCP et refroidissement

## 52. Modèle conceptuel du procédé aval

| Concept | Signification | Table |
|---|---|---|
| Opération de remplissage | Contexte de production du remplissage | `filling_operations` |
| Contrôle poids | Un événement d'échantillonnage | `filling_weight_controls` |
| Pesée | Une boîte réellement mesurée | `filling_weight_samples` |
| Opération de sertissage | Contexte de production du sertissage | `seaming_operations` |
| Contrôle sertissage | Inspection qualité d'un sertissage | `seaming_controls` |
| Marquage | Application/vérification traçable d'un code produit | `marking_events` |
| Cycle de stérilisation | Événement thermique | `sterilization_cycles` |
| Programme de stérilisation | Spécification de procédé contrôlée | `sterilization_programs` |
| Contrôle CCP | Décision critique de sécurité alimentaire | `ccp_controls` |
| Déviation | Écart documenté par rapport au procédé attendu | `process_deviations` |
| Refroidissement | Procédé de refroidissement post-stérilisation | `cooling_events` |

Ces concepts ne sont jamais fusionnés dans une même table. Chaque opération et chaque
contrôle reste rattaché à un Run existant : il n'existe aucun enregistrement de
remplissage, de sertissage, de marquage ou de stérilisation détaché d'un Run
(section 3).

## 53. Configuration, jamais codée en dur

Milieux de couverture, spécifications de remplissage, paramètres et spécifications de
sertissage, programmes de stérilisation et points de vérification de marquage sont des
données de référence configurables. Aucun seuil, aucune liste de milieux ou de
paramètres n'est écrit dans le code de l'application : toute évolution passe par
Paramètres, jamais par une migration.

## 54. Formule de classification d'une pesée

```
mesure < poids min      → SOUS_POIDS
poids min ≤ mesure ≤ poids max → CONFORME
mesure > poids max      → SURPOIDS
```

Le statut est une **colonne générée** en base à partir de la pesée et des limites
copiées sur la même ligne : le contrôleur ne le choisit jamais (section 12). Une
tolérance autour de min/max n'est **jamais** introduite automatiquement : Min et Max
restent les valeurs exactes configurées, tant qu'aucune tolérance n'est explicitement
ajoutée comme champ distinct (section 13).

Un contrôle poids ne peut s'ouvrir que si une spécification de remplissage active
correspond au produit (et, si renseignés, au format et aux pièces par boîte) : sans
limite configurée, il n'y a rien à comparer, et aucune limite par défaut n'est
inventée (section 8).

## 55. Résumé d'un contrôle poids

```
Poids moyen, poids minimum mesuré, poids maximum mesuré
Nombre sous-poids, nombre conformes, nombre surpoids
% sous-poids, % conforme, % surpoids
```

Ces valeurs sont **calculées** par la vue `filling_weight_control_summary`, jamais
saisies (section 14).

## 56. Statut d'un contrôle poids

Règle de conception explicitement documentée, cohérente avec la priorité de la
spécification : le sous-poids est le risque critique (section 15).

| Statut | Condition |
|---|---|
| `INCOMPLET` | Moins d'échantillons enregistrés que la taille configurée |
| `NON_CONFORME` | Au moins une boîte sous-poids |
| `A_CORRIGER` | Aucune boîte sous-poids, mais au moins une surpoids |
| `CONFORME` | Toutes les boîtes enregistrées dans la plage, et assez d'échantillons |

Le sous-poids déclenche toujours `NON_CONFORME`, jamais `A_CORRIGER` : c'est le risque
opérationnel prioritaire. Le surpoids reste visible (coût matière) sans être traité
comme le même niveau de risque. Ce statut de contrôle poids **n'est pas** automatiquement
un blocage qualité de lot : seule une règle explicitement configurée pourrait déclencher
une décision Qualité (section 16).

## 57. Résultat d'un contrôle sertissage

```
Aucune mesure enregistrée        → INCOMPLET
Au moins une mesure NON_CONFORME → NON_CONFORME
Toutes les mesures CONFORME      → CONFORME
```

Comme pour le contrôle poids, ce résultat est **calculé** (vue `seaming_control_result`),
jamais stocké ni saisi manuellement. Une mesure devient `NON_CONFORME` dès qu'elle
franchit la limite figée au moment de la mesure ; la mesure d'origine reste
intégralement conservée, jamais ajustée pour « corriger » le résultat (section 23).

## 58. Correspondance d'une spécification (remplissage et sertissage)

Même règle déterministe qu'en Phase 3 pour les standards de cadence : le plus
spécifique gagne, jamais un choix arbitraire.

- **Remplissage** : `product_id` obligatoire, `format` et `pieces_per_can` facultatifs
  (`NULL` = toutes les valeurs) ; spécificité `format` (2) + `pieces_per_can` (1).
- **Sertissage** : `seaming_parameter_id` obligatoire, `product_id` et `format`
  facultatifs ; spécificité `product_id` (2) + `format` (1).

Dans les deux cas : une dimension renseignée sur la spécification doit correspondre
exactement au contexte pour que la spécification s'applique ; la fenêtre de validité
(`valid_from`/`valid_to`), si renseignée, doit couvrir la date du contrôle ; en cas
d'égalité de spécificité, la spécification créée la plus récemment gagne.

## 59. Historique des spécifications

Un changement ultérieur d'une spécification de remplissage, de sertissage ou d'un
programme de stérilisation n'affecte **jamais** un contrôle déjà enregistré : chaque
contrôle poids, chaque mesure de sertissage et chaque cycle de stérilisation porte sa
propre copie figée des limites appliquées au moment de la mesure (`*_snapshot`). Les
colonnes générées de classification lisent ces copies, jamais la table de référence en
direct (section 54).

## 60. Marquage et sa vérification

Le marquage est codé (`marking_events`, statut initial `A_VERIFIER`) puis vérifié contre
une liste **configurable** de points de contrôle (`marking_verification_items`), plutôt
qu'un champ fixe par vérification possible (section 26). Le statut global devient
`VERIFIE` si tous les points cochés lors de la vérification sont passés, `NON_CONFORME`
dès qu'un seul échoue. Un marquage non vérifié ne porte ni vérificateur ni date de
vérification.

## 61. Programme de stérilisation

Le barème validé par OCEAMIC — température, pression, F0 cible/minimum/maximum, temps de
palier — est une donnée de configuration, jamais codée en dur dans l'écran de
stérilisation (section 30/35). Un cycle **fige** les limites du programme au moment de
son chargement : un changement ultérieur du programme n'affecte jamais un cycle déjà en
cours ou terminé.

## 62. Relation cycle ↔ Run

Un cycle de stérilisation ne porte **aucune colonne Run directe** : la relation passe
exclusivement par `sterilization_cycle_loads`, une table de relation qui admet
structurellement plusieurs Runs par cycle (section 29). Rien dans le reste du système
n'assume qu'un cycle ne contient qu'un seul Run.

## 63. F0

Le système enregistre un F0 mesuré ou calculé en amont et fourni par une donnée de
procédé autorisée (`sterilization_measurements.f0_value`). **Aucun algorithme de calcul
du F0 n'est implémenté** dans cette phase : la spécification interdit d'en inventer un
sans les paramètres de procédé validés par OCEAMIC (section 34). Le F0 maximum mesuré
d'un cycle est une valeur lue (`MAX(f0_value)`), jamais une moyenne ni une extrapolation.

## 64. Mesure de procédé et donnée d'équipement

`sterilization_measurements.source_type` distingue `MANUEL`, `EQUIPEMENT` et `IMPORT`.
Tant qu'aucune intégration directe avec un autoclave n'existe, seul `MANUEL` est produit
par cette phase — l'interface l'affiche explicitement comme « Saisie manuelle », jamais
comme si elle provenait d'un capteur (section 52). `source_reference` et `imported_at`
préparent une intégration future sans qu'aucune saisie manuelle existante ne soit
jamais écrasée (section 53).

## 65. Décision CCP

Une décision CCP (`ccp_controls`) est structurellement séparée des mesures de procédé
(section 31) : `result` (`CONFORME`, `NON_CONFORME`, `DEVIATION`, `A_VERIFIER`) et
`decision` (`LIBERE`, `RETENU`, `A_VERIFIER`) sont deux jugements distincts d'une même
observation. Seule une utilisatrice titulaire de la permission `ccp:validate`
(QUALITE ou ADMIN) peut enregistrer une décision CCP : un utilisateur PRODUCTION ne peut
jamais, à lui seul, déclarer une mesure hors limite conforme (section 36). Les limites
critiques opposables viennent exclusivement du programme figé sur le cycle
(`*_snapshot`), jamais d'une constante du code (section 35).

## 66. Clôture d'un cycle de stérilisation

Un cycle ne se termine jamais silencieusement (section 39) :

1. si aucune mesure de procédé ou aucun contrôle CCP n'a été enregistré, la clôture
   échoue et le cycle passe `A_VERIFIER`, avec le message :

   ```
   Cycle incomplet.
   Des données CCP obligatoires sont manquantes.
   ```

2. si toutes les données requises sont présentes et que la dernière décision CCP est
   `RETENU`, le cycle passe `BLOQUE` : le procédé est physiquement terminé
   (`ended_at` renseigné) mais le matériel reste retenu ;
3. sinon, le cycle passe `TERMINE`.

Un cycle `A_VERIFIER` ou `BLOQUE` n'est **jamais** traité comme équivalent à une
libération : voir la règle suivante.

## 67. Statut du procédé ≠ disposition qualité

Un cycle de stérilisation peut être opérationnellement `TERMINE` tandis que le matériel
associé reste `BLOQUE` par une décision Qualité (section 56 de la spécification). Ces
deux notions ne sont **jamais** confondues : achever le procédé ne libère jamais
automatiquement la matière.

## 68. Retenue d'un Run

Une décision CCP `RETENU` ouvre automatiquement une retenue sur **chaque** Run chargé
dans le cycle (`production_run_holds`, statut `ACTIF`), en réutilisant le cycle de vie
du blocage qualité de la Phase 1 (`ACTIF` → `LEVE`, motif, audité) plutôt que d'inventer
une vérité indépendante (section 41). Une décision CCP `LIBERE` ultérieure **ne lève
jamais** automatiquement une retenue existante : la levée est un acte délibéré, distinct,
réservé à `quality:release` — exactement la même permission que la libération d'un lot
en Phase 1. Un futur module Phase 5 de création de lot fini pourra hériter de cette
retenue via la vue `run_hold_status` plutôt que de réimplémenter la règle.

## 69. Refroidissement

Le refroidissement (`cooling_events`) est un procédé séparé de la stérilisation
elle-même, jamais fusionné dans le cycle (section 42). Aucune spécification de
refroidissement n'est demandée par la Phase 4 : `cooling_measurements.status`, quand il
est renseigné, est saisi tel quel plutôt que dérivé automatiquement — à la différence
des pesées et des mesures de sertissage, qui disposent toutes deux d'une spécification
configurée à comparer.

## 70. Déviations et actions correctives

Une déviation (`process_deviations`) est rattachée à un Run et/ou à un cycle de
stérilisation (section 37). Ses actions correctives (`process_corrective_actions`)
restent volontairement légères — pas un CAPA complet (section 38). Créer une action
corrective fait passer une déviation encore ouverte au statut `ACTION_REQUISE` ; la
clôturer exige une date de clôture, jamais implicite.

## 71. Politique de correction du procédé aval

Une pesée, une mesure de sertissage, une mesure de stérilisation ou une décision CCP
déjà validée n'est **jamais** modifiée en place (section 58) : la ligne d'origine passe
`ANNULE` (`cancelled_at`, `cancelled_by`, `cancellation_reason` obligatoires), et une
ligne de remplacement est créée si une valeur corrigée est fournie
(`replaces_id`). C'est la même politique d'annulation-remplacement déjà utilisée pour
les consommations de production (Phase 2) et les contrôles de cadence (Phase 3). Les
vues de calcul ne comptent jamais une ligne `ANNULE`.

## 72. Généalogie du procédé

```
Production Run
   ↓
Opération de remplissage → Contrôles poids
   ↓
Opération de sertissage → Contrôles sertissage
   ↓
Marquage
   ↓
Cycle de stérilisation → Contrôles CCP
   ↓
Refroidissement
```

Depuis un Run, l'utilisateur retrouve l'ensemble de cette chaîne sans recherche
manuelle d'identifiant (sections 44/70/74) : `runProcessGenealogy` interroge chaque
table par la clé étrangère qui la relie déjà au Run (directement, ou via
`sterilization_cycle_loads` pour la stérilisation), sans liaison saisie séparément.
Depuis un cycle de stérilisation, `sterilization_cycle_loads` retrouve symétriquement
le ou les Runs source. La vue du process (`runProcessOverview`) affiche l'état le plus
récent de chaque étape (section 46) — un simple tableau, jamais un diagramme BPMN.

## 73. Audit du procédé aval

Sont tracés : création et clôture d'une opération de remplissage, création d'un
contrôle poids et de chaque pesée, correction de pesée, création d'une opération et
d'un contrôle de sertissage, correction de mesure de sertissage, création et
vérification d'un marquage, création d'un cycle de stérilisation et de ses
chargements, démarrage et clôture d'un cycle, mesures de procédé et leur correction,
décisions CCP et leur correction, ouverture et levée d'une retenue de Run, création et
changement de statut d'une déviation, création et clôture d'une action corrective,
création de données de référence (équipements, milieux, spécifications, programmes,
points de vérification). Chaque entrée conserve l'auteur, la date et les valeurs
utiles.

## 74. Rôles du procédé aval

| Permission | ADMIN | PRODUCTION | QUALITE | STOCK | LECTURE |
|---|:--:|:--:|:--:|:--:|:--:|
| Consultation (remplissage, sertissage, stérilisation, CCP, déviations) | ✓ | ✓ | ✓ | ✓ | ✓ |
| Gérer une opération de remplissage | ✓ | ✓ | | | |
| Effectuer un contrôle poids | ✓ | | ✓ | | |
| Exploiter une opération de sertissage | ✓ | ✓ | | | |
| Effectuer un contrôle sertissage | ✓ | | ✓ | | |
| Enregistrer un marquage | ✓ | ✓ | | | |
| Vérifier un marquage | ✓ | | ✓ | | |
| Exploiter un cycle de stérilisation, saisir les mesures de procédé | ✓ | ✓ | | | |
| Valider une décision CCP | ✓ | | ✓ | | |
| Créer/gérer une déviation et ses actions correctives | ✓ | | ✓ | | |
| Lever une retenue de Run | ✓ | | ✓ (`quality:release`) | | |
| Configurer équipements, spécifications, programmes, points de vérification | ✓ | | | | |

Un utilisateur PRODUCTION exploite les opérations et saisit les mesures de procédé ;
QUALITE contrôle ce qui en sort et seule elle valide les décisions critiques de
sécurité alimentaire — jamais l'inverse, et jamais un utilisateur PRODUCTION seul.

## 75. Hors périmètre de la Phase 4

Explicitement non construits : stock de produits finis, lot de produit fini,
emballage, cartons, étiquettes, palettes, entrepôt PF, chargement de conteneur,
expédition, gestion clients, CAPA complète, GMAO/maintenance complète, moteur de stock
d'ingrédients, gestion de récupération d'huile, OEE avancé, SPC, IA, prévision. La
Phase 4 rend cependant possible la création d'un futur lot de produit fini
(Phase 5) à partir d'une chaîne aval validée, sans créer prématurément d'inventaire de
produits finis (section 76).

---

## 76. Séparation des concepts de la Phase 5

Lot d'emballage, Lot PF, palette, mouvement de stock PF, réservation, expédition et
conteneur ne sont **jamais** fusionnés (section 62) :

- un **lot d'emballage** (`packaging_batches`) est l'événement de production
  d'emballage ;
- un **Lot PF** (`finished_good_lots`) est l'identité de traçabilité du produit fini ;
- une **palette** (`pallets`) est l'unité de manutention logistique ;
- un **mouvement de stock PF** (`finished_goods_stock_movements`) est un événement
  d'inventaire ;
- une **réservation** (`stock_reservations`) est une allocation future de stock
  disponible ;
- une **expédition** (`shipments`) est un événement logistique client, et son
  **conteneur** une identité de transport portée directement sur l'expédition
  (section 29) plutôt qu'une table séparée sans usage réel dans ce périmètre.

## 77. Cartonisation agrégée, pas de table par carton

La sortie d'emballage (`packaging_outputs`) enregistre des totaux — boîtes, cartons,
boîtes par carton — jamais une ligne par carton physique (section 9) : rien ne
justifierait de créer des millions de lignes sans utilité opérationnelle. Le contrôle
d'étiquette (`packaging_label_checks`) suit la même discipline que les statuts calculés
de la Phase 4 : son `result` est une colonne générée à partir des quatre vérifications
booléennes, jamais une valeur saisie librement.

## 78. Un Lot PF n'a jamais de position de stock propre

Le stock d'un Lot PF est **toujours dérivé** en agrégeant, via `pallet_contents`,
chaque palette qui le contient — jamais stocké sur `finished_good_lots` lui-même
(section 5). C'est la même discipline qu'en Phase 1 : le stock n'est jamais une colonne,
toujours un calcul depuis un registre de mouvements (`finished_goods_stock_movements`).

## 79. Granularité du stock PF : la palette

**Décision de conception documentée.** Le stock PF est suivi à la granularité
**PALETTE** exclusivement — jamais à la granularité Lot PF, jamais à la granularité
carton. Une palette n'est jamais scindée entre deux emplacements : chaque mouvement
déplace toujours sa quantité physique totale. Un Lot PF réparti sur plusieurs palettes
peut donc se trouver sur plusieurs emplacements à la fois, sans que cela contredise la
règle précédente — c'est la somme des positions de ses palettes qui compose sa
position agrégée.

## 80. Le statut qualité PF n'est jamais automatiquement `LIBERE`

Un Lot PF et une palette démarrent `A_VERIFIER` (section 19), jamais `LIBERE` — ni la
fin de l'emballage, ni la création de la palette ne libèrent automatiquement quoi que
ce soit. Seule une décision qualité explicite (`fgquality:decide`, ACCEPTE ou LIBERE)
fait passer l'entité à `LIBERE`. Une décision `BLOQUE` ouvre un blocage
(`finished_goods_quality_blocks`, `ACTIF`) ; une décision `LIBERE` ferme le blocage
actif. Le statut mis en cache sur `finished_good_lots.quality_status` /
`pallets.quality_status` est toujours recalculé par le service, jamais réécrit
directement.

## 81. Héritage du blocage Production/CCP amont

À la création d'un Lot PF, le service vérifie, via la vue `run_hold_status` de la
Phase 4, si le(s) Run(s) source(s) (`finished_good_lot_sources`) portent une retenue
Production/CCP active non levée. Si oui, le Lot PF est immédiatement `BLOQUE`,
avec un blocage qualité référençant le motif de la retenue amont, au lieu de rester à
son défaut `A_VERIFIER`. Cet héritage protège contre l'oubli : une matière retenue par
la Qualité en amont ne peut jamais devenir un produit fini apparemment neutre en aval.

## 82. Statut opérationnel ≠ disposition qualité, aussi pour les palettes

Comme un cycle de stérilisation (section 67), une palette peut être opérationnellement
`EN_STOCK` tout en restant `BLOQUE` pour la Qualité : les deux colonnes
(`pallets.status`, `pallets.quality_status`) sont indépendantes et ne sont jamais
fusionnées.

## 83. Formule du stock disponible

**Stock disponible = Stock physique − Stock bloqué − Stock réservé.**

Une réservation n'est **jamais** traitée comme déjà expédiée : elle diminue le
disponible sans toucher au stock physique, qui ne varie qu'au moment d'un mouvement de
stock réel (transfert, expédition, retour, ajustement). Les cartons d'une palette
comptent comme bloqués si la palette **ou** le Lot PF qu'elle porte est `BLOQUE`.

## 84. Réservation : allocation, pas encore expédition

Charger une palette sur une expédition (`addPalletToShipment`) ouvre en une seule
transaction une ligne `shipment_lines` (contenu confirmé) et une ligne
`stock_reservations` (`ACTIF`). Un index unique partiel garantit **au plus une
réservation active par palette**, ce qui rend impossibles, au niveau de la base et pas
seulement de la logique applicative :

- le **double engagement** d'une même palette sur deux expéditions différentes ;
- le **double chargement** de la même palette sur la même expédition.

Tenter de charger une palette déjà réservée renvoie l'erreur exacte : *« Cette palette
est déjà affectée à une expédition. »*

## 85. Validation avant confirmation d'expédition

Avant de confirmer une expédition, chaque palette chargée est vérifiée :

1. une réservation active existe toujours pour ce couple expédition/palette ;
2. ni la palette, ni aucun Lot PF qu'elle porte, n'est `BLOQUE` — sinon : *« Expédition
   impossible.\nLa palette est bloquée par le service Qualité. »* ou *« Expédition
   impossible.\nLe lot PF est bloqué par le service Qualité. »* ;
3. la palette et chaque Lot PF qu'elle porte sont explicitement `LIBERE` — un statut
   `A_VERIFIER` bloque autant l'expédition qu'un statut `BLOQUE` : rien ne s'expédie
   sans libération qualité explicite ;
4. le solde physique de la palette à son emplacement courant couvre toujours la
   quantité réservée — sinon : *« Stock disponible insuffisant. »*

Toute violation interrompt la confirmation **avant** la création du moindre mouvement
de stock : une expédition refusée ne laisse aucune trace de mouvement.

## 86. La confirmation d'expédition est une seule transaction

`confirmShipment` (section 30) exécute, dans une seule transaction :

1. valider stock, qualité et réservations (section 85) pour chaque palette chargée ;
2. créer un mouvement `EXPEDITION` par palette (source = emplacement courant,
   destination = néant) ;
3. clôturer chaque réservation active en `CONSOMMEE` ;
4. marquer chaque palette `EXPEDIEE` ;
5. marquer l'expédition `EXPEDIEE` et horodater `shipped_at` ;
6. auditer la confirmation.

Toute erreur à n'importe quelle étape annule l'intégralité de la transaction : jamais
d'expédition à moitié confirmée, jamais de palette marquée expédiée sans mouvement de
sortie correspondant.

## 87. Une expédition confirmée n'est jamais librement modifiée

Une fois `EXPEDIEE`, une expédition ne peut plus recevoir de nouvelle palette ni être
annulée : son historique reste définitif. Une correction après expédition (retour
client, litige) passe par un mouvement `RETOUR` distinct et audité, jamais par une
réécriture de l'expédition d'origine.

## 88. Chargement d'une palette : statut opérationnel

Charger une palette sur une expédition fait passer son statut à `RESERVEE`, et
l'expédition, si elle était encore `PLANIFIEE`, passe à `EN_PREPARATION` (section 23) :
une expédition avec au moins une palette réservée n'est plus une simple intention.

## 89. Traçabilité avant (Lot MP → clients)

Depuis un Lot MP, la chaîne avant retrouve, sans liaison saisie séparément :

```
Lot MP → Runs (production_run_materials) → Lots PF (finished_good_lot_sources)
       → Palettes (pallet_contents) → Expéditions (shipment_lines) → Clients
```

Cette chaîne répond à la question posée par la section 63 : si un Lot MP présente un
problème, quels clients ont reçu un produit qui en est issu.

## 90. Traçabilité arrière (Expédition/Conteneur → Lots MP)

Depuis une expédition ou un numéro de conteneur, la chaîne arrière redescend
symétriquement :

```
Expédition/Conteneur → Palettes (shipment_lines) → Lots PF (pallet_contents)
       → Cycles de stérilisation et Runs (finished_good_lot_sources)
       → Lots MP (production_run_materials) → Fournisseur/Navire/Réception
```

La recherche globale de traçabilité (section 34) accepte désormais un Lot MP, un Run,
un Lot PF, une Palette, une Expédition, un numéro de Conteneur ou un Client, et mène
chaque résultat à son propre écran plutôt que de tout faire converger vers « Situation
du lot » comme en Phase 1 seule.

## 91. Audit de la Phase 5

Sont tracés : création et clôture d'un lot d'emballage, création d'un Lot PF, sortie
d'emballage, contrôle d'étiquette, création et annulation d'une palette, décisions et
blocages qualité PF, chaque mouvement de stock PF (entrée, transfert, ajustement,
blocage logistique, retour, expédition), création d'une expédition, mise à jour des
informations conteneur, chargement/retrait d'une palette, confirmation et annulation
d'une expédition. Chaque entrée conserve l'auteur, la date et les valeurs utiles.

## 92. Rôles de la Phase 5

| Permission | ADMIN | PRODUCTION | QUALITE | STOCK | LECTURE |
|---|:--:|:--:|:--:|:--:|:--:|
| Consultation (emballage, Lots PF, palettes, stock PF, expéditions) | ✓ | ✓ | ✓ | ✓ | ✓ |
| Créer/gérer lot d'emballage, Lot PF, palette | ✓ | ✓ | | | |
| Gérer le stock PF (transfert, ajustement, blocage logistique, retour de palette) | ✓ | | | ✓ | |
| Décider qualité PF (bloquer/libérer un Lot PF ou une palette) | ✓ | | ✓ | | |
| Gérer une expédition (créer, charger, confirmer, annuler) | ✓ | | | ✓ | |
| Créer/désactiver un client | ✓ | | | | |

PRODUCTION emballe (crée lots d'emballage, Lots PF, palettes), exactement comme elle
remplit, sertit et stérilise en Phase 4. STOCK gère la logistique PF et les
expéditions, au même titre que le stock matière première en Phase 1 — jamais
PRODUCTION ni QUALITE. QUALITE décide seule des blocages et libérations PF, exactement
comme elle décide seule des blocages matière première en Phase 1 et des décisions CCP
en Phase 4 : un utilisateur STOCK ne peut jamais, à lui seul, libérer un Lot PF ou une
palette bloquée.

## 93. Hors périmètre de la Phase 5

Explicitement non construits : gestion de rappel complète (la traçabilité rend
possible d'identifier tous les clients/expéditions affectés par un Lot MP et tous les
lots amont impliqués dans un Lot PF, mais aucun flux de rappel dédié n'existe), CRM,
facturation client, comptabilité, approvisionnement, moteur de stock d'ingrédients,
GMAO/maintenance complète, gestion de récupération d'huile, BI avancée, prévision, IA,
concepteur de documents ERP complet (seules des vues imprimables/exportables de base —
liste de colisage, bon d'expédition, liste de palettes, traçabilité d'un lot —
existent).

---

# Phase 6 — Qualité horizontale (QMS)

## 94. Séparation des concepts de la Phase 6

Non-conformité, investigation, cause racine, correction, CAPA, action CAPA, contrôle
d'efficacité, réclamation client, incident qualité fournisseur, audit, constat
d'audit, document qualité, révision de document et retrait/rappel sont **quatorze
concepts distincts**, jamais fusionnés dans une table « problème qualité » générique
(section 70). Une correction (capturée sur l'investigation) n'est pas une action
corrective (une action CAPA) : la correction traite le symptôme immédiatement, l'action
corrective traite la cause racine identifiée (section 49).

## 95. Une non-conformité n'est jamais un enregistrement isolé

Toute non-conformité porte une source (`source_type`/`source_id`, pointeur rapide) et
peut porter d'autres liens (`nonconformity_links`, table autoritaire) vers n'importe
quelle entité opérationnelle déjà existante — Lot MP, Lot PF, Run, contrôle poids,
contrôle sertissage, cycle de stérilisation, expédition, audit, réclamation... Elle
n'invente jamais une copie de cette entité (section 5).

## 96. Blocage qualité depuis une non-conformité : réutilisation, jamais un troisième système

Ouvrir un blocage depuis une non-conformité (section 9) réutilise directement
`lot_blocks` (Phase 1, matière première) ou `finished_goods_quality_blocks` (Phase 5,
Lot PF/palette) selon le type d'entité, via les fonctions de décision qualité
existantes. La non-conformité enregistre ensuite la référence du blocage obtenu
(`block_entity_type`/`block_entity_id`/`block_reference_id`). Ces fonctions gérant
chacune leur propre transaction, l'opération s'exécute en deux étapes documentées
plutôt que dans une seule transaction atomique — un compromis pragmatique assumé
plutôt qu'une réécriture des services Phase 1/5.

## 97. Clôture d'une non-conformité bloquée par un CAPA lié encore ouvert

Une non-conformité ne peut pas passer `CLOTUREE` tant qu'un CAPA qu'elle a déclenché
(`capa_records.source_nonconformity_id`) reste ouvert (statut hors `CLOTUREE`/
`ANNULEE`) — la même discipline « pas de clôture tant qu'un enfant reste ouvert » que
le contrôle d'efficacité d'un CAPA lui-même (règle 99), appliquée un niveau au-dessus.

## 98. Une action préventive peut exister sans non-conformité source

`capa_records.source_nonconformity_id` est **nullable** (section 50) : une action
préventive peut naître d'une observation d'audit, d'une tendance identifiée ou d'une
décision de management, sans qu'aucune non-conformité n'ait jamais été ouverte.

## 99. Clôture d'un CAPA : jamais tant qu'une action reste ouverte ou que l'efficacité n'est pas prouvée

Un CAPA ne se clôture jamais tant qu'une action obligatoire reste ouverte, ni — quand
`effectiveness_required` est vrai — tant que le dernier contrôle d'efficacité n'a pas
conclu positivement (section 15). L'éligibilité à la clôture (`capa_summary.can_close`)
est une **vue calculée**, jamais une case cochée à la main, lue à la fois par
l'opération de clôture (contrôle strict, qui refuse avec le message exact
« Clôture impossible.\nDes actions obligatoires restent ouvertes. ») et par les écrans
CAPA (explication de ce qui reste à faire). Un CAPA n'est jamais considéré efficace du
seul fait que ses actions sont `TERMINEE` — l'efficacité exige sa propre preuve
enregistrée (`capa_effectiveness_checks`).

## 100. Statut CAPA : toujours calculé

`capa_records.status` est une colonne mise en cache, jamais saisie directement :
`OUVERTE` sans action, `EN_COURS` tant qu'une action reste ouverte, `EN_VERIFICATION`
une fois toutes les actions terminées mais la clôture pas encore accordée, `CLOTUREE`/
`ANNULEE` uniquement via leurs propres opérations gated — la même discipline que le
statut calculé d'un contrôle poids ou d'un cycle de stérilisation en Phase 4.

## 101. Réclamation client : jamais un CRM

Une réclamation client (sections 16-18) reste un événement qualité à usage
traçabilité — jamais un système de gestion de la relation client. Sa traçabilité
(client → expédition → palettes → Lot PF → stérilisation → Run → Lots MP →
fournisseur) est **recalculée** depuis les relations existantes à chaque consultation,
jamais ressaisie manuellement ni stockée en dur sur la réclamation.

## 102. Document qualité : une révision n'est jamais écrasée

Chaque révision est un enregistrement permanent, ajouté (`INSERT`), jamais modifié pour
représenter une nouvelle version (section 27). Un index unique partiel garantit **au
plus une révision `EN_VIGUEUR` par document** ; mettre une nouvelle révision en vigueur
bascule automatiquement l'ancienne en `OBSOLETE`, jamais supprimée. Une révision
`OBSOLETE` n'est **jamais** exposée comme le statut courant du document — le statut du
document est toujours mis en cache depuis sa révision `current_revision_id` (section
28).

## 103. Approbation d'un document : autorisation distincte de la rédaction

Créer et soumettre une révision (`document:manage`) reste ouvert à QUALITE ;
l'approuver et la mettre en vigueur (`document:approve`) exige RESPONSABLE_QUALITE
(section 29). La même personne qui rédige un document n'est jamais, seule, celle qui
en approuve la mise en vigueur.

## 104. Retrait / rappel : l'impact est toujours calculé depuis la traçabilité existante

L'ensemble des entités affectées par un retrait, un rappel ou un exercice de
traçabilité (Runs, cycles de stérilisation, Lots PF, palettes, expéditions, clients)
est **calculé** en réutilisant la traçabilité avant (Phase 5) depuis le Lot MP ou le
Lot PF d'origine, jamais construit ou saisi à la main (sections 32-36). Réactualiser
l'impact d'un événement ouvert fusionne les nouvelles entités trouvées avec l'ensemble
déjà identifié ; il ne le rétrécit jamais.

## 105. Bilan matière : jamais une réconciliation forcée

Pour un Lot PF concerné par un retrait, produit / en stock / bloqué / expédié / ajusté
sont calculés séparément depuis les registres existants (section 36) ; l'écart
résiduel est explicitement rapporté comme **inexpliqué**, jamais forcé artificiellement
à zéro quand les données sous-jacentes ne permettent pas une réconciliation parfaite.

## 106. Exercice de traçabilité et retrait/rappel réel : deux autorisations distinctes

Ouvrir un exercice de traçabilité de routine (`recall:exercise`) reste ouvert à
QUALITE ; initier un vrai retrait ou rappel (`recall:manage`) exige RESPONSABLE_QUALITE
(sections 53-54). Le type d'événement (`EXERCICE_TRACABILITE` contre `RETRAIT`/
`RAPPEL`) détermine, côté route, quelle permission est vérifiée — jamais une seule
permission générique couvrant les deux.

## 107. Audit : planification et conduite restent deux permissions distinctes

Planifier un audit (`audit:plan`, choisir son type, sa grille, son auditeur responsable
et sa date) reste réservé à QUALITE/RESPONSABLE_QUALITE. Conduire un audit
(`audit:conduct` : réponses de grille, constats, clôture) est la **seule** autorité
que le rôle AUDITEUR détient au-delà de la consultation — un AUDITEUR ne planifie
jamais son propre audit, et ne décide jamais d'une non-conformité ou d'un blocage de sa
propre initiative en dehors des constats de l'audit qu'il conduit (section 21-24).

## 108. Un constat d'audit majeur peut générer une non-conformité, jamais l'inverse implicitement

Créer une non-conformité depuis un constat d'audit (`audit_findings.
resulting_nonconformity_id`) reste une action explicite de l'auditeur ou de la
Qualité, jamais un déclenchement automatique silencieux à la clôture de l'audit —
chaque constat garde son propre statut de traitement (`OUVERTE`, `ACTION_REQUISE`,
`CLOTUREE`, `ANNULEE`), indépendant de celui d'une éventuelle non-conformité liée.

## 109. Séparation stricte des pouvoirs qualité (sections 53-54)

Le même rôle qui déclare une non-conformité critique, rédige un CAPA, un document ou
lance un exercice de traçabilité n'est **jamais**, seul, celui qui en approuve la
clôture ou l'entrée en vigueur. Chaque paire manage/approve reste une permission
distincte :

| Action | Permission « faire » | Rôle | Permission « approuver/clôturer » | Rôle |
|---|---|---|---|---|
| Non-conformité | `ncr:manage` | QUALITE | `ncr:approve` (validation de la cause racine) | RESPONSABLE_QUALITE |
| CAPA | `capa:manage` | QUALITE | `capa:approve` (clôture) | RESPONSABLE_QUALITE |
| Document qualité | `document:manage` | QUALITE | `document:approve` (approbation + mise en vigueur) | RESPONSABLE_QUALITE |
| Retrait / rappel | `recall:exercise` (exercice) | QUALITE | `recall:manage` (retrait/rappel réel) | RESPONSABLE_QUALITE |
| Audit | `audit:plan` (planification) | QUALITE/RESPONSABLE_QUALITE | `audit:conduct` (conduite assignée) | AUDITEUR |

STOCK et PRODUCTION peuvent compléter (`action:complete`) une action CAPA ou de suivi
de constat d'audit qui leur est assignée, mais ne clôturent jamais, à eux seuls, une
non-conformité, un CAPA, un audit ou un document.

## 110. Audit de la Phase 6

Sont tracés : création d'une non-conformité, ajout d'un lien, changement de gravité,
changement de responsable, changement de statut (dont la clôture), création d'une
investigation, création et validation d'une analyse de cause racine, déclenchement d'un
blocage qualité ; création d'un CAPA, d'une action, complétion et annulation d'une
action, enregistrement d'un contrôle d'efficacité, clôture et annulation d'un CAPA ;
création d'une réclamation, changement de statut, liaison à une non-conformité/CAPA ;
création et changement de statut d'un incident fournisseur ; création, démarrage,
clôture et annulation d'un audit, enregistrement d'une réponse de grille, création d'un
constat et changement de son statut, liaison d'un constat à une non-conformité ;
création d'un document et de chaque révision, soumission, approbation, mise en
vigueur, annulation d'une révision, assignation et confirmation d'un acquittement ;
ouverture d'un retrait/rappel/exercice, actualisation de l'impact, changement de
statut, clôture, changement de statut d'une entité affectée. Chaque entrée conserve
l'auteur, la date et les valeurs utiles — la même discipline d'audit que les cinq
phases précédentes.

## 111. Rôles de la Phase 6

| Permission | ADMIN | QUALITE | RESPONSABLE_QUALITE | AUDITEUR | STOCK | PRODUCTION | LECTURE |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| Consultation QMS (`qms:read`) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Créer/gérer une non-conformité (`ncr:manage`) | ✓ | ✓ | ✓ | | | | |
| Approuver une cause racine (`ncr:approve`) | ✓ | | ✓ | | | | |
| Créer/gérer un CAPA (`capa:manage`) | ✓ | ✓ | ✓ | | | | |
| Clôturer un CAPA (`capa:approve`) | ✓ | | ✓ | | | | |
| Compléter une action assignée (`action:complete`) | ✓ | ✓ | ✓ | | ✓ | ✓ | |
| Gérer une réclamation / un incident fournisseur | ✓ | ✓ | ✓ | | | | |
| Planifier un audit (`audit:plan`) | ✓ | ✓ | ✓ | | | | |
| Conduire un audit assigné (`audit:conduct`) | ✓ | ✓ | ✓ | ✓ | | | |
| Rédiger un document qualité (`document:manage`) | ✓ | ✓ | ✓ | | | | |
| Approuver/mettre en vigueur un document (`document:approve`) | ✓ | | ✓ | | | | |
| Mener un exercice de traçabilité (`recall:exercise`) | ✓ | ✓ | ✓ | | | | |
| Initier un retrait/rappel réel (`recall:manage`) | ✓ | | ✓ | | | | |

RESPONSABLE_QUALITE détient l'intégralité des droits QUALITE, plus les autorisations
d'approbation que la section 109 réserve explicitement à un rôle distinct.
AUDITEUR ne détient que la consultation et la conduite d'un audit qui lui est assigné —
jamais la planification, ni aucune permission de décision qualité.

## 112. Hors périmètre de la Phase 6

Explicitement non construits : comptabilité complète, ERP commercial, gestion complète
des achats, GMAO/maintenance complète, LIMS de laboratoire, portail fournisseur,
portail client, prédiction de cause racine assistée par IA, qualité prédictive,
entrepôt de données BI avancé. La traçabilité et le calcul d'impact des retraits/
rappels s'appuient exclusivement sur les relations opérationnelles déjà enregistrées
dans les phases précédentes ; aucune donnée qualité n'est jamais déduite ou inventée
en dehors de ce qui est explicitement saisi ou calculé.

---

# Corrections QMS (audit ciblé post-Phase 6)

## 113. Transitions de statut d'une non-conformité contraintes

Une non-conformité ne change de statut que selon
`NONCONFORMITY_ALLOWED_TRANSITIONS` (`server/src/domain/types.ts`), vérifié côté
serveur dans `updateNonconformityStatus` — jamais seulement une convention d'écran.
`OUVERTE` ne peut mener qu'à `EN_ANALYSE` ou `ANNULEE` ; `CLOTUREE` n'est atteignable
que depuis `A_VERIFIER`. Chaque statut définit aussi un « statut suivant principal »
(`NONCONFORMITY_PRIMARY_NEXT_STATUS`) : l'écran propose ce statut comme action
principale, et les autres transitions valides via un contrôle secondaire « Changer le
statut », jamais six boutons de statut à plat.

## 114. Cohérence gravité/priorité

Une gravité `CRITIQUE` ne doit jamais coexister silencieusement avec une priorité
`BASSE`/`NORMALE`. Ce n'est pas un blocage strict (un incident critique déjà maîtrisé
peut légitimement rester non urgent) mais une confirmation explicite exigée, la même
mécanique que la confirmation d'affectation multi-ligne en Phase 3
(`confirmationRequiredError`, code `CONFIRMATION_REQUISE`) : sans confirmation,
`createNonconformity`/`updateNonconformitySeverity` refusent l'opération avec un
message explicite plutôt que d'accepter silencieusement l'incohérence. Les
non-conformités créées automatiquement depuis un constat d'audit ou une réclamation
(sections 18/24) dérivent leur priorité de la gravité (`CRITIQUE` → `HAUTE`) au lieu
de toujours retomber sur `NORMALE`.

## 115. Échéance CAPA encouragée, obligatoire pour une priorité haute

Les écrans de création d'un CAPA et d'une action CAPA exposent un champ échéance ;
il devient obligatoire dès que la priorité est `HAUTE` ou `URGENTE`, faute de quoi le
KPI « CAPA en retard »/« Actions en retard » (section 7.4) ne peut jamais se déclencher.
La détection du retard elle-même existait déjà (`isOverdue`, vues
`capa_action_progress`/`capa_summary`) ; le correctif porte sur la saisie, pas le
calcul.

## 116. Libellé de l'efficacité CAPA distinct de la conformité produit

Un contrôle d'efficacité CAPA s'affiche « Efficace »/« Non efficace », jamais
« Conforme »/« Non conforme » : ce dernier libellé, déjà utilisé pour la conformité
produit/procédé (contrôles poids, sertissage...), prêtait à confusion sur ce que le
contrôle évalue réellement.

## 117. Clarté du statut d'exécution d'un audit face au suivi des constats

Le statut `TERMINE` d'un audit (fin de la grille de contrôle) et le statut des
constats qu'il a soulevés (`audit_findings.status`) restent deux informations
distinctes, jamais fusionnées : un audit `TERMINE` avec des constats encore ouverts
l'affiche explicitement (« Audit terminé — N actions ouvertes »), sur la liste comme
sur la fiche. `audit_progress.open_finding_count` (et les autres compteurs de cette
vue) sont désormais castés en `::integer` : laissés en `bigint` implicite, le pilote
PostgreSQL les retournait en chaîne de caractères côté API, cassant silencieusement
toute comparaison numérique côté client.
