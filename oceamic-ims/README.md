# OCEAMIC IMS — Phases 1, 2, 3, 4, 5, 6 et 7

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

La **Phase 5** ajoute la **couche logistique aval** : emballage (lots d'emballage,
cartonisation agrégée), Lots PF, palettes et leur composition, stock PF (cartons et
unités, jamais de virgule flottante), mouvements de stock PF, statut qualité PF
(hérité de la retenue Production/CCP amont, jamais libéré automatiquement),
préparation et exécution d'expéditions (client, conteneur, réservation, chargement,
confirmation transactionnelle), et traçabilité avant/arrière complète du Lot MP
jusqu'au client et retour. Chaque Lot PF reste rattaché au(x) cycle(s) de
stérilisation et Run(s) qui l'ont produit ; rien n'est dupliqué depuis la Phase 4.
Elle ne contient ni gestion de rappel complète, ni CRM, ni facturation, ni
comptabilité, mais l'architecture est conçue pour les accueillir sans refonte.

La **Phase 6** ajoute la **couche qualité horizontale (QMS)**, transverse à toutes les
phases précédentes : non-conformités et leur investigation, analyse de cause racine,
CAPA (actions correctives et préventives) avec contrôle d'efficacité obligatoire,
réclamations client et incidents qualité fournisseur, audits internes/externes avec
grilles de contrôle et constats, documents qualité maîtrisés (révisions jamais
écrasées), et retraits/rappels/exercices de traçabilité dont l'impact est toujours
calculé depuis la traçabilité existante, jamais saisi à la main. Chaque événement
qualité reste rattaché à une entité opérationnelle réelle (lot, Run, contrôle,
expédition, audit...) ; il n'existe aucun enregistrement qualité isolé. Elle ne
contient ni comptabilité complète, ni ERP commercial, ni gestion complète des achats,
ni GMAO, ni portail fournisseur/client, ni prédiction assistée par IA, mais
l'architecture est conçue pour les accueillir sans refonte.

Une passe ultérieure a appliqué l'**identité visuelle officielle OCEAMIC Laayoune II**
(logo, palette de marque) et corrigé un ensemble de règles métier QMS identifiées lors
d'un audit ciblé de la Phase 6 (transitions de statut, cohérence gravité/priorité,
échéances CAPA, clarté du statut d'audit) — voir la [section 11](#11-identité-visuelle-et-corrections-qms-phase-6)
pour le détail.

