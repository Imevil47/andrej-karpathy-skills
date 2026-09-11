import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiPost } from '../api';
import { useAuth } from '../auth';
import { Badge, Card, DataTable, Field, Message, PageHeader } from '../components/ui';
import { label } from '../format';
import { useEquipment, useProductionLines } from '../masterdata';

const EQUIPMENT_TYPES = [
  'SERTISSEUSE',
  'AUTOCLAVE',
  'REMPLISSEUSE',
  'CONVOYEUR',
  'POMPE',
  'COMPRESSEUR',
  'CHAUDIERE',
  'CHAMBRE_FROIDE',
  'BALANCE',
  'DETECTEUR',
  'MACHINE_TRAITEMENT',
  'AUTRE',
] as const;
const CRITICALITIES = ['FAIBLE', 'MOYENNE', 'HAUTE', 'CRITIQUE'] as const;

/** Équipements (section 8) : registre, hiérarchie, criticité et statut. */
export function Equipements() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const equipment = useEquipment();
  const productionLines = useProductionLines();

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [equipmentType, setEquipmentType] = useState<(typeof EQUIPMENT_TYPES)[number]>('AUTRE');
  const [criticality, setCriticality] = useState<(typeof CRITICALITIES)[number]>('MOYENNE');
  const [productionLineId, setProductionLineId] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    setCreateError(null);
    try {
      await apiPost('/api/equipment', {
        code: code.trim(),
        name: name.trim(),
        equipmentType,
        locationId: null,
        manufacturer: null,
        model: null,
        serialNumber: null,
        productionLineId: productionLineId === '' ? null : productionLineId,
        parentEquipmentId: null,
        criticality,
        commissionedAt: null,
      });
      equipment.reload();
      setCode('');
      setName('');
      navigate('/maintenance/equipements');
    } catch (failure) {
      setCreateError((failure as Error).message);
    }
  };

  return (
    <>
      <PageHeader title="Équipements" subtitle="Registre, criticité et statut opérationnel" actions={null} />
      <Message kind="erreur" text={createError} />

      {can('equipment:manage') ? (
        <Card title="Nouvel équipement">
          <form id="creation" onSubmit={create}>
            <div className="grille-champs">
              <Field label="Code" hint={null}>
                <input value={code} onChange={(event) => setCode(event.target.value)} required />
              </Field>
              <Field label="Nom" hint={null}>
                <input value={name} onChange={(event) => setName(event.target.value)} required />
              </Field>
              <Field label="Type" hint={null}>
                <select value={equipmentType} onChange={(event) => setEquipmentType(event.target.value as typeof equipmentType)}>
                  {EQUIPMENT_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {label(type)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Criticité" hint="Importance de l'actif, distincte de la gravité d'une panne.">
                <select value={criticality} onChange={(event) => setCriticality(event.target.value as typeof criticality)}>
                  {CRITICALITIES.map((value) => (
                    <option key={value} value={value}>
                      {label(value)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Ligne de production" hint={null}>
                <select value={productionLineId} onChange={(event) => setProductionLineId(event.target.value)}>
                  <option value="">Aucune</option>
                  {(productionLines.data ?? []).map((line) => (
                    <option key={line.id} value={line.id}>
                      {line.code} — {line.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="ligne-boutons">
              <button type="submit">Créer</button>
            </div>
          </form>
        </Card>
      ) : null}

      <Card title={null}>
        {equipment.error ? <div className="message erreur">{equipment.error}</div> : null}
        {equipment.loading ? (
          <p>Chargement...</p>
        ) : (
          <DataTable
            columns={[
              { key: 'code', label: 'Code', numeric: false },
              { key: 'nom', label: 'Nom', numeric: false },
              { key: 'type', label: 'Type', numeric: false },
              { key: 'ligne', label: 'Ligne', numeric: false },
              { key: 'criticite', label: 'Criticité', numeric: false },
              { key: 'statut', label: 'Statut', numeric: false },
            ]}
            isEmpty={(equipment.data ?? []).length === 0}
            emptyText="Aucun équipement."
          >
            {(equipment.data ?? []).map((row) => (
              <tr key={row.id}>
                <td>
                  <Link to={`/maintenance/equipements/${row.id}`}>
                    <strong>{row.code}</strong>
                  </Link>
                  {row.parentEquipmentCode ? (
                    <div className="aide">Composant de {row.parentEquipmentCode}</div>
                  ) : null}
                </td>
                <td>{row.name}</td>
                <td>{label(row.equipmentType)}</td>
                <td>{row.productionLineCode ?? '-'}</td>
                <td>
                  <Badge value={row.criticality} />
                </td>
                <td>
                  <Badge value={row.status} />
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </Card>
    </>
  );
}
