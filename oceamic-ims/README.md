# OCEAMIC IMS — Phases 1 et 2

Système de gestion industrielle pour la conserverie de poisson OCEAMIC.

La **Phase 1** couvre le socle technique et les modules **matière première, stock
interne et externe, sous-traitance, qualité et traçabilité**.

La **Phase 2** ajoute la couche **flux matière de production** : ordres de production,
consommation de matière première, sorties, pertes, sous-produits, rework,
reclassement, bilan matière et rendement.

Les modules cadence de main-d'œuvre, remplissage, sertissage, stérilisation, produits
finis, palettes et expédition ne sont pas construits ici, mais l'architecture est
conçue pour les accueillir sans refonte.

L'interface utilisateur est intégralement en français. Le code, les noms de tables et
les commentaires techniques sont en anglais.

---

## 1. Architecture

```
oceamic-ims/
├── server/                 API REST + logique métier (Node.js, TypeScript, Fastify)
│   ├── src/
│   │   ├── config.ts       Chargement et validation de l'environnement (Zod)
│   │   ├── errors.ts       Erreurs métier avec messages français
│   │   ├── app.ts          Assemblage Fastify (auth, gestion d'erreurs, routes)
│   │   ├── db/
│   │   │   ├── migrations/ Migrations SQL numérotées
│   │   │   ├── migrate.ts  Exécuteur de migrations
│   │   │   ├── reset.ts    Réinitialisation du schéma (dev / test uniquement)
│   │   │   ├── seed.ts     Données de démonstration
│   │   │   └── pool.ts     Pool PostgreSQL et helper de transaction
│   │   ├── domain/         Types, permissions, arithmétique des quantités (pur)
│   │   ├── services/       Logique métier transactionnelle
│   │   ├── http/           Session, permissions, schémas de validation
│   │   └── routes/         Endpoints REST
│   └── tests/              Tests automatisés sur une vraie base PostgreSQL
└── web/                    Interface opérationnelle (React, Vite, TypeScript)
    └── src/
        ├── api.ts          Client HTTP
        ├── auth.tsx        Session et droits côté interface
        ├── components/     Mise en page et composants partagés
        └── pages/          Écrans opérationnels
```

**Séparation des responsabilités**

| Couche | Rôle |
|---|---|
| Base de données | Intégrité structurelle : clés, contraintes CHECK, unicité, vues de stock |
| `services/` | Règles métier, transactions, verrous, audit |
| `routes/` | Validation des entrées (Zod), contrôle des permissions, traduction HTTP |
| `web/` | Saisie et affichage uniquement — aucun calcul de stock côté client |

### Pile technique

- PostgreSQL 16
- Node.js 22, TypeScript 5.9 (mode strict)
- Fastify 5, `pg`, Zod 4
- React 19, Vite 7, React Router 7
- Tests : exécuteur natif `node --test`, sur une base PostgreSQL réelle

Le mot de passe est haché avec `scrypt` (module `node:crypto`), la session est un JWT
signé stocké dans un cookie `httpOnly`. Aucune dépendance supplémentaire n'a été
ajoutée pour ces deux besoins.

---

## 2. Installation

### Prérequis

- Node.js 22 ou supérieur
- PostgreSQL 16 ou supérieur

### Étapes

```bash
# 1. Dépendances
npm install

# 2. Bases de données
createdb oceamic_dev
createdb oceamic_test

# 3. Configuration
cp server/.env.example server/.env
#    puis adapter DATABASE_URL, TEST_DATABASE_URL et JWT_SECRET

# 4. Schéma et données de démonstration
npm run db:migrate
npm run db:seed

# 5. Démarrage (API sur 3000, interface sur 5173)
npm run dev
```

L'interface est disponible sur <http://localhost:5173>. Le serveur de développement
Vite relaie `/api` vers l'API.

### Scripts

| Commande | Effet |
|---|---|
| `npm run dev` | Démarre l'API et l'interface |
| `npm run build` | Compile l'API et l'interface |
| `npm run typecheck` | Vérifie les types des deux paquets |
| `npm test` | Exécute les tests automatisés |
| `npm run db:migrate` | Applique les migrations non appliquées |
| `npm run db:seed` | Insère les données de démonstration |
| `npm run db:reset --workspace server` | Recrée le schéma (interdit en production) |

