/** Écran — Stock (chambre positive et produit fini). */

import { fmt, fmtInt } from '../domain/calculations';
import { appliquerFiltres, stockChambre } from '../domain/selectors';
import { BarreFiltres } from '../ui/filtres';
import { heure, libelleLot, libelleProduit } from '../ui/options';
import { Badge, Carte, Kpi, PageHeader, Tableau } from '../ui/primitives';
import { useDb, useFiltres } from '../ui/state';

export function PageStock() {
  const db = useDb();
  const { filtres } = useFiltres();

  const stock = stockChambre(db, filtres);
  const totalStock = stock.reduce((t, l) => t + l.stock, 0);
  const totalEntrees = stock.reduce((t, l) => t + l.entrees, 0);
  const totalSorties = stock.reduce((t, l) => t + l.sorties, 0);

  // Stock produit fini: boîtes emballées, en cartons et palettes.
  const emballages = appliquerFiltres(db.packagingOperations, filtres);
  const parLot = new Map<string, { boites: number; cartons: number; palettes: number; productId?: string }>();
  for (const e of emballages) {
    const courant = parLot.get(e.lotId) ?? { boites: 0, cartons: 0, palettes: 0, productId: e.productId };
    parLot.set(e.lotId, {
      boites: courant.boites + e.nombreBoites,
      cartons: courant.cartons + e.nombreCartons,
      palettes: courant.palettes + e.nombrePalettes,
      productId: e.productId ?? courant.productId,
    });
  }
  const produitFini = [...parLot.entries()].map(([lotId, v]) => ({ lotId, ...v }));

  // Stock par espèce, utile pour l'approvisionnement.
  const parEspece = new Map<string, number>();
  for (const l of stock) parEspece.set(l.espece, (parEspece.get(l.espece) ?? 0) + l.stock);

  return (
    <>
      <PageHeader
        titre="Stock"
        sousTitre="Matière première en chambre positive et produit fini disponible. Stock = entrées − sorties."
      />
      <BarreFiltres criteres={['dateDebut', 'dateFin', 'lotId', 'espece', 'productId']} />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi libelle="Entrées matière" valeur={fmtInt(totalEntrees)} unite="kg" />
        <Kpi libelle="Sorties matière" valeur={fmtInt(totalSorties)} unite="kg" />
        <Kpi
          libelle="Stock chambre"
          valeur={fmtInt(totalStock)}
          unite="kg"
          ton={totalStock < 0 ? 'critique' : 'bon'}
        />
        <Kpi
          libelle="Produit fini"
          valeur={fmtInt(produitFini.reduce((t, p) => t + p.boites, 0))}
          unite="boîtes"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Carte titre="Stock chambre positive par lot" className="xl:col-span-2">
          <Tableau
            lignes={stock}
            clef={(l) => `${l.lotId}-${l.chambre}`}
            messageVide="Aucun mouvement de stock."
            colonnes={[
              { cle: 'lot', entete: 'Lot', rendu: (l) => <span className="font-medium">{l.lotCode}</span> },
              { cle: 'espece', entete: 'Espèce', rendu: (l) => l.espece },
              { cle: 'chambre', entete: 'Chambre', rendu: (l) => l.chambre },
              { cle: 'entrees', entete: 'Entrées (kg)', rendu: (l) => fmtInt(l.entrees), numerique: true },
              { cle: 'sorties', entete: 'Sorties (kg)', rendu: (l) => fmtInt(l.sorties), numerique: true },
              {
                cle: 'stock',
                entete: 'Stock (kg)',
                rendu: (l) => (
                  <span
                    className={`font-semibold ${
                      l.stock < 0 ? 'text-rose-600' : l.stock === 0 ? 'text-ardoise-400' : 'text-emerald-700'
                    }`}
                  >
                    {fmtInt(l.stock)}
                  </span>
                ),
                numerique: true,
              },
              {
                cle: 'taux',
                entete: 'Consommé',
                rendu: (l) => (l.entrees ? `${fmt((l.sorties / l.entrees) * 100)} %` : '—'),
                numerique: true,
                secondaire: true,
              },
              {
                cle: 'dernier',
                entete: 'Dernier mouvement',
                rendu: (l) => heure(l.dernierMouvement),
                secondaire: true,
              },
            ]}
          />
        </Carte>

        <Carte titre="Stock par espèce">
          <Tableau
            lignes={[...parEspece.entries()].map(([espece, quantite]) => ({ espece, quantite }))}
            clef={(l) => l.espece}
            messageVide="Aucun stock."
            colonnes={[
              { cle: 'espece', entete: 'Espèce', rendu: (l) => l.espece },
              {
                cle: 'quantite',
                entete: 'Stock (kg)',
                rendu: (l) => <span className="font-semibold">{fmtInt(l.quantite)}</span>,
                numerique: true,
              },
            ]}
          />
        </Carte>
      </div>

      <div className="mt-4">
        <Carte titre="Stock produit fini">
          <Tableau
            lignes={produitFini}
            clef={(p) => p.lotId}
            messageVide="Aucun produit fini emballé."
            colonnes={[
              {
                cle: 'lot',
                entete: 'Lot',
                rendu: (p) => <span className="font-medium">{libelleLot(db, p.lotId)}</span>,
              },
              { cle: 'produit', entete: 'Produit', rendu: (p) => libelleProduit(db, p.productId) },
              { cle: 'boites', entete: 'Boîtes', rendu: (p) => fmtInt(p.boites), numerique: true },
              { cle: 'cartons', entete: 'Cartons', rendu: (p) => fmtInt(p.cartons), numerique: true },
              { cle: 'palettes', entete: 'Palettes', rendu: (p) => fmtInt(p.palettes), numerique: true },
              {
                cle: 'statut',
                entete: 'Statut',
                rendu: (p) => (
                  <Badge ton="bon">
                    {db.lots.find((l) => l.id === p.lotId)?.statut ?? 'Disponible'}
                  </Badge>
                ),
              },
            ]}
          />
        </Carte>
      </div>
    </>
  );
}
