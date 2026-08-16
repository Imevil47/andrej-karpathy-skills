# OCEAMIC — Gestion d'Exploitation

## Document de conception (à valider avant tout développement)

Ce document présente l'architecture proposée. **Aucun code n'est écrit tant que tu n'as pas validé.**

Tout ce qui n'est pas connu sur OCEAMIC est marqué **[À CONFIGURER]** : ce n'est pas inventé, c'est prévu comme paramètre modifiable dans l'application.

---

## 1. Architecture générale

### Principe

Trois blocs séparés, qui communiquent par une API REST :

```
   NAVIGATEUR                  SERVEUR                    BASE DE DONNÉES
┌────────────────┐        ┌────────────────┐          ┌────────────────┐
│                │  HTTP  │                │   SQL    │                │
│   FRONTEND     │ ─────► │    BACKEND     │ ───────► │   PostgreSQL   │
│  React + TS    │ ◄───── │ Node + Express │ ◄─────── │                │
│                │  JSON  │                │          │                │
│ PC / Tablette  │        │ - validation   │          │ - données      │
│ / Téléphone    │        │ - calculs KPI  │          │ - historique   │
│                │        │ - droits       │          │ - audit        │
└────────────────┘        └────────────────┘          └────────────────┘
```

**Pourquoi cette séparation ?**

- Le **frontend** ne fait qu'afficher et saisir. Il ne décide rien d'important.
- Le **backend** est le seul à écrire en base. C'est là que sont les règles (validation, droits, calculs). Personne ne peut les contourner, même en bidouillant le navigateur.
- La **base** garde tout l'historique. Rien n'est effacé (voir §32 : soft delete).

### Un troisième dossier : `shared`

Les formules (cadence, rendement, productivité…) sont écrites **une seule fois** dans un dossier `shared/`, utilisé à la fois par le frontend et le backend.

**Pourquoi ?** Si la formule de cadence est écrite deux fois, un jour l'une des deux sera modifiée et pas l'autre → l'écran affichera un chiffre, le rapport un autre. Avec `shared/`, c'est impossible.

L'opérateur voit donc le calcul en direct pendant sa saisie (frontend), et le backend refait exactement le même calcul avant d'enregistrer (source de vérité).

### Ce qu'on ne fait PAS maintenant

Pas de microservices, pas de Docker Kubernetes, pas de GraphQL, pas de Redis, pas de temps réel WebSocket. Une usine de cette taille n'en a pas besoin, et chaque brique en plus est une brique à maintenir.

---

## 2. Architecture frontend / backend

### Backend — 4 couches

Une requête traverse toujours les mêmes étapes, dans le même ordre :

```
  Requête HTTP
       │
       ▼
  1. ROUTE           « quelle URL, quel rôle a le droit ? »
       │             (routes/production.routes.ts)
       ▼
  2. VALIDATION      « les données sont-elles correctes ? »
       │             (schémas Zod — quantité > 0, fin >= début…)
       ▼
  3. SERVICE         « la règle métier »
       │             (calculs, cohérence, écriture audit)
       ▼
  4. REPOSITORY      « lire / écrire en base »
       │             (SQL uniquement, aucune logique)
       ▼
  PostgreSQL
```

**Règle stricte :** aucun calcul dans les routes, aucun SQL dans les services. Chaque fichier a un seul rôle. C'est ce qui rend le code lisible dans 2 ans.

### Frontend — organisation par module métier

```
frontend/src/
├── features/          un dossier par module (reception, grattage, arrets…)
│   └── grattage/
│       ├── GrattagePage.tsx        l'écran
│       ├── GrattageForm.tsx        le formulaire de saisie
│       ├── useGrattage.ts          l'appel API
│       └── grattage.types.ts
├── components/        briques réutilisées partout (bouton, table, KpiCard…)
├── layouts/           menu, en-tête, structure de page
└── lib/               appel API, authentification, formatage
```

**Pourquoi par module et pas par type de fichier ?** Quand tu me diras « le formulaire de grattage a un problème », tout est dans un seul dossier.

### Sécurité (dès la phase 1)