---

## 3. Base de données et migrations

Les migrations sont des fichiers SQL numérotés dans `server/src/db/migrations/`.
Chaque fichier est appliqué **une seule fois**, dans une transaction, et enregistré
dans la table `schema_migrations`.

| Fichier | Contenu |
|---|---|
| `001_foundation.sql` | Compteurs de codes, rôles, utilisateurs, données de référence |
| `002_stock.sql` | Lots MP, réceptions, registre des mouvements de stock |
| `003_subcontracting_quality_audit.sql` | Sous-traitance, qualité, blocages, audit |
| `004_stock_views.sql` | Vues de calcul du stock et du bilan matière |
| `005_production.sql` | Produits, lignes, étapes, motifs, Runs, consommations, sorties |
| `006_production_views.sql` | Vues de bilan matière, de rendement et d'usage des lots |

Pour ajouter une évolution du schéma : créer un nouveau fichier `005_....sql`.
Ne jamais modifier une migration déjà appliquée en production.

Le détail table par table est documenté dans [`docs/modele-de-donnees.md`](docs/modele-de-donnees.md).

---

## 4. Données de démonstration

`npm run db:seed` crée des données **de développement uniquement**, reconnaissables à
la mention « démo ». Le script ne fait rien si la base contient déjà des rôles.

Il crée :

- les espèces SARDINE, MAQUEREAU, THON ;
- les emplacements OCEAMIC 2, OCEAMIC 1 (internes), COFRIGOP, COFRIGOB (entrepôts
  externes), DAMSA, SARMA, FOURSEASEN, ATLANTIC, WILL FISHING, KJ FISH
  (sous-traitants externes) ;
- trois lots de démonstration permettant de vérifier le stock interne, le stock
  externe, un transfert, un lot bloqué et une sous-traitance en cours ;
- les références de production : produits (SPSA-HO, SPSA-HOEV-BIO, FMHT,
  FMHOEV-BIO), lignes L1 à L8, étapes (traitement, grattage, remplissage) et motifs
  de perte ;
- un ordre de production de démonstration avec consommation, sortie vers
  remplissage, sous-produit et perte réelle.

> La répartition entrepôt / sous-traitant des partenaires externes est une hypothèse
> de démonstration. Elle est portée par la configuration des emplacements et doit être
> revue avec OCEAMIC : aucun comportement métier n'est déduit du nom d'un site.

### Comptes de démonstration

| Identifiant | Mot de passe | Rôle |
|---|---|---|
| `admin` | `admin123` | Administrateur |
| `qualite` | `qualite123` | Qualité |
| `stock` | `stock123` | Stock |
| `production` | `production123` | Production |
| `lecture` | `lecture123` | Lecture seule |

Ces comptes sont réservés au développement.

---

## 5. Rôles et permissions

Les permissions sont déclarées dans `server/src/domain/permissions.ts` et vérifiées
côté serveur à chaque appel. L'interface se contente de masquer ce qui n'est pas
autorisé.

| Rôle | Droits |
|---|---|
| **ADMIN** | Toutes les permissions, dont l'ajustement de stock et l'annulation de mouvement |
| **QUALITE** | Contrôles, décisions qualité, blocage et **libération** des lots, consultation |
| **STOCK** | Réceptions, transferts, pertes, logistique de sous-traitance, consultation |
| **PRODUCTION** | Ordres de production, consommation, sorties, pertes, corrections de production, consultation |
| **LECTURE** | Consultation |

Le rôle STOCK ne peut **jamais** libérer un blocage qualité, ni ajuster le stock, ni
saisir des enregistrements de production. L'ajustement de stock et l'annulation d'un
mouvement sont réservés à l'administrateur, exigent un motif et sont audités.

La correction d'une consommation de production reste ouverte au rôle PRODUCTION :
c'est une annulation traçable suivie d'un remplacement, entièrement auditée, et une
équipe de quart ne peut pas attendre un administrateur pour corriger une pesée.

