import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Badge, Card, DataTable, KeyValue, PageHeader, Tabs } from '../components/ui';
import { formatDate, formatDateTime, formatDuration, label } from '../format';
import { useResource } from '../hooks';
import type { Equipment } from '../masterdata';

type FailureRow = Readonly<{
  id: string;
  failureCode: string;
  severity: string;
  status: string;
  description: string;
  reportedAt: string;
  resolvedAt: string | null;
}>;

type WorkOrderRow = Readonly<{
  id: string;
  workOrderCode: string;
  workOrderType: string;
  priority: string;
  status: string;
  title: string;
  requestedAt: string;
  dueAt: string | null;
}>;

type PreventiveTaskRow = Readonly<{
  id: string;
  planName: string;
  dueAt: string;
  status: string;
  isOverdue: boolean;
  completedAt: string | null;
}>;

type PartUsageRow = Readonly<{
  id: string;
  sparePartCode: string;
  sparePartName: string;
  quantity: string;
  workOrderCode: string;
  occurredAt: string;
}>;

type History = Readonly<{
  failures: readonly FailureRow[];
  workOrders: readonly WorkOrderRow[];
  preventiveTasks: readonly PreventiveTaskRow[];
  partUsage: readonly PartUsageRow[];
}>;

type Mttr = Readonly<{ completedCorrectiveCount: number; totalDurationSeconds: number; mttrSeconds: number }> | null;

type RepeatedFailureGroup = Readonly<{
  failureModeCode: string | null;
  failureCauseCode: string | null;
  occurrenceCount: number;
  lastReportedAt: string;
}>;

const TABS = [
  { key: 'general', label: 'Vue générale' },
  { key: 'pannes', label: 'Pannes' },
  { key: 'ot', label: 'Ordres de travail' },
  { key: 'preventif', label: 'Préventif' },
  { key: 'historique', label: 'Historique' },
] as const;

/** Équipement (section 33) : l'un des écrans les plus importants du Phase 7
 * - pannes, ordres de travail, préventif et historique en un seul endroit,
 * sans jamais avoir à visiter la Maintenance pour les découvrir. */
