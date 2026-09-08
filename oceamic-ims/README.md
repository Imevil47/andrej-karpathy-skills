# OCEAMIC IMS — Phases 1, 2, 3 et 4

Système de gestion industrielle pour la conserverie de poisson OCEAMIC.

La **Phase 1** couvre le socle technique et les modules **matière première, stock
interne et externe, sous-traitance, qualité et traçabilité**.

La **Phase 2** ajoute la couche **flux matière de production** : ordres de production,
consommation de matière première, sorties, pertes, sous-produits, rework,
reclassement, bilan matière et rendement.

La **Phase 3** ajoute la **cadence de main-d'œuvre** : personnel affecté au Run,
tours de contrôle horaires, mesure de cadence individuelle et de ligne, performance par
rapport à un standard, et arrêts de production. Elle ne contient ni OEE complet, ni
paie, ni pointage RH, ni produits finis, palettes ou expédition, mais l'architecture est
conçue pour les accueillir sans refonte.

La **Phase 4** ajoute le **procédé aval** : remplissage et contrôle poids, sertissage et
ses contrôles, marquage, stérilisation (autoclaves, programmes, cycles), contrôles CCP,
déviations et actions correctives, et refroidissement. Chaque opération reste rattachée
à un Run de production existant ; rien n'est dupliqué depuis le Run ou le produit. Elle
ne contient ni stock de produits finis, ni palettisation, ni expédition, ni CAPA
complète, ni GMAO, mais l'architecture est conçue pour les accueillir sans refonte.

Les modules produits finis, palettes et expédition ne sont pas construits ici, mais
l'architecture est conçue pour les accueillir sans refonte (Phase 5).

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
| `007_workforce.sql` | Employées, affectations de personnel, tours de contrôle, contrôles de ligne, standards de cadence, contrôles de cadence, catégories et événements d'arrêt |
| `008_workforce_views.sql` | Vues de couverture, de cadence de ligne, de résumé de tour, d'arrêts et d'historique de cadence |
| `009_filling.sql` | Milieux de couverture, spécifications de remplissage, opérations de remplissage, contrôles poids, pesées individuelles |
| `010_seaming_marking.sql` | Équipements, opérations de sertissage, paramètres et spécifications de sertissage, contrôles et mesures de sertissage, marquage et sa vérification |
| `011_sterilization.sql` | Programmes et cycles de stérilisation, chargements de cycle, mesures de procédé, contrôles CCP, déviations, actions correctives, refroidissement, retenues de Run |
| `012_process_views.sql` | Vues de résumé de contrôle poids, de résultat de sertissage, de statut CCP et de cycle de stérilisation, et de retenues actives |

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
  remplissage, sous-produit et perte réelle ;
- six employées de démonstration (matricules 1001 à 1006), neuf catégories d'arrêt et
  un standard de cadence (SPSA-HO, grattage + remplissage, boîtes, 120 / h) ;
- sur le Run de démonstration : quatre employées affectées et présentes sur L1, un tour
  de contrôle clôturé avec trois contrôles de cadence individuels (couverture 3 / 4), et
  un arrêt PANNE_MACHINE de 27 minutes sur L2 ;
- deux autoclaves, deux sertisseuses, une remplisseuse, cinq milieux de couverture,
  quatre paramètres de sertissage, cinq points de vérification de marquage, une
  spécification de remplissage (SPSA-HO, 120 g / 130 g) et un programme de
  stérilisation (SPSA-HO) ;
- sur le même Run : une opération de remplissage avec un contrôle poids à 20 boîtes
  (2 sous-poids, 17 conformes, 1 surpoids), une opération de sertissage avec un contrôle
  non conforme (épaisseur hors spécification, mesure conservée), un marquage vérifié, un
  cycle de stérilisation complet (mesures, décision CCP libérée, clôturé TERMINE) suivi
  d'un refroidissement, et une déviation avec son action corrective.

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
| **QUALITE** | Contrôles, décisions qualité, blocage et **libération** des lots, contrôles poids, contrôles sertissage, vérification du marquage, **validation CCP**, gestion des déviations, consultation |
| **STOCK** | Réceptions, transferts, pertes, logistique de sous-traitance, consultation |
| **PRODUCTION** | Ordres de production, consommation, sorties, pertes, corrections de production, personnel du Run, tours de contrôle, cadence, arrêts, remplissage, sertissage, marquage, stérilisation, consultation |
| **LECTURE** | Consultation |

