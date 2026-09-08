# Modèle de données — OCEAMIC IMS Phases 1 et 2

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