| Risque | Protection |
|---|---|
| Mot de passe volé en base | Hachage `bcrypt` (impossible à relire) |
| Session volée | JWT court (15 min) + refresh token en cookie `httpOnly` |
| Opérateur qui accède au module Objectifs | Contrôle du rôle **côté backend** sur chaque route |
| Injection SQL | Requêtes paramétrées uniquement |
| Secrets dans le code | Fichier `.env`, jamais commité (`.env.example` fourni) |
| Attaque par force brute sur le login | Limitation du nombre de tentatives |

---

## 3. Modèle de données

### 3.1 Vue d'ensemble

Trois familles de tables :

| Famille | Rôle | Fréquence de modification |
|---|---|---|
| **Référentiel** | produits, postes, lignes, employés, causes d'arrêt | rare (paramétrage) |
| **Exploitation** | réceptions, production, arrêts, stocks | permanente (saisie quotidienne) |
| **Pilotage** | objectifs, seuils d'alerte, actions, audit | régulière |

### 3.2 Référentiel

| Table | Colonnes principales |
|---|---|
| `roles` | `id`, `code` (ADMIN / RESP_EXPLOITATION / CHEF_POSTE / OPERATEUR / QUALITE), `label` |
| `users` | `id`, `username`, `password_hash`, `full_name`, `role_id`, `employee_id?`, `is_active` |
| `species` | `id`, `code`, `label` — espèces **[À CONFIGURER]** |
| `products` | `id`, `code`, `label`, `species_id`, `default_format_id`, `is_active` |
| `formats` | `id`, `code`, `label`, `nominal_weight_g`, `boxes_per_carton`, `cartons_per_pallet` |
| `suppliers` | `id`, `code`, `label`, `type` (fournisseur / origine) |
| `workstations` | `id`, `code`, `label`, `process_step`, `nominal_capacity?`, `is_active` |
| `production_lines` | `id`, `code`, `label`, `is_active` |
| `equipments` | `id`, `code`, `label`, `type` (CUISEUR / AUTOCLAVE / SERTISSEUSE / AUTRE), `line_id?` |
| `teams` | `id`, `code`, `label`, `shift_start?`, `shift_end?` — équipes **[À CONFIGURER]** |
| `employees` | `id`, `matricule` (unique), `first_name`, `last_name`, `team_id?`, `workstation_id?`, `status` |
| `locations` | `id`, `code`, `label`, `type` (MATIERE / EN_COURS / PRODUIT_FINI) |
| `stoppage_causes` | `id`, `category`, `code`, `label`, `is_active` |
| `loss_causes` | `id`, `code`, `label`, `process_step?`, `is_active` |
| `app_settings` | `key`, `value` (JSON), `updated_by` — tout ce qui est **[À CONFIGURER]** |

`process_step` est une liste fermée, dans l'ordre du flux :

```
RECEPTION → STOCK_MATIERE → TRAITEMENT → CUISSON → GRATTAGE →
REMPLISSAGE → SERTISSAGE → STERILISATION → CONDITIONNEMENT →
PRODUIT_FINI → EXPEDITION
```

### 3.3 Exploitation

**`lots`** — le fil conducteur de toute la traçabilité

| Colonne | Détail |
|---|---|
| `id`, `code` | ex. `SAR-20260816-001`, généré automatiquement, unique |
| `product_id`, `species_id` | |
| `reception_id` | réception d'origine |
| `reception_date`, `status` | EN_COURS / TERMINE / BLOQUE / ANNULE |
| `parent_lot_id?` | si un lot est divisé ou regroupé plus tard |

**`receptions`** — date, heure, produit, espèce, lot, fournisseur, quantité, unité, destination (`location_id`), observation, `created_by`, `status`.

**`stock_movements`** — toute variation de stock, matière **et** produit fini :