---

## 6. Tests

```bash
npm test
```

Les tests s'exécutent sur une vraie base PostgreSQL (`TEST_DATABASE_URL`), qui est
migrée puis vidée au début de chaque fichier de test. Les fichiers sont exécutés en
série car ils partagent cette base.

| Fichier | Couverture |
|---|---|
| `tests/inventory.test.ts` | Réception, transfert, stock négatif, quantités invalides, interne/externe, concurrence |
| `tests/subcontracting.test.ts` | Modes STOCK_EXISTANT et FOURNISSEUR, résultats multiples, bilan matière |
| `tests/quality.test.ts` | Blocage, opérations interdites, libération, historique, droits |
| `tests/transactions.test.ts` | Absence d'enregistrement partiel après échec, audit |
| `tests/acceptance.test.ts` | Les sept scénarios d'acceptation de la Phase 1, via l'API HTTP |
| `tests/production.test.ts` | Runs, consommation multi-lots, lot multi-Runs, lot bloqué, stock insuffisant, concurrence, bilan matière, rendement, clôture, corrections, annulation |
| `tests/productionAcceptance.test.ts` | Les huit scénarios d'acceptation de la Phase 2, via l'API HTTP |

---

## 7. Règles métier essentielles

Le détail est documenté dans [`docs/regles-metier.md`](docs/regles-metier.md). En résumé :

1. **Un lot est une identité, une réception est un événement, un mouvement est un
   changement de quantité ou d'emplacement.** Ces concepts ne sont jamais fusionnés.
2. **Le stock n'est jamais stocké.** Il est calculé à partir du registre
   `stock_movements` : entrées moins sorties, par LOT + EMPLACEMENT. Aucun écran ne
   permet de modifier un « stock actuel ».
3. **Interne ou externe est une propriété de l'emplacement**, jamais une saisie de
   l'opérateur. Un seul moteur d'inventaire couvre les deux.
4. **Aucun stock négatif.** Toute sortie est vérifiée dans la transaction, après prise
   d'un verrou sur le couple lot + emplacement, ce qui protège des opérations
   concurrentes.
5. **Une mesure n'est pas une décision.** Les contrôles qualité enregistrent des
   observations ; les décisions qualité sont des enregistrements distincts et
   historisés.
6. **Un lot bloqué reste physiquement en stock** mais devient indisponible : la
   consommation et la sous-traitance sont refusées.
7. **Rien n'est supprimé.** Un mouvement validé est corrigé par un mouvement
   d'annulation qui le référence ; les données de référence sont désactivées.
8. **Tout est transactionnel.** Réception, sous-traitance, consommation de production
   et libération de lot écrivent plusieurs tables dans une seule transaction, ou rien
   du tout.
9. **Un Run est un contexte de transformation.** Il ne porte ni quantité ni identité
   de lot : l'entrée matière est la somme des consommations validées, jamais une
   saisie. La relation Run ↔ lot est de plusieurs à plusieurs.
10. **La production consomme le stock de la Phase 1.** Une consommation crée un
    mouvement `CONSOMMATION` du registre existant : il n'y a pas de second moteur
    d'inventaire, et les règles de blocage qualité s'appliquent telles quelles.
11. **Le bilan matière et le rendement sont calculés.** Entrée − (sortie utile +
    sous-produits + rework + reclassement + pertes réelles) = écart matière. L'écart
    inexpliqué n'est jamais enregistré comme une perte déclarée.

---

## 8. API

Toutes les routes sont préfixées par `/api` et exigent une session, sauf
`POST /api/auth/login` et `GET /api/health`.