Le rôle STOCK ne peut **jamais** libérer un blocage qualité, ni ajuster le stock, ni
saisir des enregistrements de production. L'ajustement de stock et l'annulation d'un
mouvement sont réservés à l'administrateur, exigent un motif et sont audités.

La correction d'une consommation de production reste ouverte au rôle PRODUCTION :
c'est une annulation traçable suivie d'un remplacement, entièrement auditée, et une
équipe de quart ne peut pas attendre un administrateur pour corriger une pesée.

Employées, standards de cadence et catégories d'arrêt sont des données de référence :
leur création et leur (dés)activation restent réservées à l'ADMIN
(`masterdata:write`), au même titre que produits, lignes et motifs de perte. Le rôle
PRODUCTION gère l'affectation du personnel au Run, mène les tours de contrôle, saisit
la cadence et déclare les arrêts, mais ne crée pas ces données de référence.

De la même façon, équipements, milieux de couverture, spécifications de remplissage et
de sertissage, programmes de stérilisation et points de vérification de marquage sont
des données de référence réservées à l'ADMIN. PRODUCTION exécute les opérations de
remplissage, de sertissage et de stérilisation et y saisit les mesures de procédé ;
QUALITE contrôle ce qui en sort — poids, sertissage, marquage — et valide seule les
décisions CCP (`ccp:validate`) : un utilisateur PRODUCTION ne peut jamais, à lui seul,
libérer un cycle dont la donnée CCP est défavorable. La retenue d'un Run consécutive à
une décision CCP « retenu » se libère avec `quality:release`, la même permission que la
libération d'un lot en Phase 1.

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
| `tests/workforce.test.ts` | Affectation de personnel, activité toujours dérivée de la ligne du Run, déplacement de ligne avec préservation de l'historique, présence auditée |
| `tests/cadence.test.ts` | Formule de cadence individuelle, durées de mesure différentes, absence de standard, correspondance déterministe par spécificité, non-réécriture de l'historique lors d'un changement de standard, doublon même ligne rejeté, doublon ligne différente avec confirmation, couverture complète / incomplète / nulle (0/12 sans division par zéro), ligne inactive refusée, correction par annulation-remplacement, clôture d'un tour incomplet |
| `tests/downtime.test.ts` | Démarrage d'un arrêt, clôture avec durée calculée automatiquement (27 min = 1620 s), fin antérieure au début refusée, portée Run et portée ligne, historique conservé après clôture, double clôture refusée |
| `tests/cadenceAcceptance.test.ts` | Les dix scénarios d'acceptation de la Phase 3, via l'API HTTP |
| `tests/filling.test.ts` | Remplissage toujours rattaché à un Run, classification automatique des pesées (sous-poids / conforme / surpoids), contrôle à 20 échantillons, contrôle incomplet, non-réécriture de la spécification historique, doublon de boîte rejeté, correction par annulation-remplacement |
| `tests/seaming.test.ts` | Opération rattachée au Run, mesure comparée à la spécification correspondante, mesure hors spécification rendant le contrôle non conforme, historique de spécification préservé, correction par annulation-remplacement |
| `tests/sterilization.test.ts` | Cycle rattaché à un autoclave et à un Run via son chargement, programme obligatoire, base refusant qu'un cycle se termine avant son début, clôture refusée sans donnée CCP (`A_VERIFIER`), clôture normale avec CCP conforme (`TERMINE`), décision CCP retenue ouvrant une retenue de Run et clôturant le cycle `BLOQUE`, déviation visible avec ses actions correctives |
| `tests/processTraceability.test.ts` | Généalogie complète d'un Run (remplissage, contrôle poids, sertissage, marquage, stérilisation) retrouvée sans liaison manuelle, vue d'ensemble du process |
| `tests/phase4Acceptance.test.ts` | Les quatre scénarios d'acceptation de la Phase 4 (remplissage/poids, sertissage, stérilisation, traçabilité), via l'API HTTP |

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
12. **La cadence est toujours rattachée à un Run, une ligne, un tour de contrôle et une
    employée.** Aucune mesure de cadence n'existe hors de ce contexte.