`id`, `movement_date`, `movement_type` (ENTREE / CONSOMMATION / TRANSFERT / PERTE / AJUSTEMENT), `lot_id`, `product_id`, `quantity`, `unit` (KG / BOITES), `location_from?`, `location_to?`, `loss_cause_id?`, `reference_type` + `reference_id` (d'où vient le mouvement : réception, production, expédition), `created_by`.

> **Règle :** on ne stocke jamais un « niveau de stock ». Le stock est **toujours** la somme des mouvements. Un chiffre stocké finit par mentir ; une somme, jamais. Le stock physique saisi lors d'un inventaire devient un mouvement de type AJUSTEMENT, et l'écart reste visible.

**`production_records`** — le cœur de l'application

Une seule table pour **toutes** les étapes de production (traitement, cuisson, grattage, remplissage, sertissage, stérilisation, conditionnement), distinguées par la colonne `process_step`.

*Pourquoi une seule table et pas sept ?* Parce que les 80 % de colonnes communes (date, lot, horaires, effectif, arrêts) sont identiques, et surtout parce que le dashboard, la traçabilité et les KPI interrogent **toutes les étapes ensemble**. Avec sept tables, chaque écran de synthèse devient une requête à sept branches — lourde à écrire et à faire évoluer.

| Groupe | Colonnes |
|---|---|
| Identité | `id`, `process_step`, `record_date`, `product_id`, `lot_id`, `team_id?`, `shift?` |
| Lieu | `workstation_id?`, `line_id?`, `equipment_id?` |
| Temps | `start_time`, `end_time`, `waiting_minutes?` (attente avant poste, ex. stérilisation) |
| Entrée | `qty_in`, `qty_in_unit`, `boxes_in?` |
| Sortie | `qty_out`, `qty_out_unit`, `boxes_out?`, `avg_weight_g?` |
| Qualité expl. | `rejects?` (sertissage), `losses?`, `loss_cause_id?` |
| Aval | `cartons?`, `pallets?` (conditionnement) |
| Stérilisation | `cycle_ref?` |
| Main-d'œuvre | `headcount`, `worked_minutes?` |
| Suivi | `observation?`, `status` (BROUILLON / VALIDE / ANNULE), `created_by`, `created_at`, `updated_at` |

Les colonnes non pertinentes pour une étape restent vides, et **la validation backend impose les champs obligatoires étape par étape** (ex. `boxes_out` et `avg_weight_g` obligatoires en grattage, `rejects` obligatoire en sertissage). Une table de règles par étape est fournie en §4 du futur doc technique.

**`hourly_production`** — le suivi horaire du grattage (§12) et de tout poste où il est utile :

`id`, `production_record_id`, `hour_slot` (08:00, 09:00…), `boxes`, `quantity_kg?`, `headcount?`, `comment?`.

**`stoppages`** — tous les arrêts, centralisés :

`id`, `stoppage_date`, `production_record_id?`, `workstation_id?`, `line_id?`, `start_time`, `end_time`, `duration_minutes` (calculée), `cause_id` (→ catégorie), `comment?`, `responsible_user_id?`, `action_id?`, `created_by`.

**`employee_work`** — présence et heures :

`id`, `work_date`, `employee_id`, `team_id?`, `workstation_id?`, `production_record_id?`, `is_present`, `hours_worked`, `overtime_hours?`.

**`finished_products`** — stock produit fini par lot : `id`, `lot_id`, `product_id`, `format_id`, `production_date`, `boxes`, `cartons`, `pallets`, `location_id`, `status`. Alimenté par le conditionnement, diminué par les expéditions (avec le mouvement correspondant dans `stock_movements`).

**`shipments`** + **`shipment_lines`** — expéditions : en-tête (date, destination, référence, `status`) et lignes (lot, produit, boîtes, cartons, palettes).

### 3.4 Pilotage

| Table | Colonnes |
|---|---|
| `objectives` | `id`, `metric` (QUANTITE / CADENCE / RENDEMENT / PRODUCTIVITE), `scope` (JOUR / HEURE / LIGNE / PRODUIT / POSTE), `product_id?`, `line_id?`, `workstation_id?`, `process_step?`, `target_value`, `unit`, `valid_from`, `valid_to?` |
| `alert_rules` | `id`, `code`, `metric`, `comparator` (`<`, `>`, `<=`, `>=`), `threshold_value`, `threshold_type` (ABSOLU / % DE L'OBJECTIF), `severity` (🔴 / 🟠 / 🟡), `scope`, `is_active` |
| `actions` | `id`, `code`, `title`, `problem`, `cause?`, `action`, `responsible_user_id`, `created_at`, `deadline?`, `status` (NOUVEAU / EN_COURS / TERMINE / VERIFIE), `priority?`, `source_type?` + `source_ref?` (l'alerte ou le KPI d'origine), `comment?`, `closed_at?` |
| `audit_logs` | `id`, `user_id`, `entity_table`, `entity_id`, `action` (CREATE / UPDATE / CANCEL), `old_values` (JSON), `new_values` (JSON), `created_at`, `ip_address?` |

**Note importante sur les alertes :** les seuils sont stockés (`alert_rules`), mais les alertes elles-mêmes sont **calculées à l'affichage**, pas stockées. Sinon, corriger une saisie erronée laisserait une fausse alerte figée dans la base.

### 3.5 Relations principales

```
                    ┌──────────┐
                    │ products │───────┐
                    └─────┬────┘       │
                          │            ▼
  ┌────────────┐    ┌─────▼────┐   ┌──────────────────┐
  │ suppliers  │───►│receptions│──►│      lots        │◄── LE FIL TRAÇABILITÉ
  └────────────┘    └──────────┘   └────────┬─────────┘
                                            │ 1 lot → N enregistrements
                          ┌─────────────────┼─────────────────┐
                          ▼                 ▼                 ▼
                 ┌─────────────────┐ ┌──────────────┐ ┌──────────────────┐
                 │production_records│ │stock_movements│ │finished_products │
                 └────────┬─────────┘ └──────────────┘ └────────┬─────────┘
                          │                                     │
              ┌───────────┼───────────┐                         ▼
              ▼           ▼           ▼                  ┌─────────────┐
      ┌──────────────┐ ┌─────────┐ ┌──────────────┐      │  shipments  │
      │hourly_produc.│ │stoppages│ │employee_work │      └─────────────┘
      └──────────────┘ └────┬────┘ └──────┬───────┘
                            ▼             ▼
                   ┌────────────────┐ ┌──────────┐
                   │stoppage_causes │ │employees │
                   └────────────────┘ └──────────┘
```

**Pas de duplication :** un produit est écrit une seule fois dans `products`, et partout ailleurs on n'utilise que son `id`. Renommer un produit se fait à un seul endroit.

---

## 4. Liste complète des pages

### Accès et pilotage
| # | Page | Contenu |
|---|---|---|
| 1 | Connexion | login / mot de passe |
| 2 | **Dashboard — Exploitation du jour** | KPI, production horaire objectif vs réel, Pareto arrêts, performance par poste, alertes, actions ouvertes |

### Saisie du flux (une page par étape)
| # | Page | Saisie principale |
|---|---|---|
| 3 | Réception | produit, espèce, lot, fournisseur, quantité, heure, destination |
| 4 | Stock matière | mouvements, stock théorique vs physique, écart |
| 5 | Traitement | entrée / sortie, rendement, pertes |
| 6 | Cuisson | avant / après cuisson, perte cuisson % |
| 7 | **Grattage** (prioritaire) | suivi horaire, boîtes, poids moyen, cadence, productivité |
| 8 | Remplissage | boîtes, format, poids moyen, cadence |
| 9 | Sertissage | boîtes entrées / serties, rejets, taux de rejet |
| 10 | Stérilisation | cycles, temps d'attente, goulot |
| 11 | Conditionnement | boîtes → cartons → palettes |
| 12 | Produit fini | stock PF par lot |
| 13 | Expéditions | sorties de stock PF |

### Support
| # | Page | Contenu |
|---|---|---|
| 14 | Arrêts | saisie et liste centralisée, filtres, totaux par cause |
| 15 | Main-d'œuvre | présence, effectif, heures, productivité |
| 16 | Objectifs | définition et comparaison objectif / réel / écart |

### Analyse
| # | Page | Contenu |
|---|---|---|
| 17 | Performance / KPI | tous les indicateurs, par jour / semaine / mois, par poste, équipe, produit |
| 18 | Pareto | Pareto des arrêts et Pareto des pertes |
| 19 | Bottleneck | goulot du jour, avec explication |
| 20 | Plan d'actions | création et suivi des actions |
| 21 | **Traçabilité** | recherche d'un lot → tout son parcours avec les quantités |
| 22 | Historique / Export | filtres complets, export Excel / CSV |

### Administration
| # | Page | Contenu |
|---|---|---|
| 23 | Paramètres — Référentiels | produits, espèces, formats, postes, lignes, équipements, équipes, emplacements |
| 24 | Paramètres — Causes | causes d'arrêt et de perte |
| 25 | Paramètres — Alertes | seuils configurables |
| 26 | Utilisateurs | comptes et rôles |
| 27 | Journal d'audit | qui a modifié quoi, quand |

**Total : 27 pages.**

---

## 5. Rôles et droits

| Page / Module | ADMIN | RESP. EXPLOITATION | CHEF DE POSTE | OPÉRATEUR | QUALITÉ |
|---|---|---|---|---|---|
| Dashboard | ✅ | ✅ | ✅ | 👁️ son poste | 👁️ |
| Réception | ✅ | ✅ | ✏️ | ✏️ | 👁️ |
| Stock matière | ✅ | ✅ | 👁️ | — | 👁️ |
| Saisie production (5→11) | ✅ | ✅ | ✏️ | ✏️ son poste | 👁️ |
| Produit fini / Expéditions | ✅ | ✅ | ✏️ | — | 👁️ |
| Arrêts | ✅ | ✅ | ✏️ | ✏️ | 👁️ |
| Main-d'œuvre | ✅ | ✅ | ✏️ son équipe | — | — |
| Objectifs | ✅ | ✅ | 👁️ | — | — |
| Performance / Pareto / Bottleneck | ✅ | ✅ | 👁️ | — | 👁️ |
| Plan d'actions | ✅ | ✅ | ✏️ | — | 👁️ |
| Traçabilité | ✅ | ✅ | 👁️ | — | ✅ |
| Historique / Export | ✅ | ✅ | 👁️ | — | 👁️ |
| Paramètres / Utilisateurs / Audit | ✅ | 👁️ | — | — | — |

✅ complet · ✏️ saisie + consultation, **modification limitée à sa propre saisie du jour** · 👁️ consultation seule · — aucun accès

**Point clé demandé (§28) :** le rôle QUALITÉ voit tout ce qui concerne la traçabilité mais ne saisit rien en exploitation. Les responsabilités ne se mélangent pas.

---

## 6. Workflow de production

```
① RÉCEPTION ─────────► création du LOT (SAR-20260816-001)
   entrée : kg reçus                    → mouvement ENTREE
        │
        ▼
② STOCK MATIÈRE ─────► stock = Σ mouvements
        │                              → mouvement CONSOMMATION
        ▼
③ TRAITEMENT ────────► qty_in kg → qty_out kg
   calcule : durée, rendement %, perte kg, perte %
        │
        ▼
④ CUISSON ───────────► qty_in kg → qty_out kg   (équipement = cuiseur)
   calcule : perte cuisson %
        │
        ▼
⑤ GRATTAGE ★ ────────► kg → BOÎTES  ⚠️ changement d'unité
   suivi horaire 08h/09h/10h…
   calcule : cadence (boîtes/h), heures-personnes, productivité
        │
        ▼
⑥ REMPLISSAGE ───────► boîtes + format + poids moyen
   calcule : cadence, productivité, pertes
        │
        ▼
⑦ SERTISSAGE ────────► boîtes entrées → boîtes serties + rejets
   calcule : taux de rejet %, cadence
        │
        ▼
⑧ STÉRILISATION ─────► par CYCLE + autoclave
   mesure : temps d'attente ← source classique de goulot
        │
        ▼
⑨ CONDITIONNEMENT ───► boîtes → cartons → palettes
        │
        ▼
⑩ PRODUIT FINI ──────► stock PF par lot
        │
        ▼
⑪ EXPÉDITION ────────► sortie de stock PF
```

**Deux points d'attention techniques :**

1. **Le changement d'unité au grattage** (kg → boîtes). Avant : tout en kg. Après : tout en boîtes. Le pont entre les deux est le **poids moyen par boîte**. C'est pourquoi `avg_weight_g` est obligatoire à cette étape — sans lui, on ne peut plus relier la matière consommée au produit fini.

2. **Le lot reste le même du début à la fin.** À chaque étape, on enregistre le `lot_id`. C'est ce qui permet la page Traçabilité : une recherche sur `MAQ-20260816-003` remonte les 11 étapes avec les quantités.

---

## 7. KPI et formules

Toutes ces formules sont écrites **une seule fois**, dans `shared/src/kpi/`.

| KPI | Formule | Unité |
|---|---|---|
| Durée | `heure_fin - heure_début` | minutes |
| Temps productif | `durée - temps d'arrêt` | minutes |
| Rendement | `qty_out / qty_in × 100` | % |
| Perte | `qty_in - qty_out` | kg ou boîtes |
| Taux de perte | `perte / qty_in × 100` | % |
| Perte cuisson | `(qty_avant - qty_après) / qty_avant × 100` | % |
| Cadence | `boîtes / temps_productif_heures` | boîtes/h |
| Heures-personnes | `effectif × temps_travaillé_heures` | h·p |
| Productivité | `boîtes / heures-personnes` | boîtes/h·p |
| Taux de rejet | `rejets / boîtes_entrées × 100` | % |
| Temps d'arrêt | `Σ durées des arrêts` | minutes |
| Temps d'attente | `Σ waiting_minutes` | minutes |
| Taux de réalisation | `réel / objectif × 100` | % |
| Écart | `réel - objectif` | même unité |
| Stock théorique | `initial + entrées - consommations - transferts - pertes` | kg |
| Écart de stock | `stock_physique - stock_théorique` | kg |

### Règles de calcul (§30) — comment on gère les cas limites

| Situation | Comportement |
|---|---|
| Division par zéro | Le KPI vaut `null`, affiché « — ». **Jamais 0** : 0 voudrait dire « très mauvais », `null` veut dire « pas calculable ». La différence compte pour décider. |
| Donnée manquante | KPI `null` + mention « données incomplètes ». Pas de valeur inventée. |
| `qty_out > qty_in` | Enregistrement **refusé**, message : « La sortie ne peut pas dépasser l'entrée. Vérifie les quantités. » |
| Heure fin < heure début | Refusé, sauf poste de nuit → case « équipe de nuit » à cocher explicitement |
| Quantité négative ou nulle | Refusée |
| Lot inexistant | Refusé, avec proposition de créer la réception d'abord |
| Doublon (même lot, poste, horaire) | Alerte à la saisie, confirmation demandée |
| Arrondis | Aucun arrondi en base. Les valeurs brutes sont conservées, l'arrondi est **uniquement à l'affichage** (1 décimale pour les %, 0 pour les boîtes) |

**Règle absolue :** l'application ne modifie jamais silencieusement une donnée saisie. Soit elle accepte, soit elle refuse avec un message clair en français.

### Alertes (§25) — seuils configurables

| Règle par défaut | Niveau |
|---|---|
| Cadence < 90 % de l'objectif | 🔴 |
| Rendement < objectif | 🟠 |
| Arrêt > 20 minutes | 🔴 |
| Stock < seuil | 🟡 |
| Temps d'attente > seuil | 🟠 |
| Production < objectif du jour | 🟠 |

Ces valeurs sont **des valeurs de départ modifiables dans l'écran Paramètres — Alertes**, pas des constantes dans le code.

### Bottleneck (§23)

Le poste goulot du jour est celui qui cumule le plus mauvais score sur : capacité la plus faible, temps d'arrêt le plus long, temps d'attente le plus long, perte la plus forte, écart à l'objectif le plus grand. L'écran affiche **le poste et la raison** (« Stérilisation — 145 min d'attente cumulée, 3 cycles retardés »), pas seulement un nom.

---

## 8. Structure du projet

```
oceamic/
├── README.md
├── package.json                    workspaces : frontend, backend, shared
├── .env.example                    modèle (le vrai .env n'est jamais commité)
│
├── docs/
│   ├── 00-ARCHITECTURE.md          ce document
│   ├── 01-DATABASE.md              schéma détaillé
│   ├── 02-API.md                   documentation des endpoints
│   └── 03-INSTALLATION.md          installation pas à pas
│
├── database/
│   ├── migrations/                 001_init.sql, 002_referentiel.sql…
│   ├── seeds/                      données de départ (rôles, causes d'arrêt)
│   └── schema.sql                  schéma complet de référence
│
├── shared/                         ⭐ utilisé par frontend ET backend
│   └── src/
│       ├── kpi/                    TOUTES les formules
│       ├── types/                  types partagés
│       ├── constants/              étapes, statuts, catégories d'arrêt
│       └── validation/             schémas Zod (mêmes règles des deux côtés)
│
├── backend/
│   └── src/
│       ├── config/                 env, connexion base
│       ├── middleware/             auth, rôles, erreurs, audit
│       ├── modules/                un dossier par module métier
│       │   └── production/
│       │       ├── production.routes.ts
│       │       ├── production.service.ts
│       │       ├── production.repository.ts
│       │       └── production.schema.ts
│       ├── utils/
│       └── server.ts
│
└── frontend/
    └── src/
        ├── features/               un dossier par module (cf. §2)
        ├── components/             ui/ (Button, Input, Table…) + charts/ + kpi/
        ├── layouts/
        ├── lib/                    api, auth, format
        ├── hooks/
        └── App.tsx
```

**Règles de fichiers :** maximum ~200 lignes par fichier. Au-delà, on découpe. Un fichier de 800 lignes est un fichier que personne ne relit.

---

## 9. Plan de développement par phases

Chaque phase se termine par un test que **tu** fais, et je n'enchaîne pas sans ta validation.

| Phase | Contenu | Ce que tu pourras tester à la fin |
|---|---|---|
| **1** | Architecture + base de données + authentification | Me connecter, voir un menu adapté à mon rôle |
| **2** | Dashboard de base (structure, cartes KPI vides) | Voir la page d'accueil et sa mise en page |
| **3** | Réception + Stock matière | Saisir une réception, voir le lot créé et le stock bouger |
| **4** | Traitement | Saisir un traitement, voir rendement et pertes calculés |
| **5** | Cuisson + **Grattage** (prioritaire) | Saisir le suivi horaire, voir cadence et productivité |
| **6** | Remplissage + Sertissage | Saisir, voir cadence et taux de rejet |
| **7** | Stérilisation + Conditionnement | Saisir les cycles, voir les temps d'attente |
| **8** | Arrêts + Main-d'œuvre | Saisir les arrêts, voir les totaux par cause |
| **9** | KPI + Pareto + Bottleneck + Objectifs | Dashboard complet et vivant avec de vraies données |
| **10** | Actions d'amélioration + Alertes | Créer une action depuis une alerte, la suivre |
| **11** | Traçabilité + Historique + Export | Rechercher un lot, exporter en Excel |
| **12** | Tests + sécurité + déploiement | Application installée et utilisable en usine |

**Un ajustement d'ordre que je te propose :** la phase 2 (dashboard) affichera au départ une structure avec des valeurs vides, puisqu'aucune donnée n'existe encore. Le dashboard **réel** se remplit progressivement aux phases 3 à 9. C'est normal, et c'est mieux ainsi : tu valides la mise en page tôt, sans attendre.

---

## 10. Points à confirmer avant la phase 1

Ces informations concernent OCEAMIC et je ne les inventerai pas. Elles ne bloquent pas le démarrage : je les mets en **paramètres modifiables** avec des valeurs neutres, et tu les renseigneras dans l'écran Paramètres.

| # | Question | Impact |
|---|---|---|
| 1 | Combien d'utilisateurs simultanés environ ? | Dimensionnement du serveur |
| 2 | Serveur local dans l'usine, ou cloud ? | Installation (phase 12) |
| 3 | Nombre de lignes de production et de postes ? | Données de départ |
| 4 | Nombre d'équipes et horaires (2×8 ? 3×8 ?) | Découpage des journées et suivi horaire |
| 5 | Format des codes de lot : `SAR-20260816-001` convient-il ? | Génération automatique |
| 6 | Unité de la matière première : kg uniquement ? | Cohérence des calculs |
| 7 | Produits et espèces traités | Référentiel |
| 8 | Formats de boîtes utilisés | Référentiel |

---

## Ce que j'attends de toi

1. **Valides-tu cette architecture ?** (oui / non / avec ces changements)
2. Le modèle de données correspond-il à la réalité de l'usine ?
3. Ai-je oublié une étape du flux ou un besoin important ?
4. Les réponses aux 8 questions du §10 (ou « on verra plus tard » — l'application le permet).

**Après ta validation, je commence uniquement la PHASE 1 : architecture + base de données + authentification.**
