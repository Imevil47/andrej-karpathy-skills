# Gestion d’Exploitation — Usine de Conserves

Application web de gestion d’exploitation et de traçabilité pour une usine de
conserves de poisson. Elle suit la matière depuis l’arrivée du camion jusqu’à la
palette de produit fini.

## Démarrer

```bash
npm install
npm run dev      # développement
npm run build    # build de production dans dist/
npm run preview  # sert le build
npm test         # tests des calculs et des contrôles de cohérence
```

L’application s’ouvre avec un jeu de démonstration (une journée complète
d’exploitation: 3 lots, 4 lignes de traitement, 4 lignes de grattage, 12
opératrices, 12 arrêts). Pour repartir de zéro:
**Paramètres → Données → Vider les opérations**.

## Ce que le système répond

| Question | Où |
|---|---|
| Qu’est-ce qui est entré, quelle quantité, quel lot ? | Réception, Chambre positive |
| Où est passée la matière ? | Traçabilité |
| Quelle quantité a été perdue / transformée ? | Chaque écran de production, Rapports |
| Combien de temps l’opération a pris ? | Durée brute et temps net, calculés |
| Combien de temps la ligne a été arrêtée, et pourquoi ? | Arrêts |
| Quelle est la cadence, le rendement, la productivité ? | Dashboard, Rapports |
| Où se trouve l’écart matière ? | Bilan par lot, Dashboard |
| Quel lot a produit quel produit fini ? | Traçabilité (aval et amont) |

## Architecture

```
src/
  domain/
    types.ts          19 tables métier, toutes rattachées au Lot ID
    calculations.ts   rendement, perte, temps net, cadence, productivité, écart
    coherence.ts      détection automatique des incohérences (section 18)
    selectors.ts      stock, traçabilité, bilans, agrégats du dashboard
  data/
    store.ts          persistance (localStorage) derrière une API typée
    seed.ts           jeu de démonstration
  ui/                 composants partagés (tableaux, formulaires, filtres, graphiques)
  pages/              les écrans
```

### Principes

**Un seul fil: le Lot ID.** Toute opération porte le lot auquel elle se rapporte.
La traçabilité amont/aval n’est pas une fonction à part: elle découle du modèle.

**L’utilisateur ne saisit jamais un calcul.** Il saisit entrées, sorties, heures,
arrêts, production et personnel. Durée, temps net, cadence, rendement, perte,
écart, productivité, taux de conformité et consommation théorique sont déduits.
Les résultats s’affichent en direct pendant la saisie.

**Les arrêts sont imputés à la ressource.** Un arrêt déclaré sur une ligne ou une
machine ne réduit le temps net que des opérations de cette ressource dont il
recouvre la plage horaire — jamais celui de toute l’usine.

**Les incohérences sont signalées, pas corrigées.** Sortie supérieure à l’entrée,
perte négative, stock négatif, boîtes serties dépassant les boîtes remplies,
heure de fin antérieure au début, arrêts qui se chevauchent, lot inexistant,
production sans matière disponible: le moteur de cohérence les remonte dans
Rapports et dans le bandeau d’alerte.

### Écart matière

`Écart = matière sortie de chambre − matière retrouvée − pertes déclarées`

La « matière retrouvée » est la sortie de l’étape la plus avancée que le lot ait
atteinte (remplissage, sinon grattage, sinon cuisson, sinon traitement).
Comparer la sortie de chambre au traitement tout en déduisant les pertes de
cuisson compterait deux fois les mêmes kilos. Sur un lot encore en production,
l’écart contient l’en-cours: il ne devient une alerte qu’une fois le lot clôturé.

## Persistance

Les données vivent dans le navigateur (`localStorage`), derrière la couche
`data/store.ts`. Remplacer ses fonctions de lecture/écriture par des appels HTTP
suffit à basculer sur une base serveur sans toucher aux écrans.

**Paramètres → Données** permet d’exporter la base en JSON, de la réimporter sur
un autre poste, et d’exporter les synthèses en CSV depuis Rapports.

## Interface

Utilisable sur PC, tablette et téléphone: navigation latérale sur grand écran,
menu escamotable sur mobile, tableaux défilants horizontalement, colonnes
secondaires masquées sur petit écran, cibles tactiles de 44 px.