13. **Cadence et performance sont calculées, jamais saisies.** L'opérateur ne saisit que
    la quantité et la durée réelle de mesure ; `cadence_per_hour` et
    `performance_percent` sont des colonnes générées par la base à partir de ces valeurs
    et du standard applicable au moment de la mesure.
14. **Le standard applicable est figé au moment de la mesure.** Un changement ultérieur
    d'un standard de cadence ne réécrit jamais une performance déjà enregistrée.
15. **Les arrêts sont séparés des contrôles de cadence.** Une interruption ne modifie
    jamais une quantité mesurée.
16. **Le statut d'une pesée est toujours calculé, jamais saisi.** Sous-poids, conforme ou
    surpoids découlent directement du poids mesuré et des limites en vigueur au moment
    du contrôle.
17. **Un contrôle poids sans standard configuré ne peut pas s'ouvrir.** Il n'existe
    aucune limite par défaut : sans spécification active pour le produit, il n'y a rien
    à comparer.
18. **Le résultat d'un contrôle sertissage n'est jamais stocké** : il est toujours lu en
    direct depuis ses mesures, exactement comme la couverture d'un contrôle de cadence
    en Phase 3.
19. **Une décision CCP est distincte d'une mesure de procédé.** Température, pression et
    F0 sont des faits mesurés ; la décision CCP (conforme, retenu, à vérifier) est un
    jugement de sécurité alimentaire, réservé à la Qualité.
20. **Un cycle de stérilisation ne se termine jamais silencieusement.** Sans donnée CCP,
    il passe « à vérifier » ; si la dernière décision CCP est « retenu », il se termine
    « bloqué » — le procédé peut être physiquement terminé sans que le matériel soit
    libéré.
21. **Statut du procédé et disposition qualité ne sont jamais confondus.** Un cycle
    « terminé » peut correspondre à un Run encore retenu par une décision CCP
    défavorable.
