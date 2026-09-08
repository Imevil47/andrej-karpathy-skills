# Règles métier — OCEAMIC IMS Phases 1, 2 et 3

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
