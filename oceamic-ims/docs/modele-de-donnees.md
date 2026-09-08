# Modèle de données — OCEAMIC IMS Phases 1, 2, 3 et 4

Toutes les clés primaires sont des UUID. Les codes lisibles (`LOT-…`, `REC-…`) sont des
identifiants opérationnels affichés aux utilisateurs ; les UUID ne sont jamais montrés.
Tous les horodatages sont en `TIMESTAMPTZ`. Les quantités sont en `NUMERIC(14,3)`
kilogrammes — jamais en virgule flottante.

---

## Génération des codes

### `code_counters`

Compteur par préfixe et par jour.

| Champ | Rôle |
|---|---|
| `prefix`, `counter_day` | Clé primaire composite |
| `last_number` | Dernier numéro attribué |

La fonction `next_operational_code(prefix, day, width)` incrémente la ligne par
`INSERT … ON CONFLICT DO UPDATE … RETURNING`. La ligne est verrouillée par cette
écriture jusqu'à la fin de la transaction : deux opérations simultanées ne peuvent pas
obtenir le même code.

Formats : `LOT-20260907-001`, `REC-20260907-001`, `MVT-20260907-00001`,
`ST-20260907-001`, `INS-20260907-001`.

---

## Utilisateurs et rôles

### `roles`
`code` unique, contraint à ADMIN, QUALITE, STOCK, PRODUCTION, LECTURE.

### `users`
| Champ | Rôle |
|---|---|
| `username` | Identifiant de connexion, unique |
| `password_hash` | Empreinte `scrypt$sel$clé` — jamais un mot de passe en clair |
| `role_id` | → `roles` |
| `is_active` | Un compte est désactivé, jamais supprimé |

---

## Données de référence

Toutes ces tables portent `code` unique, `name`, `is_active`, `created_at`, `updated_at`.
Elles sont désactivées plutôt que supprimées, afin que les opérations historiques qui
les référencent restent valides.

### `species`
Espèce de matière première (SARDINE, MAQUEREAU, THON). À ne pas confondre avec un
produit fini, qui appartiendra au futur module production.

### `suppliers`, `vessels`
Fournisseur (`country`) et bateau (`registration`).

### `locations`
Emplacement de stock. **Table centrale de la classification du stock.**

| Champ | Rôle |
|---|---|
| `stock_type` | `INTERNE` ou `EXTERNE` — seule source de vérité de la classification |
| `location_type` | `USINE`, `ENTREPOT`, `SOUS_TRAITANT`, `ZONE_TRANSIT`, `AUTRE` |
| `can_receive` | L'emplacement peut être destination d'un mouvement |
| `can_store` | L'emplacement peut détenir du stock |

Aucun comportement métier n'est déduit du nom d'un emplacement : tout passe par ces
champs de configuration.

### `subcontractors`
| Champ | Rôle |
|---|---|
| `location_id` | → `locations`, **unique et obligatoire** |

Un sous-traitant possède exactement un emplacement de stock, obligatoirement externe.
La marchandise détenue chez lui reste donc visible dans l'inventaire unique.

---

## Matière première

### `raw_material_lots`
**Identité** d'un lot. Cette table ne contient aucune quantité.

| Champ | Rôle |
|---|---|
| `lot_code` | Code opérationnel unique |
| `species_id` | → `species` (obligatoire) |
| `supplier_id`, `vessel_id`, `origin`, `tide_number`, `capture_date` | Traçabilité amont |
| `initial_reception_date` | Date de la première entrée |
| `parent_lot_id` | → `raw_material_lots`, généalogie du fractionnement |
| `status` | État opérationnel **dérivé** : ACTIF, BLOQUE, EPUISE, FRACTIONNE, CLOTURE |
| `created_by` | → `users` |

`status` est un cache recalculé par `refreshLotStatus()` à partir des blocages actifs et
du stock. La vérité du blocage qualité reste `lot_blocks`, la vérité des quantités reste
`stock_movements`.

Contraintes : `lot_code` unique, `parent_lot_id <> id`, statut dans la liste autorisée.
Index : espèce, fournisseur, lot parent, statut, recherche sur `lot_code`.

### `raw_material_receptions`
**Événement** d'entrée de marchandise. Une réception produit toujours un mouvement de
stock.

| Champ | Rôle |
|---|---|
| `reception_code` | Code opérationnel unique |
| `received_at` | Date et heure réelles de la réception |
| `raw_material_lot_id` | → lot concerné |
| `quantity_kg` | `> 0` (contrainte CHECK) |
| `destination_location_id` | → `locations` (obligatoire) |
| `reception_type` | FOURNISSEUR, RETOUR_SOUS_TRAITANCE, TRANSFERT_ENTRANT, RETOUR_PRODUCTION, AUTRE |
| `external_source_location_id` | Emplacement d'origine pour un transfert entrant |
| `truck_registration`, `tide_number`, `document_reference` | Traçabilité du camion et des documents |

Index : lot, date de réception, destination, immatriculation camion.

---

## Registre de stock

### `stock_movements`
**Registre unique de l'inventaire.** Toute variation de quantité de la Phase 1 y passe.

| Champ | Rôle |
|---|---|
| `movement_code` | Code opérationnel unique |
| `occurred_at` | Date et heure de l'opération réelle |
| `raw_material_lot_id` | → lot |
| `movement_type` | RECEPTION, TRANSFERT, CONSOMMATION, SOUS_TRAITANCE, RETOUR, PERTE, AJUSTEMENT, FRACTIONNEMENT |
| `source_location_id` / `destination_location_id` | Donnent le **sens** du mouvement |
| `quantity_kg` | Toujours strictement positive |
| `reference_type` / `reference_id` | Rattachement à l'opération d'origine |
| `reason` | Motif, obligatoire pour PERTE et AJUSTEMENT |
| `reverses_movement_id` | → mouvement annulé, unique |
| `created_by` | → `users` |

Contraintes de direction vérifiées par la base :

| Type | Source | Destination |
|---|---|---|
| RECEPTION | obligatoirement vide | obligatoire |
| TRANSFERT, SOUS_TRAITANCE, RETOUR | obligatoire | obligatoire |
| CONSOMMATION | obligatoire | libre (destination logique future) |
| PERTE | obligatoire | obligatoirement vide, motif obligatoire |
| AJUSTEMENT | au moins l'un des deux | motif obligatoire |