22. **Toute mesure de procédé Phase 4 (pesée, mesure de sertissage, mesure de
    stérilisation, décision CCP) suit la même politique de correction qu'en Phase 2 et
    3** : annulation puis remplacement, jamais une réécriture.

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
| `GET` | `/api/employees`, `/api/downtime-categories`, `/api/cadence-standards` | `masterdata:read` |
| `POST` | mêmes ressources | `masterdata:write` |
| `GET` | `/api/production/runs/:id/personnel` | `production:read` |
| `POST` | `/api/production/runs/:id/personnel`, `/api/production/personnel/:assignmentId/presence` | `workforce:manage` |
| `GET` | `/api/cadence/control-rounds`, `/api/cadence/control-rounds/:id`, `/api/cadence`, `/api/production/runs/:id/lignes/resume` | `production:read` |
| `POST` | `/api/production/runs/:id/tours-controle`, `/api/cadence/control-rounds/:id/cloture`, `/annulation`, `/lignes`, `/api/cadence/line-controls/:id/cloture`, `/employes`, `/api/cadence/controles/:id/correction` | `cadence:control` |
| `GET` | `/api/downtime` | `production:read` |
| `POST` | `/api/production/runs/:id/arrets`, `/api/downtime/:id/cloture` | `downtime:record` |
| `GET` | `/api/equipment`, `/api/filling-media`, `/api/filling-specs`, `/api/seaming-parameters`, `/api/seaming-specifications`, `/api/sterilization-programs`, `/api/marking-verification-items` | `masterdata:read` |
| `POST` | mêmes ressources | `masterdata:write` |
| `GET` | `/api/filling-operations`, `/api/filling-weight-controls`, `/api/filling-weight-controls/:id` | `production:read` |
| `POST` | `/api/production/runs/:id/remplissage`, `/api/filling-operations/:id/cloture`, `/annulation` | `filling:manage` |
| `POST` | `/api/filling-operations/:id/controles-poids`, `/api/filling-weight-controls/:id/echantillons`, `/api/filling-weight-samples/:id/correction` | `weight:control` |
| `GET` | `/api/seaming-operations`, `/api/seaming-controls`, `/api/seaming-controls/:id` | `production:read` |
| `POST` | `/api/production/runs/:id/sertissage`, `/api/seaming-operations/:id/cloture` | `seaming:operate` |
| `POST` | `/api/seaming-operations/:id/controles`, `/api/seaming-controls/:id/mesures`, `/api/seaming-measurements/:id/correction` | `seaming:control` |
| `GET` | `/api/marking-events` | `production:read` |
| `POST` | `/api/production/runs/:id/marquage` | `marking:record` |
| `POST` | `/api/marking-events/:id/verification` | `marking:verify` |
| `GET` | `/api/sterilization-cycles`, `/api/sterilization-cycles/:id` | `production:read` |
| `POST` | `/api/sterilization-cycles`, `/chargements`, `/demarrage`, `/mesures`, `/cloture`, `/annulation`, `/refroidissement`, `/api/sterilization-measurements/:id/correction`, `/api/cooling-events/:id/cloture`, `/mesures` | `sterilization:operate` |
| `POST` | `/api/sterilization-cycles/:id/ccp`, `/api/ccp-controls/:id/correction` | `ccp:validate` |
| `GET` | `/api/deviations`, `/api/deviations/:id` | `production:read` |
| `POST` | `/api/deviations`, `/api/deviations/:id/statut`, `/actions`, `/api/corrective-actions/:id/cloture` | `deviation:manage` |
| `GET` | `/api/production-run-holds` | `production:read` |
| `POST` | `/api/production-run-holds/:id/levee` | `quality:release` |
| `GET` | `/api/production/runs/:id/vue-process`, `/genealogie` | `production:read` |

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
| Situation du Run | **Page unique de production**, en onglets : vue générale (avec **vue du process**), lots consommés, lignes, sorties, pertes, bilan matière, traçabilité, contrôles horaires, cadence, arrêts, **remplissage, sertissage, stérilisation** ; personnel du Run affecté et présence directement sur l'onglet lignes |
| Contrôles horaires | Liste filtrable de tous les tours de contrôle |
| Tour de contrôle | **Écran de saisie terrain** : sélection de la ligne, puis uniquement matricule + quantité par employée — produit, espèce, activité, nom, standard et horodatage sont déjà connus ; le focus revient automatiquement sur la prochaine employée à contrôler |
| Cadence | Historique filtrable des mesures de cadence individuelles |
| Arrêts | Liste des interruptions de production, avec durée en direct pour un arrêt encore ouvert et action de clôture |
| Remplissage | Opérations de remplissage actives, avec accès direct à un **nouveau contrôle poids** |
| Contrôles poids | Historique filtrable des contrôles poids |
| Contrôle poids | **Écran de saisie rapide** (tablette) : une case par boîte, statut évalué automatiquement, focus déplacé sur la prochaine case vide après chaque saisie valide ; anomalies visibles, échantillons conformes discrets |
| Sertissage | Opérations de sertissage actives, avec accès direct à un nouveau contrôle |
| Contrôles sertissage | Historique filtrable des contrôles sertissage, avec saisie des mesures par paramètre configuré |
| Stérilisation | Cycles de stérilisation, cycles actifs repérables en un coup d'œil |
| Cycle de stérilisation | **Écran du cycle actif** : temps écoulé en direct (jamais persisté), mesures de procédé (saisie manuelle explicitement distinguée d'une donnée équipement), décisions CCP, refroidissement, déviations liées |
| CCP | Vue par cycle des dernières décisions CCP, pour repérer ce qui reste à vérifier |
| Déviations | Liste et création de déviations de procédé, avec leurs actions correctives |
| Sous-traitance | Envois, résultats multiples et bilan matière |
| Qualité | Contrôles et lots bloqués |
| Traçabilité | Recherche globale menant à la situation du lot |
| Paramètres | Données de référence — **employées, standards de cadence, catégories d'arrêt, équipements, milieux de couverture, spécifications de remplissage et de sertissage, programmes de stérilisation, points de vérification de marquage** — et utilisateurs |

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
