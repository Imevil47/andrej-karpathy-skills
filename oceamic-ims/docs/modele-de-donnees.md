# Modèle de données — OCEAMIC IMS Phase 1

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
