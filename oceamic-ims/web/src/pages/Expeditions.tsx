import { useState } from 'react';
import { Link } from 'react-router-dom';
import { buildQuery } from '../api';
import { useAuth } from '../auth';
import { Badge, Card, DataTable, PageHeader } from '../components/ui';
import { formatDate, formatDateTime } from '../format';
import { useResource } from '../hooks';

type ShipmentRow = Readonly<{
  id: string;
  shipmentCode: string;
  plannedDate: string;
  shippedAt: string | null;
  customerName: string;
  destination: string;
  containerNumber: string | null;
  status: string;
  palletCount: number;
}>;

export function Expeditions() {
  const { can } = useAuth();
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const { data, error, loading } = useResource<readonly ShipmentRow[]>(
    `/api/shipments${buildQuery({ recherche: applied })}`,
  );

  return (
    <>
      <PageHeader
        title="Expéditions"
        subtitle="Préparation et historique"
        actions={
          can('shipment:manage') ? (
            <Link to="/expeditions/nouvelle">
              <button type="button">Nouvelle expédition</button>
            </Link>
          ) : null
        }
      />

      <Card title={null}>
        <form
          className="filtres"
          onSubmit={(event) => {
            event.preventDefault();
            setApplied(search);
          }}
        >
          <input
            placeholder="Code expédition ou conteneur"
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
              { key: 'expedition', label: 'Expédition', numeric: false },
              { key: 'client', label: 'Client', numeric: false },
              { key: 'destination', label: 'Destination', numeric: false },
              { key: 'conteneur', label: 'Conteneur', numeric: false },
              { key: 'date', label: 'Date prévue', numeric: false },
              { key: 'statut', label: 'Statut', numeric: false },
              { key: 'palettes', label: 'Palettes', numeric: true },
              { key: 'expedie', label: 'Expédié le', numeric: false },
            ]}
            isEmpty={(data ?? []).length === 0}
            emptyText="Aucune expédition ne correspond aux filtres."
          >
            {(data ?? []).map((row) => (
              <tr key={row.id}>
                <td>
                  <Link to={`/expeditions/${row.id}`}>
                    <strong>{row.shipmentCode}</strong>
                  </Link>
                </td>
                <td>{row.customerName}</td>
                <td>{row.destination}</td>
                <td>{row.containerNumber ?? '-'}</td>
                <td>{formatDate(row.plannedDate)}</td>
                <td>
                  <Badge value={row.status} />
                </td>
                <td className="nombre">{row.palletCount}</td>
                <td>{formatDateTime(row.shippedAt)}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Card>
    </>
  );
}