export function EquipementDetail() {
  const { id } = useParams();
  const equipment = useResource<Equipment>(`/api/equipment/${id}`);
  const history = useResource<History>(`/api/equipment/${id}/historique`);
  const mttr = useResource<Mttr>(`/api/equipment/${id}/mttr`);
  const repeatedFailures = useResource<readonly RepeatedFailureGroup[]>(`/api/equipment/${id}/pannes-repetees?jours=30`);
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('general');

  if (equipment.loading && equipment.data === null) {
    return <p>Chargement...</p>;
  }
  if (equipment.data === null) {
    return <div className="message erreur">{equipment.error ?? 'Équipement introuvable.'}</div>;
  }

  const eq = equipment.data;

  return (
    <>
      <PageHeader
        title={`${eq.code} — ${eq.name}`}
        subtitle={label(eq.equipmentType)}
        actions={
          <>
            <Badge value={eq.criticality} />
            <Badge value={eq.status} />
          </>
        }
      />

      <Tabs tabs={TABS} active={tab} onSelect={(key) => setTab(key as (typeof TABS)[number]['key'])} />

      {tab === 'general' ? (
        <Card title={null}>
          <KeyValue
            items={[
              { key: 'Type', value: label(eq.equipmentType) },
              { key: 'Ligne de production', value: eq.productionLineCode ?? '-' },
              {
                key: 'Équipement parent',
                value: eq.parentEquipmentId ? (
                  <Link to={`/maintenance/equipements/${eq.parentEquipmentId}`}>{eq.parentEquipmentCode}</Link>
                ) : (
                  '-'
                ),
              },
              { key: 'Fabricant', value: eq.manufacturer ?? '-' },
              { key: 'Modèle', value: eq.model ?? '-' },
              { key: 'N° de série', value: eq.serialNumber ?? '-' },
              { key: 'Mise en service', value: formatDate(eq.commissionedAt) },
              {
                key: 'MTTR (temps moyen de réparation)',
                value:
                  mttr.data === null
                    ? 'Données insuffisantes'
                    : `${formatDuration(mttr.data.mttrSeconds)} (sur ${mttr.data.completedCorrectiveCount} réparation(s))`,
              },
            ]}
          />
          {(repeatedFailures.data ?? []).length > 0 ? (
            <div style={{ marginTop: 18 }}>
              <h3>Pannes répétées (30 derniers jours)</h3>
              <DataTable
                columns={[
                  { key: 'mode', label: 'Mode', numeric: false },
                  { key: 'cause', label: 'Cause', numeric: false },
                  { key: 'occurrences', label: 'Occurrences', numeric: true },
                  { key: 'derniere', label: 'Dernière', numeric: false },
                ]}
                isEmpty={false}
                emptyText=""
              >
                {(repeatedFailures.data ?? []).map((group) => (
                  <tr key={`${group.failureModeCode}-${group.failureCauseCode}`}>
                    <td>{label(group.failureModeCode)}</td>
                    <td>{label(group.failureCauseCode)}</td>
                    <td className="nombre">{group.occurrenceCount}</td>
                    <td>{formatDateTime(group.lastReportedAt)}</td>
                  </tr>
                ))}
              </DataTable>
            </div>
          ) : null}
        </Card>
      ) : null}

      {tab === 'pannes' ? (
        <Card title="Pannes">
          <DataTable
            columns={[
              { key: 'code', label: 'N°', numeric: false },
              { key: 'gravite', label: 'Gravité', numeric: false },
              { key: 'description', label: 'Description', numeric: false },
              { key: 'declaree', label: 'Déclarée le', numeric: false },
              { key: 'statut', label: 'Statut', numeric: false },
            ]}
            isEmpty={(history.data?.failures ?? []).length === 0}
            emptyText="Aucune panne."
          >
            {(history.data?.failures ?? []).map((row) => (
              <tr key={row.id}>
                <td>
                  <strong>{row.failureCode}</strong>
                </td>
                <td>
                  <Badge value={row.severity} />
                </td>
                <td>{row.description}</td>
                <td>{formatDateTime(row.reportedAt)}</td>
                <td>
                  <Badge value={row.status} />
                </td>
              </tr>
            ))}
          </DataTable>
        </Card>
      ) : null}

      {tab === 'ot' ? (
        <Card title="Ordres de travail">
          <DataTable
            columns={[
              { key: 'code', label: 'OT', numeric: false },
              { key: 'type', label: 'Type', numeric: false },
              { key: 'priorite', label: 'Priorité', numeric: false },
              { key: 'titre', label: 'Titre', numeric: false },
              { key: 'demande', label: 'Demandé le', numeric: false },
              { key: 'statut', label: 'Statut', numeric: false },
            ]}
            isEmpty={(history.data?.workOrders ?? []).length === 0}
            emptyText="Aucun ordre de travail."
          >
            {(history.data?.workOrders ?? []).map((row) => (
              <tr key={row.id}>
                <td>
                  <Link to={`/maintenance/ordres-de-travail/${row.id}`}>
                    <strong>{row.workOrderCode}</strong>
                  </Link>
                </td>
                <td>{label(row.workOrderType)}</td>
                <td>
                  <Badge value={row.priority} />
                </td>
                <td>{row.title}</td>
                <td>{formatDateTime(row.requestedAt)}</td>
                <td>
                  <Badge value={row.status} />
                </td>
              </tr>
            ))}
          </DataTable>
        </Card>
      ) : null}

      {tab === 'preventif' ? (
        <Card title="Maintenance préventive">
          <DataTable
            columns={[
              { key: 'plan', label: 'Plan', numeric: false },
              { key: 'echeance', label: 'Échéance', numeric: false },
              { key: 'statut', label: 'Statut', numeric: false },
              { key: 'realisee', label: 'Réalisée le', numeric: false },
            ]}
            isEmpty={(history.data?.preventiveTasks ?? []).length === 0}
            emptyText="Aucune tâche préventive."
          >
            {(history.data?.preventiveTasks ?? []).map((row) => (
              <tr key={row.id}>
                <td>{row.planName}</td>
                <td>
                  {formatDate(row.dueAt)}
                  {row.isOverdue ? <div className="badge alerte" style={{ marginTop: 4 }}>En retard</div> : null}
                </td>
                <td>
                  <Badge value={row.status} />
                </td>
                <td>{formatDate(row.completedAt)}</td>
              </tr>
            ))}
          </DataTable>
        </Card>
      ) : null}

      {tab === 'historique' ? (
        <Card title="Pièces utilisées">
          <DataTable
            columns={[
              { key: 'piece', label: 'Pièce', numeric: false },
              { key: 'quantite', label: 'Quantité', numeric: true },
              { key: 'ot', label: 'Ordre de travail', numeric: false },
              { key: 'date', label: 'Date', numeric: false },
            ]}
            isEmpty={(history.data?.partUsage ?? []).length === 0}
            emptyText="Aucune pièce consommée."
          >
            {(history.data?.partUsage ?? []).map((row) => (
              <tr key={row.id}>
                <td>
                  {row.sparePartCode} — {row.sparePartName}
                </td>
                <td className="nombre">{row.quantity}</td>
                <td>{row.workOrderCode}</td>
                <td>{formatDateTime(row.occurredAt)}</td>
              </tr>
            ))}
          </DataTable>
        </Card>
      ) : null}
    </>
  );
}