La **Phase 7** ajoute la **couche maintenance (GMAO)**, native à OCEAMIC IMS plutôt
qu'une application séparée : registre d'équipements (identité, hiérarchie, criticité
et statut opérationnel - trois concepts distincts), déclaration de pannes avec arrêt de
production réel et unique (le même événement `downtime_events` de la Phase 3, jamais
dupliqué), ordres de travail (correctifs, préventifs, inspection, réglage,
amélioration, urgence) avec transitions contraintes et clôture gérée par un
formulaire dédié (remise en service = décision distincte de la fin de l'intervention),
interventions techniciens (diagnostic, action réalisée, pièces utilisées, durée
toujours calculée jamais saisie), maintenance préventive (plans, tâches, listes de
contrôle, retard toujours dérivé de la date d'échéance), pièces de rechange (inventaire
propre, séparé du moteur de stock matière première), historique équipement, MTTR et
analyse des pannes répétées. Un ordre de travail sur un équipement à criticité
haute/critique (ou de type urgence) ne peut être clôturé que par RESPONSABLE_MAINTENANCE
(section 52). Elle réutilise directement l'équipement, les lignes de production, les
Runs, l'arrêt de production, le journal d'audit et le RBAC des phases précédentes -
aucun de ces modules n'a été reconstruit. Elle ne contient ni achat de pièces, ni
comptabilité de maintenance, ni maintenance prédictive par IA, ni intégration capteurs/
automates, ni calibration/métrologie complète, ni OEE complet, mais prépare les
champs nécessaires à un futur sous-module de calibration.

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
| `013_packaging.sql` | Lots d'emballage, Lots PF, sources de Lot PF (cycle + Run), sorties d'emballage (cartonisation agrégée), contrôles d'étiquette |
| `014_pallets.sql` | Domaine de stock des emplacements (`stock_domain`), palettes, composition des palettes |
| `015_pf_stock_quality.sql` | Registre de mouvements de stock PF, décisions et blocages qualité PF (polymorphes : Lot PF ou palette) |
| `016_shipments.sql` | Clients, expéditions (avec identité conteneur), lignes d'expédition, réservations de stock |
| `017_pf_views.sql` | Vues de registre et de solde de stock PF, résumé de palette, résumé de stock par Lot PF, stock PF par emplacement |
| `018_qms_roles.sql` | Ajout des rôles RESPONSABLE_QUALITE et AUDITEUR |
| `019_nonconformities.sql` | Catégories de non-conformité, non-conformités, liens polymorphes, investigations, analyses de cause racine |
| `020_capa.sql` | CAPA, actions CAPA, contrôles d'efficacité |
| `021_complaints_supplier.sql` | Réclamations client, incidents qualité fournisseur |
| `022_audits.sql` | Grilles de contrôle d'audit et leurs questions, audits, réponses de grille, constats d'audit |
| `023_quality_documents.sql` | Documents qualité, révisions de document, acquittements de formation |
| `024_recall.sql` | Événements de retrait/rappel/exercice, entités affectées |
| `025_qms_views.sql` | Vues de progression CAPA (actions, efficacité, résumé avec éligibilité à la clôture) et de progression d'audit |
| `026_maintenance_roles_equipment.sql` | Ajout des rôles MAINTENANCE et RESPONSABLE_MAINTENANCE ; extension de `equipment` (fabricant, modèle, n° de série, ligne, parent, criticité, statut) et de son vocabulaire de types |
| `027_maintenance_failures.sql` | Modes et causes de panne, pannes (`failure_reports`) |
| `028_maintenance_work_orders.sql` | Ordres de travail, interventions (durée calculée) |
| `029_maintenance_preventive.sql` | Plans préventifs, listes de contrôle, tâches préventives, réponses de liste de contrôle |
| `030_maintenance_spare_parts.sql` | Pièces de rechange, mouvements de stock de pièces, usage de pièces en intervention |
| `031_maintenance_views.sql` | Vues de stock de pièces, de statut de tâche préventive (retard calculé), de panne active par équipement et de MTTR |

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
  d'un refroidissement, et une déviation avec son action corrective ;
- un emplacement Stock PF A (`stock_domain = 'PF'`) et un client de démonstration
  (CLIENT-X) ;
- sur le même Run et cycle de stérilisation : un lot d'emballage et un Lot PF
  (12 000 boîtes / 1 000 cartons / 12 boîtes par carton, conforme aux chiffres du
  scénario d'acceptation), deux palettes de 60 cartons chacune reçues directement en
  Stock PF A, la libération qualité du Lot PF et des deux palettes, une expédition vers
  CLIENT-X sur le conteneur CONT-001 chargeant les deux palettes et confirmée
  jusqu'à `EXPEDIEE` — la chaîne de traçabilité complète, du Lot MP jusqu'au client,
  est donc réelle et interrogeable dès l'initialisation ;
- quinze catégories de non-conformité et une grille de contrôle d'audit hygiène
  (`CHK-HYG-001`, trois questions) ;
- une non-conformité issue d'un contrôle poids réel, avec son CAPA (trois actions —
  réglage machine, formation opérateur, vérification des trois productions suivantes
  — et un contrôle d'efficacité positif, clôturé) ; une non-conformité issue d'un
  constat d'audit majeur ; une non-conformité issue d'une réclamation client ;
- un audit interne hygiène clôturé avec un constat majeur et deux observations, le
  constat majeur étant lié à sa non-conformité ;
- une réclamation client sur le Lot PF de démonstration, avec sa traçabilité complète
  (palette, Lot PF, cycle de stérilisation, Run, Lot MP, fournisseur) recalculée
  depuis l'expédition, jamais ressaisie ;
- le document `PR-QA-004` (Maîtrise des non-conformités) avec quatre révisions : les
  trois premières historiques (`OBSOLETE`), la quatrième `EN_VIGUEUR` — jamais
  écrasées ;
- un exercice de traçabilité (« EXERCICE DE TRACABILITE ») depuis le Lot MP de
  démonstration, retrouvant automatiquement le Run, le cycle de stérilisation, le
  Lot PF, les deux palettes, l'expédition et le client affectés, clôturé avec sa
  durée d'exécution enregistrée ;
- sept équipements enrichis (criticité, ligne, hiérarchie) dont une sonde composant
  d'Autoclave 1, huit modes/causes de panne et deux pièces de rechange
  (BRG-002 en stock suffisant, JNT-014 volontairement sous son minimum — une vraie
  alerte « Stock de sécurité atteint », pas un indicateur fabriqué) ;
- le scénario complet de panne Sertisseuse 2 (bourrage réel sur la ligne 2 du Run de
  démonstration, arrêt de production ouvert et refermé, ordre de travail correctif,
  intervention avec diagnostic/action/pièce consommée, clôture par
  RESPONSABLE_MAINTENANCE avec vérification conforme — équipement à criticité HAUTE) ;
- une non-conformité de sertissage liée à cette panne et à son ordre de travail
  (`FAILURE_REPORT` / `MAINTENANCE_WORK_ORDER`), démontrant le lien qualité ↔
  maintenance sans duplication d'enregistrement ;
- un plan préventif mensuel Autoclave 1 dont la première échéance est complétée
  (générant automatiquement la suivante) et un plan trimestriel Autoclave 2
  volontairement laissé en retard — une alerte « Préventifs en retard » réelle ;
- quatre pannes similaires sur Remplisseuse 1 en 30 jours (même mode/cause), pour
  vérifier l'analyse de panne répétée sans aucune IA.

> La répartition entrepôt / sous-traitant des partenaires externes est une hypothèse
> de démonstration. Elle est portée par la configuration des emplacements et doit être
> revue avec OCEAMIC : aucun comportement métier n'est déduit du nom d'un site.

### Comptes de démonstration

| Identifiant | Mot de passe | Rôle |
|---|---|---|
| `admin` | `admin123` | Administrateur |
| `qualite` | `qualite123` | Qualité |
| `rq` | `rq123456` | Responsable Qualité |
| `auditeur` | `auditeur123` | Auditeur |
| `rm` | `rm123456` | Responsable Maintenance |
| `maintenance` | `maintenance123` | Technicien Maintenance |
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
| **QUALITE** | Contrôles, décisions qualité, blocage et **libération** des lots, contrôles poids, contrôles sertissage, vérification du marquage, **validation CCP**, gestion des déviations, **décisions qualité PF (blocage/libération de Lot PF ou palette)**, **crée et gère non-conformités/CAPA/réclamations/incidents fournisseur, planifie et conduit les audits, rédige les documents qualité, mène les exercices de traçabilité** — mais n'approuve ni cause racine, ni clôture CAPA, ni document, et n'initie pas un vrai retrait/rappel, consultation |
| **RESPONSABLE_QUALITE** | Tout ce que QUALITE détient, **plus** les autorisations d'approbation : valider une cause racine, clôturer un CAPA, approuver et mettre en vigueur une révision de document, initier un retrait/rappel réel |
| **AUDITEUR** | **Conduit uniquement les audits qui lui sont assignés** (réponses de grille, constats) — ne planifie jamais d'audit, ne décide jamais d'une non-conformité ou d'un blocage de sa propre initiative, consultation |
| **STOCK** | Réceptions, transferts, pertes, logistique de sous-traitance, **stock PF, transferts/ajustements de palette, préparation et confirmation d'expédition**, **peut compléter une action CAPA ou de constat d'audit qui lui est assignée, mais ne clôture jamais une non-conformité/CAPA/audit/document**, consultation |
| **PRODUCTION** | Ordres de production, consommation, sorties, pertes, corrections de production, personnel du Run, tours de contrôle, cadence, arrêts, remplissage, sertissage, marquage, stérilisation, **emballage (lots d'emballage, Lots PF, palettes)**, **peut compléter une action CAPA ou de constat d'audit qui lui est assignée, mais ne clôture jamais une non-conformité/CAPA/audit/document**, **déclare une panne équipement (`failure:report`) et consulte le statut de maintenance, mais ne modifie jamais un ordre de travail ou une intervention**, consultation |
| **MAINTENANCE** *(Phase 7)* | Déclare et gère les pannes, crée et travaille les ordres de travail, mène les interventions (diagnostic, action, pièces utilisées), complète les tâches préventives, consomme des pièces de rechange — **mais ne clôture jamais un ordre de travail « important » (équipement HAUTE/CRITIQUE ou OT urgent), ne configure pas les plans préventifs, ne gère pas les données de référence équipement, n'autorise pas d'ajustement de stock de pièces**, consultation |
| **RESPONSABLE_MAINTENANCE** *(Phase 7)* | Tout ce que MAINTENANCE détient, **plus** : clôture les ordres de travail importants, configure les plans préventifs, gère les données de référence équipement (`equipment:manage`), autorise les ajustements de stock de pièces (`sparepart:adjust`) |
| **LECTURE** | Consultation |

Le rôle STOCK ne peut **jamais** libérer un blocage qualité, ni ajuster le stock, ni
saisir des enregistrements de production. L'ajustement de stock et l'annulation d'un
mouvement sont réservés à l'administrateur, exigent un motif et sont audités.

**Séparation stricte des autorisations qualité (Phase 6)** : le même rôle qui déclare
une non-conformité critique, rédige un CAPA, un document ou lance un exercice de
traçabilité n'est jamais celui qui, seul, en approuve la clôture — `ncr:manage` /
`ncr:approve`, `capa:manage` / `capa:approve`, `document:manage` / `document:approve`,
`recall:exercise` / `recall:manage` sont des permissions volontairement distinctes,
réservées respectivement à QUALITE et RESPONSABLE_QUALITE.

**Séparation stricte des autorisations maintenance (Phase 7)** : `workorder:manage`
(MAINTENANCE) couvre la création et le travail courant d'un ordre de travail ;
`workorder:approve` (RESPONSABLE_MAINTENANCE) est requis en plus pour clôturer un
ordre de travail « important » — équipement à criticité HAUTE/CRITIQUE, ou type
URGENCE (`workOrderClosureRequiresApproval`, `server/src/domain/types.ts`). La
condition dépend de faits lus en base (la criticité de l'équipement) : la route
`POST /api/work-orders/:id/cloture` lit d'abord ce contexte
(`getWorkOrderClosureContext`) puis exige la permission adéquate, avant même
d'invoquer le service de clôture. `equipment:manage` (données de référence
équipement) et `sparepart:adjust` (ajustement de stock de pièces) suivent le même
principe que `masterdata:write` mais restent des permissions dédiées, pour que
RESPONSABLE_MAINTENANCE ne reçoive jamais les droits génériques des Phases 1-6.

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

La logistique aval de la Phase 5 suit la même séparation : bloquer ou libérer un Lot PF
ou une palette (`fgquality:decide`) reste réservé à QUALITE/ADMIN, exactement comme un
lot matière première. Le stock PF, les transferts de palette et les expéditions
(`fgstock:manage`, `shipment:manage`) restent du ressort de STOCK, jamais de PRODUCTION
ni de QUALITE. Créer un lot d'emballage, un Lot PF ou une palette (`packaging:manage`)
reste une activité de production, au même titre que le remplissage ou le sertissage.

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
| `tests/phase5.test.ts` | Héritage du blocage Run/CCP sur un Lot PF nouvellement créé, unicité d'un Lot PF sur une palette, double affectation d'une palette à une expédition refusée (message exact), blocage qualité empêchant la confirmation d'expédition sans aucun mouvement de stock, transaction complète de confirmation d'expédition (mouvements, palettes, réservations cohérents), et le scénario complet d'acceptation (sections 54-59) : Lot PF → palettes → stock PF → expédition → traçabilité avant/arrière |
| `tests/phase6.test.ts` | Création d'une non-conformité avec ses liens vers l'entité source (jamais isolée), droits (AUDITEUR ne peut pas créer de non-conformité), blocage qualité déclenché depuis une non-conformité en réutilisant `lot_blocks` (sans nouveau système de blocage), clôture d'une non-conformité bloquée tant qu'un CAPA lié reste ouvert (PRODUCTION ne peut jamais clôturer), CAPA restant ouvert tant que le contrôle d'efficacité requis n'a pas conclu positivement (message exact « Clôture impossible. Des actions obligatoires restent ouvertes. », QUALITE ne peut jamais approuver sa propre clôture), non-écrasement d'une révision de document (révision 01 en vigueur jusqu'à la mise en vigueur de la 02, approbation réservée à RESPONSABLE_QUALITE), traçabilité d'une réclamation client recalculée depuis l'expédition sans ressaisie manuelle, exercice de traçabilité depuis un Lot MP retrouvant Run/cycle/Lot PF/palettes/expédition/client affectés (STOCK ne peut pas lancer l'exercice), audit interne avec réponses de grille et constats menés par l'auditeur assigné, constat majeur générant une non-conformité |
| `tests/phase7.test.ts` | Panne qui arrête la production ouvrant un vrai arrêt lié à l'équipement/la ligne/le Run (jamais dupliqué, visible identiquement depuis `/api/downtime`), panne sans arrêt de production, transition de statut d'ordre de travail invalide refusée, création d'un ordre de travail depuis une panne la faisant passer `PRISE_EN_CHARGE`, clôture refusée sans intervention à action réalisée documentée, clôture d'un ordre de travail sur équipement HAUTE exigeant `workorder:approve` (403 pour MAINTENANCE seul, 400 sans résultat de vérification, puis clôture réussie remettant l'équipement `EN_SERVICE` et la panne `RESOLUE`), durée d'intervention calculée (10:00→10:45 = 45 min), fin antérieure au début refusée, intervention sans action réalisée ne pouvant se terminer, consommation de pièce réduisant le stock exactement une fois (10 → 8, une seule ligne `SORTIE_INTERVENTION`), ajustement de stock réservé à RESPONSABLE_MAINTENANCE, plan préventif en retard détecté automatiquement puis complété générant sa prochaine occurrence, quatre pannes similaires en 30 jours regroupées par mode/cause sans IA, non-conformité liée à une panne et à un ordre de travail avec libellés résolus |

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
23. **Lot d'emballage, Lot PF, palette, mouvement de stock PF, réservation, expédition
    et conteneur ne sont jamais fusionnés** (section 62) : un lot d'emballage est
    l'événement de production, un Lot PF est l'identité de traçabilité du produit fini,
    une palette est l'unité de manutention logistique, un mouvement de stock PF est un
    événement d'inventaire, une réservation est une allocation future de stock
    disponible, une expédition est un événement logistique client.
24. **Le stock PF n'est jamais stocké**, comme en Phase 1. Il est calculé à partir du
    registre `finished_goods_stock_movements`, à la seule granularité de la palette :
    un Lot PF n'a pas de position de stock propre, elle est toujours dérivée en
    agrégeant les palettes qui le contiennent (`pallet_contents`).
25. **Une palette n'est jamais scindée entre deux emplacements.** Chaque mouvement de
    stock PF déplace toujours la totalité de la palette ; sa composition est fixée à la
    création et jamais modifiée ensuite (correction par annulation de la palette et
    création d'une nouvelle).
26. **Le statut qualité PF n'est jamais automatiquement `LIBERE`** parce que
    l'emballage ou la palettisation s'est terminée. Un Lot PF hérite immédiatement du
    statut `BLOQUE` si le(s) Run(s)/cycle(s) source portent une retenue Production/CCP
    active non levée ; sinon il démarre `A_VERIFIER`.
27. **Stock disponible = Stock physique − Stock bloqué − Stock réservé.** Une
    réservation n'est jamais traitée comme déjà expédiée : elle diminue le disponible
    sans toucher au stock physique tant que l'expédition n'est pas confirmée.
28. **Une palette ne peut jamais porter deux réservations actives simultanées**, que ce
    soit pour la même expédition ou une autre : un index unique partiel l'empêche au
    niveau de la base, ce qui rend le double chargement structurellement impossible.
29. **La confirmation d'une expédition est une seule transaction** : validation du
    stock, de la libération qualité et des réservations, clôture des réservations,
    création des mouvements de sortie, marquage des palettes expédiées et
    horodatage — ou annulation complète en cas d'échec, sans aucun effet partiel.
30. **La traçabilité avant et arrière ne s'arrête jamais à la Phase 4.** Depuis un Lot
    MP, la chaîne avant remonte jusqu'au(x) client(s) ayant reçu le produit ; depuis une
    expédition ou un conteneur, la chaîne arrière redescend jusqu'au(x) Lot(s) MP et
    fournisseur(s)/navire(s) d'origine.
31. **Une non-conformité n'est jamais un enregistrement isolé.** Elle porte une source
    (`source_type`/`source_id`) et peut porter d'autres liens (`nonconformity_links`)
    vers n'importe quelle entité opérationnelle existante ; elle n'invente jamais un
    doublon de cette entité.
32. **Non-conformité, investigation, cause racine, correction, CAPA, contrôle
    d'efficacité, réclamation, audit, constat d'audit, document, révision de document
    et retrait/rappel sont onze concepts distincts**, jamais fusionnés dans une table
    « problème qualité » générique.
33. **Une correction n'est pas une action corrective.** La correction immédiate est
    capturée sur l'investigation de la non-conformité ; l'action corrective qui traite
    la cause racine est une action CAPA distincte, avec son propre responsable et sa
    propre échéance.
34. **Un CAPA ne se clôture jamais tant qu'une action obligatoire reste ouverte, ni tant
    que le contrôle d'efficacité requis n'a pas conclu positivement.** L'éligibilité à
    la clôture (`capa_summary.can_close`) est une vue calculée, jamais une case cochée
    à la main ; c'est la même vue qui alimente le refus strict à la clôture et
    l'explication affichée à l'écran.
35. **Une action préventive peut exister sans non-conformité source.** Elle peut
    provenir d'une observation d'audit, d'un risque identifié ou d'une décision de
    management ; `capa_records.source_nonconformity_id` est nullable.
36. **Une révision de document n'est jamais écrasée.** Chaque révision est un
    enregistrement historique permanent, numéroté séquentiellement ; seule sa mise en
    vigueur change quelle révision est « courante » (`current_revision_id`). Une
    révision obsolète n'est jamais exposée comme la version en vigueur.
37. **L'approbation d'une révision n'est pas ouverte à tout utilisateur.** Créer et
    soumettre une révision reste une activité QUALITE ; l'approuver et la mettre en
    vigueur exige `document:approve`, réservé à RESPONSABLE_QUALITE.
38. **Un retrait/rappel/exercice de traçabilité calcule toujours son impact depuis la
    traçabilité relationnelle existante**, jamais depuis une liste saisie à la main :
    Runs, cycles, Lots PF, palettes, expéditions et clients affectés proviennent de
    `forwardTraceabilityFromRawMaterialLot`/`traceabilityFromFinishedGoodLot`,
    dédupliqués et enregistrés une seule fois (`recall_affected_entities`).
39. **Le bilan matière d'un retrait ne prétend jamais à une réconciliation parfaite.**
    Produit / en stock / bloqué / expédié / ajusté sont calculés séparément ; l'écart
    résiduel est rapporté comme « inexpliqué », jamais forcé à zéro.
40. **Une non-conformité critique n'est jamais créée, approuvée et close par le même
    rôle.** QUALITE crée, gère et bloque ; seul RESPONSABLE_QUALITE valide une cause
    racine, clôture un CAPA, approuve un document ou initie un vrai retrait/rappel — la
    même discipline de séparation des pouvoirs qu'ailleurs dans OCEAMIC IMS,
    explicitement appliquée à la qualité elle-même.
41. **Chaque opération qualité sensible reste auditée** (`audit_log`), au même titre que
    toute opération sensible des phases précédentes : création, changement de statut,
    validation, approbation, clôture.

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
| `GET` | `/api/equipment`, `/api/equipment/:id`, `/api/filling-media`, `/api/filling-specs`, `/api/seaming-parameters`, `/api/seaming-specifications`, `/api/sterilization-programs`, `/api/marking-verification-items` | `masterdata:read` |
| `POST`/`PATCH` | `/api/equipment`, `/api/equipment/:id` | `equipment:manage` *(Phase 7 : dédiée, jamais `masterdata:write`)* |
| `POST` | autres ressources ci-dessus | `masterdata:write` |
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
| `GET` | `/api/packaging-batches`, `/api/packaging-batches/:id`, `/api/finished-good-lots`, `/api/finished-good-lots/:id/situation` | `production:read` |
| `POST` | `/api/packaging-batches`, `/cloture`, `/annulation`, `/lots-pf`, `/sorties`, `/controles-etiquette` | `packaging:manage` |
| `GET` | `/api/pallets`, `/api/pallets/:id/situation`, `/api/fg-stock/summary`, `/api/fg-stock/by-location` | `stock:read` |
| `POST` | `/api/pallets`, `/api/pallets/:id/annulation` | `packaging:manage` |
| `POST` | `/api/pallets/:id/transfert`, `/ajustement`, `/blocage-logistique`, `/retour` | `fgstock:manage` |
| `POST` | `/api/fg-quality/decisions` | `fgquality:decide` |
| `GET` | `/api/customers` | `masterdata:read` |
| `POST` | `/api/customers` | `masterdata:write` |
| `GET` | `/api/shipments`, `/api/shipments/:id` | `stock:read` |
| `POST` | `/api/shipments`, `/conteneur`, `/palettes`, `/confirmation`, `/annulation` ; `DELETE` `/api/shipments/:id/palettes/:palletId` | `shipment:manage` |
| `GET` | `/api/lots/:id/traceability-avant`, `/api/shipments/:id/traceability-arriere`, `/api/conteneurs/:numero/traceability-arriere` | `traceability:read` |
| `GET` | `/api/nonconformity-categories`, `/api/audit-checklists`, `/api/audit-checklists/:id/items` | `masterdata:read` |
| `POST` | mêmes ressources | `masterdata:write` |
| `GET` | `/api/qms/home-summary`, `/api/qms/metrics`, `/api/qms/users` | `qms:read` |
| `GET` | `/api/nonconformities`, `/api/nonconformities/:id`, `/api/nonconformities/repetitions` | `qms:read` |
| `POST` | `/api/nonconformities`, `/liens`, `/gravite`, `/responsable`, `/statut`, `/investigation`, `/cause-racine`, `/blocage` | `ncr:manage` |
| `POST` | `/api/root-cause-analyses/:id/validation` | `ncr:approve` |
| `GET` | `/api/capa`, `/api/capa/:id` | `qms:read` |
| `POST` | `/api/capa`, `/actions`, `/efficacite`, `/annulation` ; `/api/capa-actions/:id/annulation` | `capa:manage` |
| `POST` | `/api/capa-actions/:id/completion` | `action:complete` |
| `POST` | `/api/capa/:id/cloture` | `capa:approve` |
| `GET` | `/api/complaints`, `/api/complaints/:id`, `/api/supplier-incidents`, `/api/suppliers/performance` | `qms:read` |
| `POST` | `/api/complaints`, `/statut`, `/non-conformite`, `/capa` | `complaint:manage` |
| `POST` | `/api/supplier-incidents`, `/statut` | `supplierincident:manage` |
| `GET` | `/api/audits`, `/api/audits/:id` | `qms:read` |
| `POST` | `/api/audits`, `/annulation` | `audit:plan` |
| `POST` | `/api/audits/:id/demarrage`, `/cloture`, `/reponses`, `/constats`, `/api/audit-findings/:id/statut`, `/non-conformite` | `audit:conduct` |
| `GET` | `/api/quality-documents`, `/api/quality-documents/:id`, `/api/document-revisions/:id/acquittements` | `qms:read` |
| `POST` | `/api/quality-documents`, `/revisions`, `/api/document-revisions/:id/soumission`, `/annulation`, `/acquittements` | `document:manage` |
| `POST` | `/api/document-revisions/:id/approbation`, `/mise-en-vigueur` | `document:approve` |
| `POST` | `/api/acknowledgments/:id/confirmation` | `qms:read` (l'utilisateur assigné uniquement) |
| `GET` | `/api/recall-events`, `/api/recall-events/:id`, `/api/finished-good-lots/:id/bilan-matiere` | `qms:read` |
| `POST` | `/api/recall-events` (`eventType: EXERCICE_TRACABILITE`), `/actualisation`, `/statut`, `/cloture`, `/api/recall-affected-entities/:id/statut` | `recall:exercise` |
| `POST` | `/api/recall-events` (`eventType: RETRAIT` ou `RAPPEL`) | `recall:manage` |
| `GET` | `/api/failure-modes`, `/api/failure-causes`, `/api/failures`, `/api/failures/:id` | `maintenance:read` |
| `POST` | `/api/failure-modes`, `/api/failure-causes` | `equipment:manage` |
| `POST` | `/api/failures` | `failure:report` |
| `POST` | `/api/failures/:id/annulation` | `failure:manage` |
| `GET` | `/api/work-orders`, `/api/work-orders/:id`, `/api/work-orders/:id/interventions` | `maintenance:read` |
| `POST` | `/api/work-orders`, `/api/work-orders/:id/statut` | `workorder:manage` |
| `POST` | `/api/work-orders/:id/cloture` | `workorder:manage` **ou** `workorder:approve` *(selon la criticité de l'équipement — voir section 5)* |
| `POST` | `/api/work-orders/:id/interventions`, `/api/interventions/:id/cloture` | `intervention:manage` |
| `PATCH` | `/api/interventions/:id` | `intervention:manage` |
| `POST` | `/api/interventions/:id/pieces` | `sparepart:consume` |
| `GET` | `/api/maintenance-plans`, `/api/maintenance-plans/:id`, `/api/preventive-tasks`, `/api/preventive-tasks/:id/checklist` | `maintenance:read` |
| `POST` | `/api/maintenance-plans`, `/api/preventive-tasks/:id/annulation` | `preventive:manage` |
| `POST` | `/api/preventive-tasks/:id/completion` | `preventive:complete` |
| `GET` | `/api/spare-parts`, `/api/spare-parts/:id/mouvements` | `maintenance:read` |
| `POST` | `/api/spare-parts` | `equipment:manage` |
| `POST` | `/api/spare-parts/:id/reception` | `sparepart:consume` |
| `POST` | `/api/spare-parts/:id/ajustement` | `sparepart:adjust` |
| `GET` | `/api/equipment/:id/historique`, `/mttr`, `/pannes-repetees`, `/api/equipment/pannes-actives` | `maintenance:read` |
| `GET` | `/api/maintenance/home-summary`, `/api/maintenance/users` | `maintenance:read` |

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
| Lots PF | Liste des Lots PF, avec statut qualité et cartons physiques/disponibles |
| Nouveau Lot PF | Création en une étape : Run source, cycle de stérilisation, format, date de production/DLC |
| Situation du Lot PF | **Page unique** : vue générale (avec cartons physiques/bloqués/réservés/disponibles), origine production/stérilisation, emballage (sortie de cartonisation), palettes, expéditions, qualité (décisions et blocages), lien vers la traçabilité |
| Palettes | Liste des palettes, avec statut, statut qualité, emplacement et réservation |
| Nouvelle palette | Création à partir d'un Lot PF et d'un emplacement de destination configuré pour le stock PF |
| Situation de la palette | Composition, mouvements de stock PF (avec transfert), expéditions, décisions qualité |
| Stock PF | Cartes de synthèse (stock total, disponible, bloqué, réservé) et tableau par emplacement/produit |
| Expéditions | Liste et création (client, destination, conteneur) |
| Expédition | **Écran de chargement du conteneur** : informations conteneur/transport, chargement des palettes, confirmation transactionnelle, annulation |
| Traçabilité | Recherche globale — Lot MP, Run, Lot PF, Palette, Expédition, Conteneur, Client — menant chacun à son propre écran |
| Qualité — Vue d'ensemble | Six indicateurs qualité ciblés (non-conformités ouvertes, CAPA en retard, lots bloqués, réclamations ouvertes, audits à venir, actions en retard), sans graphique décoratif |
| Non-conformités | Liste filtrable (N°/date/source/catégorie/gravité/responsable/échéance/statut) et **fiche en onglets** : vue générale, source & liens, investigation, cause racine, CAPA liés, blocage, historique |
| CAPA | Liste (CAPA/source/responsable/ouverture/échéance/actions/efficacité/statut, retards visibles) et fiche : actions, contrôle d'efficacité, clôture bloquée tant que `can_close` est faux |
| Audits | Liste (audit/type/date prévue/périmètre/auditeur/constats/actions ouvertes/statut) et fiche : grille de contrôle (réponses), constats, création d'une non-conformité depuis un constat |
| Documents qualité | Liste (code/titre/type/révision/date d'effet/propriétaire/statut) et fiche : révision en vigueur, historique des révisions (jamais écrasées), acquittements |
| Réclamations | Liste et fiche avec traçabilité recalculée depuis l'expédition (palette → Lot PF → stérilisation → Run → Lot MP → fournisseur), lien vers non-conformité/CAPA |
| Incidents fournisseur | Liste et déclaration, suivi de la performance fournisseur |
| Retraits / rappels | Liste et fiche : entités affectées calculées (Run, cycle, Lot PF, palette, expédition, client) groupées par type, bilan matière du Lot PF, durée d'exécution |
| Paramètres | Données de référence — **employées, standards de cadence, catégories d'arrêt, équipements, milieux de couverture, spécifications de remplissage et de sertissage, programmes de stérilisation, points de vérification de marquage, domaine de stock des emplacements, clients, catégories de non-conformité, grilles de contrôle d'audit** — et utilisateurs |
| Maintenance — Vue d'ensemble | Six indicateurs opérationnels ciblés (pannes ouvertes, équipements en panne, OT en cours, préventifs en retard, interventions du jour, pièces sous minimum), « Accès rapides » distincts des « Actions rapides » |
| Équipements | Liste (code/nom/type/ligne/criticité/statut, hiérarchie visible) et création |
| Équipement | **Fiche en onglets** : vue générale (identité, MTTR, pannes répétées 30 j), pannes, ordres de travail, préventif, historique (pièces utilisées) — l'un des écrans les plus importants de la Phase 7, aucune donnée n'exige de visiter la Maintenance pour être découverte |
| Pannes | Liste filtrable et **déclaration rapide terrain** (équipement, gravité, description, arrêt de production oui/non) |
| Ordres de travail | Liste filtrable (OT/équipement/type/priorité/demandé le/assigné/échéance/statut) et création |
| Ordre de travail | Fiche en onglets : vue générale (statut contraint, remise en service), clôture dédiée (résultat de vérification, `workorder:approve` si nécessaire), interventions (**flux technicien rapide** : démarrer → diagnostic → action → pièces utilisées → terminer) |
| Préventif | Vues Aujourd'hui / 7 jours / 30 jours / En retard (jamais un Gantt complexe), création de plan, complétion de liste de contrôle en ligne |
| Pièces de rechange | Inventaire (stock/minimum, alerte « Stock de sécurité atteint »), réception et ajustement (`sparepart:adjust`) |

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

---

## 11. Identité visuelle et corrections QMS (Phase 6)

### Identité visuelle

Le logo officiel OCEAMIC Laayoune II est la source de vérité de la marque ; il n'a été
ni redessiné ni réinterprété. `web/src/assets/oceamic-mark.png` isole le pictogramme
(bateau + vague), fond transparent, utilisé dans la barre latérale, l'écran de
connexion et le favicon (`web/public/favicon.png`,
`web/public/apple-touch-icon.png`) — le lockup complet fourni était rogné sur son bord
droit ("OCEAMIC" et "Laayoune II" tronqués), donc le nom est composé en typographie web
à côté du pictogramme plutôt que d'afficher l'image tronquée.

La palette (`web/src/styles.css`, tokens `--marque*`) est extraite par échantillonnage
des pixels du logo : bleu marine `#1c3a80` (coque du bateau, texte "OCEAMIC") comme
couleur de marque principale, cyan `#4fb0de` (vague) comme accent secondaire — une
variante assombrie `--marque-cyan-texte` (`#1f6f93`) est utilisée partout où le cyan
sert de texte, le cyan clair ne passant pas le contraste WCAG AA sur fond blanc. Les
actions principales (boutons, liens, état actif de la navigation) utilisent la couleur
de marque ; le vert (`--succes`) reste réservé aux états de succès sémantiques
(Conforme, Libéré, Terminé, Efficace...), jamais réutilisé pour une action.

### Corrections du workflow QMS

Un audit ciblé de la Phase 6 a identifié et corrigé les points suivants (détail des
règles dans [`docs/regles-metier.md`](docs/regles-metier.md), sections 94 et
suivantes) :

- **Transitions de statut d'une non-conformité contraintes** (règle 7.1) : l'écran
  n'offre plus les six statuts en boutons plats — un statut suivant « principal » est
  proposé, les autres transitions valides restent accessibles via « Changer le
  statut ». Le serveur refuse toute transition hors de la liste autorisée
  (`NONCONFORMITY_ALLOWED_TRANSITIONS`), pas seulement l'écran : une non-conformité
  fraîchement `OUVERTE` ne peut plus sauter directement à `CLOTUREE`, qui n'est
  atteignable que depuis `A_VERIFIER`.
- **Cohérence gravité/priorité** (règle 7.3) : une gravité `CRITIQUE` avec une
  priorité `BASSE`/`NORMALE` exige désormais une confirmation explicite
  (`CONFIRMATION_REQUISE`, la même mécanique que la confirmation d'affectation
  multi-ligne en Phase 3) plutôt que de coexister silencieusement. Les non-conformités
  créées automatiquement depuis un constat d'audit ou une réclamation dérivent
  maintenant leur priorité de la gravité au lieu de toujours retomber sur `NORMALE`.
- **Échéances CAPA** (règle 7.4) : les formulaires de création d'un CAPA et d'une
  action CAPA exposent désormais un champ échéance, obligatoire pour une priorité
  `HAUTE`/`URGENTE`. Un bug de typage a aussi été corrigé : la vue `audit_progress`
  ne castait pas ses `COUNT(*)` en `::integer`, si bien que `openFindingCount`
  revenait comme une chaîne de caractères côté API.
- **Libellé de l'efficacité CAPA** (règle 7.6) : affiché « Efficace »/« Non efficace »
  plutôt que « Conforme »/« Non conforme », qui prêtait à confusion avec la conformité
  produit/procédé.
- **Clarté du statut d'un audit** (règle 7.7) : un audit `TERMINE` avec des constats
  encore ouverts l'affiche explicitement (« Audit terminé — N actions ouvertes »),
  liste et fiche, plutôt que de laisser croire que tout est clos.
- **Accès rapides vs actions rapides** (règle 7.9) : la page Qualité — Vue d'ensemble
  distingue désormais la navigation pure (« Accès rapides ») des raccourcis de
  création (« Actions rapides », qui mènent directement au formulaire de création de
  chaque écran).

Le lien relationnel réel entre une non-conformité, une réclamation, une expédition,
une palette, un Lot PF, un cycle de stérilisation, un Run et les Lots MP d'origine
(règle 7.10) a été vérifié : `complaintDetail` (`server/src/services/qmsQueries.ts`)
recalcule cette chaîne via une jointure relationnelle sur neuf tables à chaque
consultation, jamais du texte d'affichage. Une vérification exhaustive confirme
également qu'aucune valeur d'énumération brute n'est exposée à l'écran : les 105
valeurs d'énumération de la Phase 6 passent toutes par `label()` ou une correspondance
dédiée.

---

## 12. Maintenance (Phase 7)

### Dix concepts jamais fusionnés

Comme pour la Phase 6, chaque concept a sa propre table et son propre sens : ÉQUIPEMENT
(identité de l'actif) ; PANNE (événement observé) ; ORDRE DE TRAVAIL (travail
autorisé) ; INTERVENTION (exécution réelle, plusieurs par ordre de travail) ; PLAN
PRÉVENTIF (exigence récurrente) ; TÂCHE PRÉVENTIVE (une occurrence planifiée) ; PIÈCE
DE RECHANGE (identité d'inventaire de maintenance) ; USAGE DE PIÈCE (consommation) ;
ARRÊT DE PRODUCTION (Phase 3, réutilisé, jamais dupliqué) ; REMISE EN SERVICE
(décision opérationnelle de restauration). Trois paires de statuts restent
délibérément distinctes et ne se dérivent jamais l'une de l'autre : la **criticité**
d'un équipement (importance de l'actif) et la **gravité** d'une panne (gravité de
l'événement) ; le **statut opérationnel** de l'équipement (`EN_SERVICE`, `EN_PANNE`,
`EN_MAINTENANCE`...) et le **statut de l'ordre de travail** (`OUVERT`, `EN_COURS`,
`TERMINE`...).

### Panne → arrêt de production : le même événement, jamais dupliqué

Quand une panne arrête réellement la production, `services/failures.ts` appelle
`startDowntimeWithClient` — exactement la fonction que la Phase 3 utilise pour ses
propres arrêts — **dans la même transaction** que la création de la panne. Ce n'est
pas un nouvel arrêt qui ressemble à celui de la Phase 3 : c'est la même ligne de
`downtime_events`, visible identiquement depuis le Run, la ligne, l'équipement et la
panne. Pour permettre cette composition transactionnelle, `startDowntime`/
`endDowntime` (Phase 3) ont été refactorisées en un mince appel à
`startDowntimeWithClient`/`endDowntimeWithClient`, composables dans la transaction
d'un appelant — le comportement public de la Phase 3 est inchangé (126 tests
antérieurs toujours au vert), seule la composabilité interne a été ajoutée.

### Transitions et clôture d'ordre de travail

`WORK_ORDER_ALLOWED_TRANSITIONS`/`WORK_ORDER_PRIMARY_NEXT_STATUS`
(`server/src/domain/types.ts`) appliquent la même discipline que les transitions de
non-conformité de la Phase 6 : un ordre de travail `OUVERT` ne peut pas sauter
directement à `TERMINE`. La clôture est volontairement **exclue** de cette table de
transitions et passe par `completeWorkOrder`, avec une porte de clôture propre :

1. au moins une intervention avec une action réalisée documentée doit exister ;
2. pour un équipement à criticité HAUTE/CRITIQUE, ou un ordre de travail de type
   URGENCE, un résultat de vérification (Conforme/Non conforme) est obligatoire —
   `workOrderClosureRequiresApproval` centralise cette condition, lue par la route
   AVANT de choisir entre `workorder:manage` et `workorder:approve` (section 5) ;
3. une vérification `NON_CONFORME` clôture bien le travail effectué mais **ne** remet
   **pas** l'équipement en service et **ne** résout **pas** la panne source — un
   nouvel ordre de travail est nécessaire, l'équipement reste `EN_PANNE`.

La remise en service (`restored_at`/`restored_by`/`verification_result`) est un jeu de
colonnes distinct du statut : un technicien qui termine son intervention n'est pas le
même fait que l'équipement libéré pour la production.

### Durée d'intervention et pièces : jamais saisies, jamais doublées

`maintenance_interventions.duration_seconds` est une colonne générée, à l'identique de
`downtime_events.duration_seconds` (Phase 3) : la durée ne peut jamais diverger des
horodatages de début/fin. Une pièce consommée (`recordPartUsage`) crée dans la même
transaction exactement un mouvement `SORTIE_INTERVENTION` et une ligne
`maintenance_part_usage` dont `stock_movement_id` est `UNIQUE` — une consommation ne
peut structurellement jamais soustraire le stock deux fois.

### Retard préventif : toujours dérivé, jamais choisi

`preventive_task_status` (vue) calcule `is_overdue` comme `statut = PLANIFIEE AND
échéance < maintenant`, exactement la même discipline que les CAPA/actions en retard
de la Phase 6. Compléter une tâche dont le plan a une fréquence calendaire (mensuelle,
trimestrielle...) génère automatiquement la tâche suivante (échéance + intervalle
fixe) dans la même transaction — un plan n'est jamais laissé sans prochaine échéance.
Les fréquences `OPERATING_HOURS`/`CUSTOM` ne génèrent rien automatiquement : Phase 7
n'intègre aucun compteur d'heures d'exploitation, et planifier une fausse échéance
serait pire que de laisser la planification manuelle.

### MTTR et pannes répétées : jamais de métrique trompeuse

`equipment_mttr` (vue) ne produit une ligne que pour un équipement ayant au moins un
ordre de travail correctif réellement `TERMINE` avec une intervention chronométrée ;
sans historique suffisant, l'écran affiche « Données insuffisantes », jamais une
moyenne à zéro. L'analyse de panne répétée (`repeatedFailureAnalysis`) est un simple
`GROUP BY` mode/cause sur une fenêtre glissante — aucune IA, conformément au
scénario d'acceptation correspondant.