Autres contraintes : `quantity_kg > 0`, source ≠ destination, au moins un des deux
emplacements renseigné, `reverses_movement_id` unique (un mouvement ne peut être annulé
qu'une fois).

Index : lot, source, destination, `occurred_at`, `(reference_type, reference_id)`.

---

## Sous-traitance

### `subcontracting_operations`
| Champ | Rôle |
|---|---|
| `operation_code` | Code opérationnel unique |
| `subcontractor_id` | → `subcontractors` |
| `source_type` | `STOCK_EXISTANT` ou `FOURNISSEUR` |
| `source_lot_id` | Lot concerné (créé automatiquement en mode fournisseur) |
| `source_location_id` | Emplacement OCEAMIC d'origine — **uniquement** en mode stock existant |
| `quantity_sent_kg` | `> 0` |
| `incoming_quality`, `incoming_size_grade` | Qualité et calibre déclarés à l'envoi |
| `status` | EN_COURS, CLOTURE, ANNULE |

Contraintes : en `STOCK_EXISTANT`, lot source et emplacement source obligatoires ; en
`FOURNISSEUR`, `source_location_id` doit être vide — la base empêche structurellement de
diminuer un emplacement OCEAMIC dans ce mode.

### `subcontracting_results`
Une opération peut produire plusieurs sorties, chacune avec sa quantité, sa qualité, son
calibre, son lot et sa destination.

| Champ | Rôle |
|---|---|
| `result_type` | `PRODUIT` ou `PERTE` |
| `result_lot_id` | Lot du résultat (lot source conservé, ou lot enfant créé) |
| `destination_location_id` | Obligatoire pour un produit, vide pour une perte |
| `outgoing_quality`, `outgoing_size_grade`, `quality_status` | Caractéristiques de sortie |

---

## Qualité

### `quality_inspections`
**Observations et mesures.** Aucun champ n'est obligatoire hormis le type, l'étape et le
résultat : un contrôle température n'a pas les mêmes mesures qu'un contrôle histamine.

| Champ | Rôle |
|---|---|
| `inspection_code` | Code opérationnel unique |
| `inspection_type` | RECEPTION, STOCKAGE, SOUS_TRAITANCE, RECONTROLE, AUTRE |
| `process_stage` | Étape du process |
| `temperature_c`, `histamine_ppm`, `abvt` | Mesures, facultatives |
| `quality_grade`, `size_grade` | Qualité et calibre observés |
| `result` | CONFORME, NON_CONFORME, A_SURVEILLER |
| `inspector_id` | → `users` |

Une inspection n'est jamais réécrite par une décision ultérieure.

### `quality_decisions`
**Décisions métier**, historisées.

| Champ | Rôle |
|---|---|
| `inspection_id` | Contrôle à l'origine de la décision (facultatif) |
| `decision_type` | ACCEPTE, ACCEPTE_SOUS_RESERVE, BLOQUE, REJETE, RECONTROLE_REQUIS, LIBERE |
| `reason` | Motif obligatoire |
| `decided_at`, `decided_by` | Qui a décidé, et quand |

### `lot_blocks`
**Restriction opérationnelle** posée sur un lot.

| Champ | Rôle |
|---|---|
| `blocked_at`, `blocked_by`, `reason` | Origine du blocage |
| `source_inspection_id`, `block_decision_id` | Rattachement au contrôle et à la décision |
| `status` | ACTIF, LEVE, ANNULE |
| `released_at`, `released_by`, `release_reason`, `release_decision_id` | Levée du blocage |

Un index unique partiel garantit **au plus un blocage actif par lot**. Une ligne non
active doit obligatoirement porter sa date, son auteur et son motif de levée.

La Phase 1 bloque le lot entier. Le schéma ne comporte volontairement aucune colonne de
quantité bloquée : un blocage partiel pourra être ajouté plus tard sans changer le sens
des lignes existantes.

---

## Audit

### `audit_log`
| Champ | Rôle |
|---|---|
| `occurred_at`, `user_id`, `action` | Qui a fait quoi, et quand |
| `entity_type`, `entity_id` | Objet concerné |
| `old_values`, `new_values`, `context` | `JSONB` |

Actions tracées : création de lot, réception, transfert, perte, ajustement, annulation de
mouvement, envoi et résultat de sous-traitance, clôture, contrôle qualité, décision
qualité, blocage, libération, création et (dés)activation de données de référence.
Aucun mot de passe, jeton ou secret n'est écrit dans l'audit.

---

## Vues de calcul

| Vue | Contenu |
|---|---|
| `stock_ledger_entries` | Chaque mouvement transformé en lignes signées (+ destination, − source) |
| `current_stock_by_lot_location` | Stock physique par LOT + EMPLACEMENT (soldes non nuls) |
| `current_stock_by_lot` | Stock physique par lot, tous emplacements |
| `blocked_lots` | Lots portant un blocage qualité actif |
| `available_stock` | Stock physique, bloqué et disponible par LOT + EMPLACEMENT |
| `internal_stock_summary` | Totaux des emplacements `INTERNE` |
| `external_stock_summary` | Totaux des emplacements `EXTERNE` |
| `subcontracting_material_balance` | Envoyé, résultats et écart par opération |

Ces vues sont la **seule** source des chiffres de stock, aussi bien pour l'affichage que
pour la validation des sorties.

---

## Relations principales

```
species ──< raw_material_lots >── suppliers, vessels
                  │  │
                  │  └──< raw_material_lots (parent_lot_id)
                  │
                  ├──< raw_material_receptions >── locations
                  ├──< stock_movements >── locations (source, destination)
                  ├──< quality_inspections >── users
                  ├──< quality_decisions >── quality_inspections
                  ├──< lot_blocks >── quality_inspections, quality_decisions
                  └──< subcontracting_operations >── subcontractors ── locations
                                  └──< subcontracting_results >── locations
```


---

# Phase 2 — Production

## Données de référence de production

### `products`
Référence de production / commerciale. **Un produit n'est pas une espèce** : l'espèce
est la famille de matière première, le produit est ce qui est fabriqué.

| Champ | Rôle |
|---|---|
| `code`, `name` | Référence produit (SPSA-HO, FMHT, …), code unique |
| `species_id` | → `species` : famille de matière première du produit |
| `product_family` | Regroupement commercial facultatif |
| `format`, `pieces_per_can` | Caractéristiques de conditionnement par défaut, séparées de l'identité produit |
| `is_active` | Désactivation, jamais suppression |

Le format et les pièces par boîte restent des colonnes distinctes : le même produit
pourra plus tard exister en plusieurs formats sans casser l'historique de production.

### `production_lines`
Lignes de l'atelier (L1 à L8 en données de démonstration). `display_order` fixe l'ordre
d'affichage. Le nombre de lignes est de la configuration, jamais une constante du code.

### `production_stages`
Étapes du process (traitement, grattage, remplissage). Table de configuration : les
étapes futures (sertissage, stérilisation, emballage) s'ajoutent en données, sans
migration.

### `production_loss_reasons`
Motifs opérationnels rattachés à une catégorie de disposition matière.

| Champ | Rôle |
|---|---|
| `output_type` | `PERTE_REELLE`, `SOUS_PRODUIT`, `REWORK` ou `RECLASSEMENT` |

---

## `production_runs`
**Contexte de transformation.** Un Run ne porte aucune quantité et aucune identité de
lot : les quantités viennent des registres de consommation et de sortie.

| Champ | Rôle |
|---|---|
| `run_code` | Code opérationnel unique (`RUN-20260908-001`) |
| `production_date` | Journée de production |
| `started_at`, `ended_at` | Heures réelles de début et de fin |
| `species_id` | Dérivé du produit, jamais saisi séparément |
| `product_id` | → `products` |
| `format`, `pieces_per_can` | Identité de production du Run (héritées du produit si non précisées) |
| `status` | `PLANIFIE`, `EN_COURS`, `SUSPENDU`, `TERMINE`, `ANNULE` |
| `responsible_user_id` | Responsable du Run |
| `difference_justification`, `justified_by`, `justified_at` | Justification de l'écart matière |
| `cancellation_reason` | Motif obligatoire d'une annulation |

Contraintes : une fin implique un début, une fin est postérieure au début, un Run
terminé a une heure de fin, un Run annulé a un motif, et la justification est complète
(texte + auteur + date) ou totalement absente.

Index : `production_date`, `status`, `product_id`, `species_id`.

## `production_run_lines`
Quelles lignes participent au Run et pour quelle activité.

| Champ | Rôle |
|---|---|
| `activity_type` | `GRATTAGE`, `REMPLISSAGE`, `GRATTAGE_REMPLISSAGE`, `TRAITEMENT`, `INACTIVE`, `AUTRE` |
| `is_active_for_run` | Participation effective |
| `started_at`, `ended_at` | Préparés pour la cadence de la Phase 3 |

L'activité est configurée **par Run** : aucun modèle d'activité n'est imposé à une
espèce. Un même opérateur peut gratter et remplir sur un process sardine, tandis que
les lignes de grattage et de remplissage sont séparées sur un process maquereau.

Contrainte : une ligne n'apparaît qu'une fois par Run.

## `production_run_materials`
**Relation plusieurs-à-plusieurs entre Runs et lots de matière première.** Un Run
consomme plusieurs lots ; un lot alimente plusieurs Runs.

| Champ | Rôle |
|---|---|
| `production_run_id`, `raw_material_lot_id` | Les deux côtés de la relation |
| `source_location_id` | Emplacement réellement déstocké |
| `quantity_kg` | `> 0` |
| `consumed_at` | Heure réelle de la consommation |
| `stock_movement_id` | → `stock_movements`, **unique** : chaque consommation validée possède exactement un mouvement du registre de la Phase 1 |
| `status` | `VALIDE` ou `ANNULE` |
| `reversal_stock_movement_id` | Mouvement d'annulation qui a restitué le stock |
| `cancelled_at`, `cancelled_by`, `cancellation_reason` | Traçabilité de l'annulation |
| `replaces_id` | Ligne de remplacement créée lors d'une correction |

Contraintes : une ligne annulée porte obligatoirement sa date, son auteur, son motif et
son mouvement d'annulation ; une ligne valide n'en porte aucun.

Index : Run, lot, `consumed_at`, statut.

## `production_outputs`
**Registre unique des dispositions matière du Run** : sortie utile, sous-produit,
rework, reclassement et perte réelle.

| Champ | Rôle |
|---|---|
| `output_type` | `SORTIE_UTILE`, `SOUS_PRODUIT`, `REWORK`, `RECLASSEMENT`, `PERTE_REELLE`, `AUTRE` |
| `quantity_kg` | `> 0` |
| `occurred_at` | Heure réelle |
| `production_line_id` | Ligne concernée, facultative |
| `destination_stage_id` | Étape de destination (par exemple remplissage) |
| `destination_location_id`, `derived_lot_id` | Destination et lot dérivé, préparés pour les modules aval |
| `loss_reason_id`, `reason_text` | Motif ; obligatoire pour une perte réelle |
| `status`, `cancelled_*` | Correction par annulation, jamais par modification |

L'écart inexpliqué n'est **jamais** stocké ici : il est calculé, ce qui interdit de
déguiser un écart en perte déclarée.

Index : Run, type, `occurred_at`, statut, ligne.

---

## Vues de calcul de production

| Vue | Contenu |
|---|---|
| `production_run_material_input` | Entrée MP du Run = somme des consommations validées |
| `production_run_output_totals` | Une colonne par catégorie de sortie + total justifié |
| `production_run_material_balance` | Entrée, total justifié, écart en kg et en %, statut du bilan |
| `production_run_yield` | Rendement matière = sortie utile / entrée MP × 100 |
| `lot_production_usage` | Traçabilité aval : quels Runs ont consommé un lot, et combien |

Le seuil de tolérance de l'écart matière (0,50 %) est défini **une seule fois**, dans
`production_run_material_balance`.

## Relations de production

```
species ──< products ──< production_runs >── users (responsable)
                              │
                              ├──< production_run_lines >── production_lines
                              │
                              ├──< production_run_materials >── raw_material_lots
                              │            └── stock_movements (1:1, registre Phase 1)
                              │
                              └──< production_outputs >── production_stages
                                           └── production_loss_reasons
```

---

# Phase 3 — Main-d'œuvre, cadence et arrêts

## Employées

### `employees`
Donnée de référence du personnel de production. **Jamais supprimée** : `is_active`
préserve la validité des contrôles de cadence déjà enregistrés.

| Champ | Rôle |
|---|---|
| `employee_number` | **Matricule**, identifiant opérationnel unique, affiché partout à la place de l'UUID |
| `first_name`, `last_name` | Identité |
| `display_name` | Nom d'affichage explicite, facultatif ; à défaut, `first_name \|\| ' ' \|\| last_name` (jamais ressaisi) |
| `department` | Facultatif |
| `is_active` | Désactivation, jamais suppression |

---

## Personnel du Run

### `production_run_employee_assignments`
Qui est attendu et présent sur quelle ligne d'un Run, et depuis quand.

| Champ | Rôle |
|---|---|
| `production_run_id`, `production_run_line_id`, `employee_id` | Contexte de l'affectation |
| `assigned_from`, `assigned_until` | Ouverture et fermeture de la période ; `assigned_until IS NULL` = affectation active |
| `is_present` | Présence courante |

**Aucune colonne `activity_type`** sur cette table : l'activité d'une employée n'est
jamais stockée deux fois, elle est toujours lue via `production_run_line_id →
production_run_lines.activity_type`. Un même process sardine peut ainsi combiner
grattage et remplissage sur une ligne, tandis qu'un process maquereau les sépare, sans
qu'aucun modèle d'activité ne soit imposé par le schéma des employées.

Un index unique partiel garantit **au plus une affectation ouverte par employée et par
Run** (`WHERE assigned_until IS NULL`). Déplacer une employée vers une autre ligne ferme
l'affectation en cours (`assigned_until = now()`) puis en ouvre une nouvelle : l'historique
n'est jamais réécrit, et les contrôles de cadence déjà liés à l'ancienne ligne le restent.

---

## Tours de contrôle

### `control_rounds`
Un passage d'un contrôleur sur le terrain, pour un Run donné.

| Champ | Rôle |
|---|---|
| `round_code` | Code opérationnel unique (`CTRL-20260908-001`) |
| `production_run_id` | Run concerné |
| `controller_user_id` | Contrôleur |
| `started_at`, `ended_at` | Début et fin réels |
| `status` | `EN_COURS`, `TERMINE`, `ANNULE` |

### `line_controls`
Une ligne visitée pendant un tour.

| Champ | Rôle |
|---|---|
| `control_round_id`, `production_run_line_id` | Contexte |
| `activity_type` | Copié de la ligne du Run au moment de l'ouverture |
| `expected_employee_count` | **Instantané** du nombre de présentes sur la ligne, pris à l'ouverture du contrôle |
| `status` | `EN_COURS`, `TERMINE` |

`controlled_employee_count` n'est **volontairement pas stocké** : c'est toujours le
compte en direct des contrôles de cadence valides, lu depuis la vue
`line_control_coverage`. `expected_employee_count`, à l'inverse, est figé à l'ouverture :
un changement de présence après coup ne réécrit jamais une couverture déjà en cours de
saisie.

Contrainte : une ligne n'est visitée **qu'une seule fois par tour**
(`UNIQUE (control_round_id, production_run_line_id)`) — resélectionner une ligne déjà
visitée reprend son contrôle existant au lieu d'en créer un doublon.

---

## Standards de cadence

### `cadence_standards`
Référence de performance attendue. Donnée de configuration pure.

| Champ | Rôle |
|---|---|
| `species_id`, `product_id`, `format`, `pieces_per_can` | Dimensions de correspondance, chacune facultative (`NULL` = « s'applique à toutes les valeurs ») |
| `activity_type` | Dimension **obligatoire** de la correspondance |
| `size_grade` | Réservée à une phase future — voir ci-dessous |
| `measurement_unit` | `BOITES`, `PIECES`, `KG` ou `UNITES` |
| `standard_cadence` | Cadence attendue, dans l'unité déclarée, par heure |
| `valid_from`, `valid_to` | Fenêtre de validité, facultative |

**`size_grade` n'est jamais fourni par la correspondance de la Phase 3** : un Run peut
consommer plusieurs lots de calibres différents, donc son contexte ne porte aucun
calibre unique et non ambigu. Un standard portant un `size_grade` est donc structurellement
exclu de toute correspondance en Phase 3 ; la colonne existe pour qu'une phase future
puisse l'exploiter sans migration.

Voir « Correspondance d'un standard » dans `docs/regles-metier.md` pour la règle de
sélection déterministe.

---

## Contrôles de cadence

### `employee_cadence_controls`
Une mesure brute et réelle de performance individuelle.

| Champ | Rôle |
|---|---|
| `line_control_id`, `production_run_id`, `production_run_line_id`, `employee_id` | Contexte complet, jamais une mesure isolée |
| `controlled_at` | Horodatage réel de la mesure |
| `quantity_completed` | Quantité réalisée, saisie |
| `measurement_unit` | Unité de la quantité saisie |
| `measurement_duration_seconds` | Durée réelle de mesure, saisie — **jamais** une heure d'horloge rigide |
| `cadence_per_hour` | **Colonne générée** : `quantity_completed / (measurement_duration_seconds / 3600)` |
| `cadence_standard_id` | Standard trouvé au moment de la mesure, ou `NULL` |
| `standard_cadence_snapshot` | **Copie figée** du standard trouvé, ou `NULL` |
| `performance_percent` | **Colonne générée** : `cadence_per_hour / standard_cadence_snapshot × 100`, ou `NULL` si aucun standard |
| `status`, `cancelled_*`, `replaces_id` | Correction par annulation-remplacement (voir `docs/regles-metier.md`) |

`cadence_per_hour` et `performance_percent` sont deux colonnes `GENERATED ALWAYS AS …
STORED` **indépendantes**, toutes deux dérivées des colonnes source
(`quantity_completed`, `measurement_duration_seconds`, `standard_cadence_snapshot`),
jamais l'une de l'autre : PostgreSQL interdit qu'une colonne générée en référence une
autre. Elles ne peuvent donc jamais diverger des valeurs qui les ont produites, et
aucun écran ne les saisit.

`standard_cadence_snapshot` est ce qui garantit qu'un **changement ultérieur** d'un
standard de cadence ne réécrit jamais une performance déjà enregistrée : l'expression
générée lit la copie figée sur la ligne, jamais la table `cadence_standards` en direct.

Un index unique partiel garantit **au plus un contrôle valide par employée et par
contrôle de ligne** (`WHERE status = 'VALIDE'`), ce qui rejette structurellement un
doublon sur la même ligne. La détection d'un doublon sur une **autre** ligne du même
tour (avertissement, non un rejet) est faite en service, pas en base : voir
`docs/regles-metier.md`.

---

## Arrêts de production

### `downtime_categories`
Catégorie d'arrêt, donnée de référence (`code`, `name`, `is_active`).

### `downtime_events`
Une interruption, rattachée à un Run et, facultativement, à une seule de ses lignes.

| Champ | Rôle |
|---|---|
| `production_run_id` | Toujours renseigné |
| `production_run_line_id` | Facultatif : `NULL` = arrêt affectant tout le Run |
| `started_at`, `ended_at` | `ended_at IS NULL` = arrêt **encore ouvert** |
| `duration_seconds` | **Colonne générée**, `NULL` tant que l'arrêt est ouvert |
| `downtime_category_id`, `reason_text`, `planned` | Qualification de l'arrêt |

Il n'existe **aucune colonne `status` séparée** : `ended_at IS NULL` est l'unique
source de vérité de « arrêt actif », ce qui rend une désynchronisation entre un statut
et ses horodatages structurellement impossible. La durée d'un arrêt encore ouvert est
calculée côté interface à l'affichage (rafraîchie périodiquement), jamais écrite en
base tant que l'arrêt n'est pas clôturé.

---

## Vues de calcul de la cadence

| Vue | Contenu |
|---|---|
| `line_control_coverage` | Couverture d'un contrôle de ligne : `controlled_employee_count / expected_employee_count`, statut `COMPLET` / `INCOMPLET` |
| `line_control_cadence` | Cadence de ligne : quantité totale du groupe sur ses heures de main-d'œuvre totales — jamais la moyenne des cadences individuelles |
| `control_round_summary` | Lignes visitées / terminées, employées attendues / contrôlées, couverture globale d'un tour |
| `run_downtime_summary` | Durée totale d'arrêt clôturé, nombre d'arrêts clôturés et d'arrêts actifs, par Run |
| `employee_cadence_history` | Flux réutilisable : une ligne par mesure valide, avec Run, produit, espèce, ligne, activité et employée déjà joints — source unique des écrans Cadence, historique employée et historique ligne |

Ces vues sont la **seule** source des chiffres de couverture, de cadence et d'arrêt,
aussi bien à l'écran que dans les réponses API.

## Relations de main-d'œuvre

```
production_runs ──< production_run_lines ──< production_run_employee_assignments >── employees
       │                     │
       │                     └──< line_controls >── control_rounds
       │                              │
       │                              └──< employee_cadence_controls >── employees
       │                                            └── cadence_standards (via snapshot)
       │
       └──< downtime_events >── downtime_categories
```

---

# Phase 4 — Remplissage, sertissage, marquage, stérilisation, CCP et refroidissement

Chaque table de cette phase porte, directement ou par sa chaîne de tables parentes, une
référence à `production_runs`. Il n'existe aucune opération de remplissage, de
sertissage, de marquage ou de stérilisation détachée d'un Run (section 3 de la
spécification).

## Équipement

### `equipment`
Fondation réutilisable pour les autoclaves, sertisseuses et remplisseuses — jamais un
champ texte libre. `equipment_type` contraint à `SERTISSEUSE`, `AUTOCLAVE`,
`REMPLISSEUSE`, `AUTRE`. `location_id` facultatif. Cette table n'est **pas** une GMAO :
aucun historique de maintenance, aucune notion de panne n'y est portée ; elle est conçue
pour être réutilisée telle quelle par un futur module maintenance.

---

## Remplissage

### `filling_media`
Milieu de couverture, donnée de référence configurable (huile d'olive, huile de
tournesol, sauce tomate, saumure, eau, …). Jamais codé en dur dans un composant
d'interface.

### `product_filling_specs`
Standard de poids configurable et historique, jamais codé en dur (section 8).

| Champ | Rôle |
|---|---|
| `product_id`, `format`, `pieces_per_can` | Portée de la spécification ; `format` et `pieces_per_can` facultatifs (`NULL` = toutes les valeurs) |
| `target_net_weight_g` | Poids net visé, informatif |
| `min_weight_g`, `max_weight_g` | Limites critiques, obligatoires |
| `target_fish_weight_g`, `target_medium_weight_g` | Répartition poisson / milieu visée, informative |
| `valid_from`, `valid_to` | Fenêtre de validité, facultative |

### `filling_operations`
Le contexte de production du remplissage (section 6).

| Champ | Rôle |
|---|---|
| `production_run_id` | Toujours renseigné |
| `production_line_id`, `filling_medium_id` | Facultatifs |
| `format`, `pieces_per_can` | Identité de conditionnement de l'opération |
| `status` | `PLANIFIE`, `EN_COURS`, `TERMINE`, `ANNULE` |

### `filling_weight_controls`
Un événement d'échantillonnage (section 9), rattaché à un Run **et** à une opération de
remplissage. Le nombre d'échantillons est **configurable** (`sample_size`), jamais codé
en dur à 20 (section 11).

Les limites du standard trouvé au moment du contrôle sont **figées** sur la ligne
(`min_weight_g_snapshot`, `max_weight_g_snapshot`, `target_net_weight_g_snapshot`) : un
changement ultérieur de `product_filling_specs` ne réécrit jamais ce contrôle
(section 54).

### `filling_weight_samples`
Une pesée individuelle par ligne (section 10) — jamais des colonnes
`weight_1..weight_20`.

| Champ | Rôle |
|---|---|
| `weight_control_id`, `sample_number` | Contexte et position de l'échantillon |
| `measured_weight_g` | Poids mesuré, saisi |
| `min_weight_g`, `max_weight_g` | **Copie** des limites du contrôle au moment de la saisie |
| `status` | **Colonne générée** : `SOUS_POIDS`, `CONFORME` ou `SURPOIDS`, dérivée uniquement de `measured_weight_g` comparé à `min_weight_g`/`max_weight_g` sur la même ligne |
| `deviation_g` | **Colonne générée** : écart signé par rapport à la limite franchie, `0` si conforme |
| `record_status`, `cancelled_*`, `replaces_id` | Politique de correction par annulation-remplacement (section 58) |

`min_weight_g`/`max_weight_g` sont dupliqués depuis le contrôle parent à l'insertion : PostgreSQL
interdit à une colonne générée de lire une autre table, donc `status` ne peut être un
calcul fiable et automatique qu'en restant sur la même ligne — exactement le même
raisonnement que `cadence_per_hour` en Phase 3. La classification est ainsi
structurellement impossible à saisir manuellement (section 12).

Un index unique partiel garantit **au plus une pesée valide par numéro de boîte**
(`WHERE record_status = 'VALIDE'`).

---

## Sertissage

### `seaming_parameters`
Paramètre de sertissage mesurable, donnée de référence configurable (crochet corps,
crochet couvercle, épaisseur, serrage, …).

### `seaming_specifications`
Limites configurables et historiques par paramètre, produit et format (section 24) —
mêmes principes que `product_filling_specs`.

### `seaming_operations`
Le contexte de production du sertissage (section 20), rattaché au Run et,
facultativement, à une opération de remplissage et à une machine.

### `seaming_controls`
Une inspection qualité du sertissage (section 22).

> **Écart volontaire par rapport à une lecture littérale de la spécification** : cette
> table ne porte **aucune colonne `result`**. Le résultat global d'un contrôle dépend de
> toutes les mesures qui lui sont rattachées, et PostgreSQL ne peut pas générer une
> colonne à partir des lignes d'une autre table — exactement le raisonnement qui garde
> `controlled_employee_count` hors de `line_controls` en Phase 3. `result` se lit
> toujours en direct depuis la vue `seaming_control_result`, jamais stocké, jamais
> saisi manuellement (section 16 appliquée par analogie).

### `seaming_measurements`
Une mesure par ligne (section 23), jamais une colonne par paramètre possible.

| Champ | Rôle |
|---|---|
| `seaming_control_id`, `seaming_parameter_id`, `sample_number` | Contexte de la mesure |
| `measured_value`, `unit` | Valeur mesurée et son unité |
| `specification_id`, `min_value_snapshot`, `max_value_snapshot`, `target_value_snapshot` | Spécification trouvée, **figée** sur la ligne (section 54) |
| `status` | **Colonne générée**, `NON_CONFORME` si une limite figée est franchie, `CONFORME` sinon, `NULL` si aucune limite n'est définie |
| `record_status`, `cancelled_*`, `replaces_id` | Correction par annulation-remplacement (section 58) |

---

## Marquage

### `marking_verification_items`
Points de vérification configurables (code lisible, code correct, date correcte, lot
correct, produit correct, …) — section 26 : « utiliser des points de contrôle
configurables plutôt qu'un champ fixe par vérification possible ».

### `marking_events`
Le codage traçable appliqué avant stérilisation (section 25), rattaché au Run et,
facultativement, à une opération de sertissage. `status` : `A_VERIFIER`, `VERIFIE`,
`NON_CONFORME` — un événement non vérifié ne porte ni vérificateur ni date de
vérification (contrainte `marking_verification_is_documented`).

### `marking_event_checks`
Résultat pass/fail par point de vérification configuré, pour un marquage donné. Le
statut global du marquage est `VERIFIE` si tous les points cochés sont passés,
`NON_CONFORME` dès qu'un seul échoue.

---

## Stérilisation

### `sterilization_programs`
Le barème validé par OCEAMIC (section 30) : température, pression, F0 cible/min/max et
temps de palier cibles. Jamais codé en dur dans l'écran de stérilisation.

### `sterilization_cycles`
L'événement thermique (section 27), une des entités les plus importantes de la
Phase 4.

> **Écart volontaire par rapport à la liste de champs suggérée** : cette table ne porte
> **aucune colonne `production_run_id`**. La section 29 demande explicitement de ne
> jamais supposer qu'un cycle ne contiendra toujours qu'un seul Run, et de préférer une
> table de relation — la relation au Run vit donc exclusivement dans
> `sterilization_cycle_loads` ci-dessous. Une colonne unique aurait soit dupliqué cette
> relation, soit fini par ne plus refléter un cycle chargeant plusieurs Runs.

Les limites critiques du programme sont **figées** au démarrage du chargement
(`target_f0_snapshot`, `minimum_f0_snapshot`, `maximum_f0_snapshot`,
`target_temperature_c_snapshot`, `target_pressure_bar_snapshot`,
`holding_time_seconds_snapshot`) : un changement ultérieur du programme ne réécrit
jamais la décision CCP déjà évaluée d'un cycle (section 54).

`status` : `PLANIFIE`, `EN_CHARGEMENT`, `EN_COURS`, `TERMINE`, `A_VERIFIER`, `BLOQUE`,
`ANNULE` (section 40).

### `sterilization_cycle_loads`
Quels Runs un cycle stérilise (section 29) — conçu, dès l'origine, pour ne jamais
supposer qu'une seule ligne existe. `quantity_units` et `basket_reference` sont
facultatifs.

### `sterilization_measurements`
Mesure de procédé (section 33), distincte d'une décision CCP (section 31).

| Champ | Rôle |
|---|---|
| `temperature_c`, `pressure_bar`, `f0_value`, `phase` | Au moins une valeur mesurée requise |
| `source_type` | `MANUEL`, `EQUIPEMENT`, `IMPORT` — Phase 4 ne produit que `MANUEL` : aucune intégration n'est simulée (section 52) |
| `source_reference`, `imported_at` | Préparés pour une future intégration, sans jamais écraser une saisie manuelle (section 53) |
| `record_status`, `cancelled_*`, `replaces_id` | Correction par annulation-remplacement (section 58) |

### `ccp_controls`
La décision critique de sécurité alimentaire (section 32), structurellement séparée des
mesures de procédé ci-dessus.

| Champ | Rôle |
|---|---|
| `ccp_type` | Ex. « F0 minimum », « température minimale » |
| `result` | `CONFORME`, `NON_CONFORME`, `DEVIATION`, `A_VERIFIER` |
| `decision` | `LIBERE`, `RETENU`, `A_VERIFIER` |
| `controller_user_id` | Toujours une utilisatrice titulaire de `ccp:validate` (Qualité/Admin) — jamais un utilisateur Production seul (section 36) |

---

## Déviations et actions correctives

### `process_deviations`
Un écart documenté (section 37), rattaché à un Run et/ou à un cycle de stérilisation
(au moins l'un des deux, contrainte `deviations_has_scope`). `severity` :
`MINEURE`, `MAJEURE`, `CRITIQUE`. `status` : `OUVERTE`, `EN_ANALYSE`,
`ACTION_REQUISE`, `CLOTUREE`, `ANNULEE`.

### `process_corrective_actions`
Suivi léger d'action corrective (section 38) — pas un CAPA complet. `status` :
`OUVERTE`, `EN_COURS`, `TERMINEE`, `ANNULEE` ; une action `TERMINEE` porte
obligatoirement sa date de clôture.

---

## Refroidissement

### `cooling_events`
Le processus de refroidissement post-stérilisation (section 42), table séparée du cycle
lui-même. `result` facultatif : `CONFORME`, `NON_CONFORME`, `A_VERIFIER`.

### `cooling_measurements`
Une mesure par ligne si plusieurs relevés ont lieu pendant le refroidissement
(section 43) — `parameter` reste un champ texte libre : aucune spécification de
refroidissement n'est demandée par la Phase 4, donc aucun statut n'est calculé
automatiquement ici (à la différence des pesées et des mesures de sertissage).

---

## Retenue de Run

### `production_run_holds`
Réutilise le **cycle de vie du blocage qualité** de la Phase 1 (`ACTIF` → `LEVE`,
motif, audité) plutôt que d'inventer une vérité indépendante (section 41).

| Champ | Rôle |
|---|---|
| `production_run_id` | Toujours renseigné |
| `sterilization_cycle_id`, `process_deviation_id` | Origine de la retenue, facultatifs |
| `status` | `ACTIF`, `LEVE` |
| `released_at`, `released_by`, `release_reason` | Obligatoires dès que `status = 'LEVE'` |

Un index unique partiel garantit **au plus une retenue active par Run**
(`run_holds_one_active_per_run`), exactement comme `lot_blocks_one_active_per_lot` en
Phase 1. Une décision CCP `RETENU` ouvre automatiquement une retenue sur chaque Run
chargé dans le cycle ; la levée reste un acte délibéré et distinct
(`quality:release`), jamais un effet de bord d'une nouvelle décision CCP.

---

## Vues de calcul de la Phase 4

| Vue | Contenu |
|---|---|
| `filling_weight_control_summary` | Moyenne, min, max, répartition sous-poids / conforme / surpoids, pourcentages, statut du contrôle |
| `seaming_control_result` | Nombre de mesures, nombre non conformes, résultat global du contrôle |
| `sterilization_cycle_ccp_status` | Dernière décision et dernier résultat CCP d'un cycle, indicateur de décision retenue |
| `sterilization_cycle_summary` | Couverture des mesures, F0 maximum mesuré, déviations ouvertes, avancement du refroidissement, indicateur de données critiques manquantes |
| `run_hold_status` | Runs actuellement retenus par une décision CCP défavorable |

Ces vues sont la **seule** source des chiffres de classification, de couverture et de
statut de la Phase 4, à l'écran comme dans les réponses API.

## Relations de la Phase 4

```
production_runs ──< filling_operations ──< filling_weight_controls ──< filling_weight_samples
       │                    │                        └── product_filling_specs (via snapshot)
       │                    └── filling_media
       │
       ├──< seaming_operations ──< seaming_controls ──< seaming_measurements
       │            │                                        └── seaming_specifications (via snapshot)
       │            └── equipment (machine)
       │
       ├──< marking_events ──< marking_event_checks >── marking_verification_items
       │
       ├──< sterilization_cycle_loads >── sterilization_cycles ──< sterilization_measurements
       │                                          │            ├──< ccp_controls
       │                                          │            └──< cooling_events ──< cooling_measurements
       │                                          ├── equipment (autoclave)
       │                                          └── sterilization_programs (via snapshot)
       │
       ├──< process_deviations ──< process_corrective_actions
       │
       └──< production_run_holds
```

---

## Emballage

### `packaging_batches`
L'événement de production d'emballage (section 4), distinct du Lot PF qu'il produit
(section 62). Rattaché à un Run et, facultativement, à un cycle de stérilisation.
`status` : `PLANIFIE`, `EN_COURS`, `TERMINE`, `ANNULE`.

### `finished_good_lots`
L'identité de traçabilité du produit fini (section 6), **jamais** le registre de stock
lui-même : la colonne `quality_status` est un statut mis en cache, recalculé par le
service qualité, jamais saisie librement, et son stock physique/bloqué/réservé n'est
jamais stocké ici (voir `finished_good_lot_stock_summary` plus bas).

| Champ | Rôle |
|---|---|
| `packaging_batch_id`, `production_run_id`, `product_id` | Origine |
| `format`, `pieces_per_can` | Snapshot au moment de l'emballage |
| `production_date`, `best_before_date` | DLC facultative, jamais antérieure à la production |
| `quality_status` | `BLOQUE`, `A_VERIFIER`, `LIBERE`, `REJETE` — **jamais `LIBERE` automatiquement** à la création (section 19) |
| `commercial_status` | Champ libre facultatif |

### `finished_good_lot_sources`
La relation plusieurs-à-plusieurs entre un Lot PF et le(s) cycle(s) de stérilisation
qui l'ont produit (section 7) — un Lot PF peut agréger plusieurs cycles, un cycle peut
alimenter plusieurs Lots PF. `quantity_units` facultatif.

### `packaging_outputs`
La sortie de cartonisation **agrégée** (boîtes, cartons, boîtes par carton), et non une
table d'une ligne par carton physique — la section 9 sanctionne explicitement ce choix
pour éviter des millions de lignes sans utilité opérationnelle.

### `packaging_label_checks`
Le contrôle d'étiquette avant palettisation (section 10). `result` est une **colonne
générée** (`GENERATED ALWAYS AS ... STORED`) à partir des quatre booléens de contrôle
(produit, lot, date, étiquette) — jamais une valeur saisie directement, la même
discipline que les statuts calculés de la Phase 4.

---

## Palettes

Réutilise le modèle d'emplacement existant (section 14) : `locations` gagne une
colonne `stock_domain` (`MP`, `PF`, `MIXTE`), avec `MP` par défaut pour préserver le
sens des emplacements des Phases 1-4 sans aucun changement de comportement.

### `pallets`
L'unité de manutention logistique (section 11). Composition fixée à la création et
jamais modifiée ensuite (correction par annulation + nouvelle palette, la même
philosophie « pas de réécriture silencieuse » que partout ailleurs). `status`
(`EN_PREPARATION`, `TERMINEE`, `EN_STOCK`, `RESERVEE`, `EXPEDIEE`, `ANNULEE`) et
`quality_status` (`BLOQUE`, `A_VERIFIER`, `LIBERE`, `REJETE`) sont deux colonnes
totalement séparées, comme statut de procédé et disposition qualité en Phase 4.

### `pallet_contents`
Quel(s) Lot(s) PF, et combien de cartons/unités, une palette porte (section 12) — pas
forcée à un seul lot, mais le cas mono-lot reste le plus courant.

---

## Stock PF et Qualité PF

### `finished_goods_stock_movements`
Le registre de mouvements de stock PF (section 15), un nouveau registre distinct de
`stock_movements` (kilogrammes de matière première contre cartons/unités de produit
fini — deux domaines qu'un mélange aurait confondus).

> **Décision de conception documentée** : chaque mouvement physique réel est suivi à la
> granularité **PALETTE** exclusivement, exactement comme `stock_movements` suit la
> matière première à la granularité LOT + EMPLACEMENT en Phase 1. Un Lot PF n'a jamais
> de position de stock indépendante (section 5) : son stock est toujours la somme, sur
> chaque palette qui le contient (`pallet_contents`), de la position et de la quantité
> courantes de cette palette. `finished_good_lot_id` reste sur cette table à titre
> **informatif et dénormalisé** uniquement (renseigné quand la palette est mono-lot) ;
> les vues de solde par lot dérivent toujours de `pallet_contents`, jamais de cette
> colonne, pour ne jamais avoir deux sources de vérité.

`movement_type` : `ENTREE_PRODUCTION`, `TRANSFERT`, `EXPEDITION`, `RETOUR`,
`AJUSTEMENT`, `BLOCAGE_LOGISTIQUE`. **`RESERVATION` et `LIBERATION_RESERVATION` sont
volontairement absents** : une réservation ne change jamais un emplacement physique, et
la section 16 met elle-même en garde contre la confusion entre un blocage qualité et un
mouvement de stock « sauf si l'emplacement physique change » — le même principe exclut
la réservation ici.

### `finished_goods_quality_decisions` / `finished_goods_quality_blocks`
Un mécanisme **polymorphe** unique et partagé pour les deux nouveaux types d'entité
Phase 5 (`FINISHED_GOOD_LOT`, `PALLET`) plutôt que de dupliquer deux fois la logique
`quality_decisions`/`lot_blocks` de la Phase 1 (section 20). Les tables existantes de
la Phase 1 restent inchangées, spécifiques à la matière première ; ce nouveau couple
suit leur **forme de cycle de vie** (décision → blocage optionnel → levée) par
convention, sans clé étrangère réelle — `entity_id` ne peut pas référencer deux tables
cibles différentes, donc `entity_type` est validé dans la couche service, le même
motif déjà utilisé pour la double portée optionnelle de `process_deviations` en
Phase 4. Un index unique partiel garantit **au plus un blocage actif par entité**
(`fg_blocks_one_active_per_entity`), exactement comme `lot_blocks_one_active_per_lot`.

---

## Expéditions

### `customers`
Donnée de référence client (section 22) : usage expédition/traçabilité uniquement,
jamais un CRM.

### `shipments`
L'événement logistique client (section 62). L'identité conteneur/transport (n° de
conteneur, n° de scellé, température consigne, GENSET) vit directement sur cette table
plutôt que dans une table `containers` séparée : la Phase 5 expédie un seul conteneur
par expédition en pratique, donc une table dédiée n'ajouterait qu'une jointure inutile.
`status` : `PLANIFIEE`, `EN_PREPARATION`, `EN_CHARGEMENT`, `EXPEDIEE`, `ANNULEE`.

### `shipment_lines`
Le contenu confirmé d'une expédition (section 23), toujours par palette — le picking
réel en entrepôt se fait palette par palette. `finished_good_lot_id` reste une
référence informative et dénormalisée (renseignée quand la palette est mono-lot) ; la
composition Lot PF de référence reste toujours `pallet_contents`.

### `stock_reservations`
L'allocation future de stock disponible (section 62), structurellement séparée du
registre de stock physique et de la ligne confirmée de l'expédition. Charger une
palette sur une expédition ouvre une réservation dans la même transaction ; l'index
unique partiel ci-dessous rend le double engagement (section 24) et le double
chargement de la même palette (section 28) structurellement impossibles, pas
seulement empêchés par la logique applicative.

Un index unique partiel garantit **au plus une réservation active par palette**
(`stock_reservations_one_active_per_pallet`), que ce soit pour la même expédition ou
une autre.

---

## Vues de calcul de la Phase 5

Le stock PF n'est jamais stocké, avec la même discipline qu'en Phase 1 : il est
toujours calculé depuis le registre de mouvements.

| Vue | Contenu |
|---|---|
| `fg_stock_ledger_entries` | Chaque mouvement de stock PF transformé en ligne signée (entrée = positive, sortie = négative), comme `stock_ledger_entries` en Phase 1 |
| `pallet_stock_balance` | Position physique de chaque palette : au plus un emplacement avec un solde non nul par palette |
| `pallet_summary` | Position, réservation et statut qualité d'une palette en une ligne, pour les écrans liste/détail |
| `finished_good_lot_stock_summary` | Cartons/unités physiques, bloqués et réservés d'un Lot PF, toujours dérivés en attribuant la position de chaque palette via `pallet_contents` — un Lot PF ne porte jamais sa propre position de stock (section 5) |
| `fg_stock_by_location` | Stock PF agrégé par emplacement et par produit, pour les cartes de synthèse de l'écran Stock PF |

Sur `finished_good_lot_stock_summary`, les cartons d'une palette comptent comme
bloqués si la palette **ou** le Lot PF qu'elle porte est `BLOQUE` : un blocage au
niveau palette est un problème de manutention affectant tout ce qu'elle porte, un
blocage au niveau Lot PF est un problème produit affectant seulement les cartons de ce
lot, où qu'ils se trouvent physiquement.

## Relations de la Phase 5

```
production_runs ──< finished_good_lot_sources >── sterilization_cycles
       │                       │
       │                       └── finished_good_lots ──< packaging_outputs
       │                                  │              ├──< packaging_label_checks
       │                                  │              └──< pallet_contents >── pallets
       │                                  │                                          │
       │                                  └──< finished_goods_quality_decisions/blocks (entity_type='FINISHED_GOOD_LOT')
       │                                                                             │
       └──< packaging_batches ──< finished_good_lots                                 │
                                                                                       ├── finished_goods_stock_movements
                                                                                       ├── finished_goods_quality_decisions/blocks (entity_type='PALLET')
                                                                                       ├──< stock_reservations >── shipments >── customers
                                                                                       └──< shipment_lines >── shipments

raw_material_lots ──< production_run_materials >── production_runs   (traçabilité avant/arrière, sections 32-33)
```
