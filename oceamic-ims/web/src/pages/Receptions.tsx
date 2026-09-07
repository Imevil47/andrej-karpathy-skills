import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth';
import { Badge, Card, DataTable, PageHeader } from '../components/ui';
import { buildQuery } from '../api';
import { formatDateTime, formatQuantity, label } from '../format';
import { useResource } from '../hooks';

type ReceptionRow = Readonly<{
  id: string;
  receptionCode: string;
  receivedAt: string;
  quantityKg: string;
  receptionType: string;
  truckRegistration: string | null;
  lotId: string;
  lotCode: string;
  speciesCode: string;
  supplierName: string | null;
  destinationLocationCode: string;
  destinationStockType: string;
  createdByName: string;
}>;

export function Receptions() {
  const { can } = useAuth();
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const { data, error, loading } = useResource<readonly ReceptionRow[]>(
    `/api/receptions${buildQuery({ recherche: appliedSearch })}`,
  );

  return (
    <>
      <PageHeader
        title="Réceptions"
        subtitle="Entrées de matière première"
        actions={
          can('reception:create') ? (
            <Link to="/receptions/nouvelle">
              <button type="button">Nouvelle réception</button>
            </Link>
          ) : null
        }
      />

      <Card title={null}>
        <form
          className="filtres"
          onSubmit={(event) => {
            event.preventDefault();
            setAppliedSearch(search);
          }}
        >
          <input
            placeholder="Lot, code réception ou immatriculation"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <button type="submit" className="secondaire">
            Rechercher
          </button>
        </form>

        {error ? <div className="message erreur">{error}</div> : null}
        {loading ? (
          <p>Chargement...</p>
        ) : (
          <DataTable
            columns={[
              { key: 'code', label: 'Réception', numeric: false },
              { key: 'date', label: 'Date', numeric: false },
              { key: 'lot', label: 'Lot', numeric: false },
              { key: 'espece', label: 'Espèce', numeric: false },
              { key: 'fournisseur', label: 'Fournisseur', numeric: false },
              { key: 'camion', label: 'Camion', numeric: false },
              { key: 'destination', label: 'Destination', numeric: false },
              { key: 'type', label: 'Type', numeric: false },
              { key: 'quantite', label: 'Quantité (kg)', numeric: true },
            ]}
            isEmpty={(data ?? []).length === 0}
            emptyText="Aucune réception enregistrée."
          >
            {(data ?? []).map((row) => (
              <tr key={row.id}>
                <td>
                  <strong>{row.receptionCode}</strong>
                </td>
                <td>{formatDateTime(row.receivedAt)}</td>
                <td>
                  <Link to={`/lots/${row.lotId}`}>{row.lotCode}</Link>
                </td>
                <td>{row.speciesCode}</td>
                <td>{row.supplierName ?? '-'}</td>
                <td>{row.truckRegistration ?? '-'}</td>
                <td>
                  {row.destinationLocationCode} <Badge value={row.destinationStockType} />
                </td>
                <td>{label(row.receptionType)}</td>
                <td className="nombre">{formatQuantity(row.quantityKg)}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Card>
    </>
  );
}
