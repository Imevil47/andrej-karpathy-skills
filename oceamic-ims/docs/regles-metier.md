# Règles métier — OCEAMIC IMS Phases 1 et 2

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