| Méthode | Route | Permission |
|---|---|---|
| `POST` | `/api/auth/login`, `/api/auth/logout` | — |
| `GET` | `/api/auth/me` | session |
| `GET` | `/api/home/summary` | `stock:read` |
| `GET` | `/api/species`, `/api/suppliers`, `/api/vessels`, `/api/locations`, `/api/subcontractors` | `masterdata:read` |
| `POST` | mêmes ressources | `masterdata:write` |
| `GET` | `/api/receptions` | `stock:read` |
| `POST` | `/api/receptions` | `reception:create` |
| `GET` | `/api/stock/situation`, `/api/stock/summary`, `/api/stock/movements` | `stock:read` |
| `POST` | `/api/stock/transfers` | `stock:transfer` |
| `POST` | `/api/stock/losses` | `stock:loss` |
| `POST` | `/api/stock/adjustments` | `stock:adjust` |
| `POST` | `/api/stock/movements/:id/reversal` | `stock:reverse` |
| `GET` | `/api/lots` | `stock:read` |
| `POST` | `/api/lots/:id/fractionnement` | `stock:transfer` |
| `GET` | `/api/lots/:id/situation` | `traceability:read` |
| `GET` | `/api/products`, `/api/production-lines`, `/api/production-stages`, `/api/production-loss-reasons` | `masterdata:read` |
| `GET` | `/api/production/runs`, `/api/production/runs/:id`, `/api/production/runs/:id/bilan` | `production:read` |
| `POST` | `/api/production/runs` | `production:run` |
| `POST` | `/api/production/runs/:id/demarrage`, `/cloture`, `/annulation`, `/justification-ecart` | `production:run` |
| `POST` | `/api/production/runs/:id/consommations` | `production:material` |
| `POST` | `/api/production/runs/:id/sorties` | `production:output` |
| `POST` | `/api/production/consommations/:id/correction`, `/api/production/sorties/:id/annulation` | `production:correct` |
| `GET` | `/api/subcontracting`, `/api/subcontracting/:id` | `subcontracting:read` |
| `POST` | `/api/subcontracting` | `subcontracting:create` |
| `POST` | `/api/subcontracting/:id/results`, `/api/subcontracting/:id/cloture` | `subcontracting:result` |
| `GET` | `/api/quality/inspections`, `/api/quality/blocked-lots` | `quality:read` |
| `POST` | `/api/quality/inspections` | `quality:inspect` |
| `POST` | `/api/quality/decisions` | `quality:decide` (`quality:release` pour `LIBERE`) |
| `GET` | `/api/search` | `traceability:read` |
| `GET` | `/api/audit` | `audit:read` |

Les erreurs renvoient `{ "code": "...", "message": "..." }`, le message étant
directement affichable à l'opérateur.

---

## 9. Écrans

| Écran | Rôle |
|---|---|
| Accueil | Cinq indicateurs opérationnels et stock par emplacement |
| Réceptions | Liste et **écran unique** de nouvelle réception (lot + réception + mouvement + contrôle rapide) |
| Situation du stock | Stock physique, statut qualité et stock disponible, filtrable |
| Mouvements | Journal du registre, avec annulation contrôlée |
| Transfert | Déplacement entre emplacements à partir du stock réel |
| Lots MP | Liste des lots |
| Situation du lot | **Page unique de traçabilité** : identité, stock, réceptions, mouvements, contrôles, décisions, blocages, sous-traitance, **Runs consommateurs**, lots enfants |
| Runs de production | Liste des ordres de production : entrée MP, sortie utile, rendement, écart, statut |
| Nouveau Run | Contexte de production (date, produit, format, pièces/boîte, lignes actives, responsable) — sans sélection de matière première |
| Situation du Run | **Page unique de production**, en onglets : vue générale, lots consommés, lignes, sorties, pertes, bilan matière, traçabilité |
| Sous-traitance | Envois, résultats multiples et bilan matière |
| Qualité | Contrôles et lots bloqués |
| Traçabilité | Recherche globale menant à la situation du lot |
| Paramètres | Données de référence et utilisateurs |

---

## 10. Déploiement

```bash
npm run build                          # compile server/dist et web/dist
node server/dist/db/migrate.js         # applique les migrations sur la base cible
NODE_ENV=production node server/dist/index.js
```

`web/dist` contient des fichiers statiques à servir par le serveur web de votre choix,
en relayant `/api` vers l'API. En production, `NODE_ENV=production` active le cookie de
session `secure` et interdit `db:reset`.
