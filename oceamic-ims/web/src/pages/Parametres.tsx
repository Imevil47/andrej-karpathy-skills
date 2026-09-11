import { useState } from 'react';
import { apiPost } from '../api';
import { Badge, Card, DataTable, Field, Message, PageHeader } from '../components/ui';
import { label } from '../format';
import {
  useAuditChecklists,
  useCadenceStandards,
  useCustomers,
  useDowntimeCategories,
  useEmployees,
  useEquipment,
  useFillingMedia,
  useFillingSpecs,
  useLocations,
  useLossReasons,
  useMarkingVerificationItems,
  useNonconformityCategories,
  useProductionLines,
  useProducts,
  useSeamingParameters,
  useSeamingSpecs,
  useSpecies,
  useSterilizationPrograms,
  useSubcontractors,
  useSuppliers,
  useVessels,
} from '../masterdata';
import { useResource } from '../hooks';

const EQUIPMENT_TYPES = ['SERTISSEUSE', 'AUTOCLAVE', 'REMPLISSEUSE', 'AUTRE'] as const;
const AUDIT_TYPES = ['INTERNE', 'CLIENT', 'CERTIFICATION', 'AUTORITE', 'FOURNISSEUR', 'HYGIENE', 'PROCESS', 'AUTRE'] as const;

type UserRow = Readonly<{
  id: string;
  username: string;
  fullName: string;
  role: string;
  isActive: boolean;
}>;

/**
 * Master data administration. Records are deactivated, never deleted, so the
 * historical operations that reference them stay valid.
 */
export function Parametres() {
  const species = useSpecies();
  const suppliers = useSuppliers();
  const vessels = useVessels();
  const locations = useLocations();
  const subcontractors = useSubcontractors();
  const products = useProducts();
  const productionLines = useProductionLines();
  const lossReasons = useLossReasons();
  const employees = useEmployees();
  const cadenceStandards = useCadenceStandards();
  const downtimeCategories = useDowntimeCategories();
  const equipment = useEquipment();
  const fillingMedia = useFillingMedia();
  const fillingSpecs = useFillingSpecs();
  const seamingParameters = useSeamingParameters();
  const seamingSpecs = useSeamingSpecs();
  const sterilizationPrograms = useSterilizationPrograms();
  const markingItems = useMarkingVerificationItems();
  const customers = useCustomers();
  const nonconformityCategories = useNonconformityCategories();
  const auditChecklists = useAuditChecklists();
  const users = useResource<readonly UserRow[]>('/api/users');

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [speciesForm, setSpeciesForm] = useState({ code: '', name: '' });
  const [supplierForm, setSupplierForm] = useState({ code: '', name: '', country: '' });
  const [vesselForm, setVesselForm] = useState({ code: '', name: '', registration: '' });
  const [locationForm, setLocationForm] = useState({
    code: '',
    name: '',
    stockType: 'INTERNE',
    locationType: 'USINE',
    stockDomain: 'MP',
  });
  const [customerForm, setCustomerForm] = useState({ code: '', name: '', country: '', city: '' });
  const [subcontractorForm, setSubcontractorForm] = useState({
    code: '',
    name: '',
    locationId: '',
  });
  const [productForm, setProductForm] = useState({
    code: '',
    name: '',
    speciesId: '',
    format: '',
    piecesPerCan: '',
  });
  const [lineForm, setLineForm] = useState({ code: '', name: '', area: '' });
  const [reasonForm, setReasonForm] = useState({
    code: '',
    name: '',
    outputType: 'PERTE_REELLE',
  });
  const [employeeForm, setEmployeeForm] = useState({
    employeeNumber: '',
    firstName: '',
    lastName: '',
  });
  const [downtimeCategoryForm, setDowntimeCategoryForm] = useState({ code: '', name: '' });
  const [standardForm, setStandardForm] = useState({
    speciesId: '',
    productId: '',
    activityType: 'GRATTAGE_REMPLISSAGE',
    format: '',
    piecesPerCan: '',
    measurementUnit: 'BOITES',
    standardCadence: '',
  });
  const [equipmentForm, setEquipmentForm] = useState({
    code: '',
    name: '',
    equipmentType: 'AUTOCLAVE',
  });
  const [fillingMediumForm, setFillingMediumForm] = useState({ code: '', name: '' });
  const [fillingSpecForm, setFillingSpecForm] = useState({
    productId: '',
    format: '',
    minWeightG: '',
    maxWeightG: '',
    targetNetWeightG: '',
  });
  const [seamingParameterForm, setSeamingParameterForm] = useState({
    code: '',
    name: '',
    defaultUnit: 'MM',
  });
  const [seamingSpecForm, setSeamingSpecForm] = useState({
    seamingParameterId: '',
    productId: '',
    minValue: '',
    maxValue: '',
    targetValue: '',
    unit: 'MM',
  });
  const [sterilizationProgramForm, setSterilizationProgramForm] = useState({
    code: '',
    name: '',
    productId: '',
    targetF0: '',
    minimumF0: '',
    maximumF0: '',
  });
  const [markingItemForm, setMarkingItemForm] = useState({ code: '', name: '' });
  const [nonconformityCategoryForm, setNonconformityCategoryForm] = useState({ code: '', name: '' });
  const [auditChecklistForm, setAuditChecklistForm] = useState({ code: '', name: '', auditType: 'INTERNE' });

  const run = async (action: () => Promise<unknown>, message: string, reload: () => void) => {
    setError(null);
    setSuccess(null);
    try {
      await action();
      setSuccess(message);
      reload();
    } catch (failure) {
      setError((failure as Error).message);
    }
  };

  return (
    <>
      <PageHeader title="Paramètres" subtitle="Données de référence et utilisateurs" actions={null} />
      <Message kind="erreur" text={error} />
      <Message kind="succes" text={success} />

      <Card title="Espèces">
        <form
          className="filtres"
          onSubmit={(event) => {
            event.preventDefault();
            void run(
              () => apiPost('/api/species', speciesForm),
              'Espèce créée.',
              species.reload,
            ).then(() => setSpeciesForm({ code: '', name: '' }));
          }}
        >
          <Field label="Code" hint={null}>
            <input
              value={speciesForm.code}
              onChange={(event) => setSpeciesForm((f) => ({ ...f, code: event.target.value }))}
              required
            />
          </Field>
          <Field label="Nom" hint={null}>
            <input
              value={speciesForm.name}
              onChange={(event) => setSpeciesForm((f) => ({ ...f, name: event.target.value }))}
              required
            />
          </Field>
          <div style={{ display: 'flex', alignItems: 'end' }}>
            <button type="submit" className="secondaire">
              Ajouter
            </button>
          </div>
        </form>
        <DataTable
          columns={[
            { key: 'code', label: 'Code', numeric: false },
            { key: 'nom', label: 'Nom', numeric: false },
            { key: 'actif', label: 'Actif', numeric: false },
          ]}
          isEmpty={(species.data ?? []).length === 0}
          emptyText="Aucune espèce."
        >
          {(species.data ?? []).map((row) => (
            <tr key={row.id}>
              <td>{row.code}</td>
              <td>{row.name}</td>
              <td>{row.isActive ? 'Oui' : 'Non'}</td>
            </tr>
          ))}
        </DataTable>
      </Card>

      <Card title="Emplacements">
        <form
          className="filtres"
          onSubmit={(event) => {
            event.preventDefault();
            void run(
              () =>
                apiPost('/api/locations', {
                  ...locationForm,
                  canReceive: true,
                  canStore: true,
                }),
              'Emplacement créé.',
              locations.reload,
            );
          }}
        >
          <Field label="Code" hint={null}>
            <input
              value={locationForm.code}
              onChange={(event) => setLocationForm((f) => ({ ...f, code: event.target.value }))}
              required
            />
          </Field>
          <Field label="Nom" hint={null}>
            <input
              value={locationForm.name}
              onChange={(event) => setLocationForm((f) => ({ ...f, name: event.target.value }))}
              required
            />
          </Field>
          <Field label="Type de stock" hint={null}>
            <select
              value={locationForm.stockType}
              onChange={(event) => setLocationForm((f) => ({ ...f, stockType: event.target.value }))}
            >
              <option value="INTERNE">Interne</option>
              <option value="EXTERNE">Externe</option>
            </select>
          </Field>
          <Field label="Nature" hint={null}>
            <select
              value={locationForm.locationType}
              onChange={(event) =>
                setLocationForm((f) => ({ ...f, locationType: event.target.value }))
              }
            >
              <option value="USINE">Usine</option>
              <option value="ENTREPOT">Entrepôt</option>
              <option value="SOUS_TRAITANT">Sous-traitant</option>
              <option value="ZONE_TRANSIT">Zone de transit</option>
              <option value="AUTRE">Autre</option>
            </select>
          </Field>
          <Field label="Domaine de stock" hint="Détermine si l'emplacement peut recevoir du stock PF.">
            <select
              value={locationForm.stockDomain}
              onChange={(event) => setLocationForm((f) => ({ ...f, stockDomain: event.target.value }))}
            >
              <option value="MP">Matières premières</option>
              <option value="PF">Produits finis</option>
              <option value="MIXTE">Mixte</option>
            </select>
          </Field>
          <div style={{ display: 'flex', alignItems: 'end' }}>
            <button type="submit" className="secondaire">
              Ajouter
            </button>
          </div>
        </form>
        <DataTable
          columns={[
            { key: 'code', label: 'Code', numeric: false },
            { key: 'nom', label: 'Nom', numeric: false },
            { key: 'type', label: 'Type de stock', numeric: false },
            { key: 'nature', label: 'Nature', numeric: false },
            { key: 'domaine', label: 'Domaine', numeric: false },
            { key: 'reception', label: 'Réception', numeric: false },
            { key: 'actif', label: 'Actif', numeric: false },
          ]}
          isEmpty={(locations.data ?? []).length === 0}
          emptyText="Aucun emplacement."
        >
          {(locations.data ?? []).map((row) => (
            <tr key={row.id}>
              <td>{row.code}</td>
              <td>{row.name}</td>
              <td>
                <Badge value={row.stockType} />
              </td>
              <td>{label(row.locationType)}</td>
              <td>{label(row.stockDomain)}</td>
              <td>{row.canReceive ? 'Oui' : 'Non'}</td>
              <td>{row.isActive ? 'Oui' : 'Non'}</td>
            </tr>
          ))}
        </DataTable>
      </Card>

      <Card title="Clients">
        <form
          className="filtres"
          onSubmit={(event) => {
            event.preventDefault();
            void run(
              () =>
                apiPost('/api/customers', {
                  code: customerForm.code,
                  name: customerForm.name,
                  country: customerForm.country.trim() === '' ? null : customerForm.country.trim(),
                  city: customerForm.city.trim() === '' ? null : customerForm.city.trim(),
                }),
              'Client créé.',
              customers.reload,
            ).then(() => setCustomerForm({ code: '', name: '', country: '', city: '' }));
          }}
        >
          <Field label="Code" hint={null}>
            <input
              value={customerForm.code}
              onChange={(event) => setCustomerForm((f) => ({ ...f, code: event.target.value }))}
              required
            />
          </Field>
          <Field label="Nom" hint={null}>
            <input
              value={customerForm.name}
              onChange={(event) => setCustomerForm((f) => ({ ...f, name: event.target.value }))}
              required
            />
          </Field>
          <Field label="Pays" hint={null}>
            <input
              value={customerForm.country}
              onChange={(event) => setCustomerForm((f) => ({ ...f, country: event.target.value }))}
            />
          </Field>
          <Field label="Ville" hint={null}>
            <input
              value={customerForm.city}
              onChange={(event) => setCustomerForm((f) => ({ ...f, city: event.target.value }))}
            />
          </Field>
          <div style={{ display: 'flex', alignItems: 'end' }}>
            <button type="submit" className="secondaire">
              Ajouter
            </button>
          </div>
        </form>
        <DataTable
          columns={[
            { key: 'code', label: 'Code', numeric: false },
            { key: 'nom', label: 'Nom', numeric: false },
            { key: 'pays', label: 'Pays', numeric: false },
            { key: 'ville', label: 'Ville', numeric: false },
            { key: 'actif', label: 'Actif', numeric: false },
          ]}
          isEmpty={(customers.data ?? []).length === 0}
          emptyText="Aucun client."
        >
          {(customers.data ?? []).map((row) => (
            <tr key={row.id}>
              <td>{row.code}</td>
              <td>{row.name}</td>
              <td>{row.country ?? '-'}</td>
              <td>{row.city ?? '-'}</td>
              <td>{row.isActive ? 'Oui' : 'Non'}</td>
            </tr>
          ))}
        </DataTable>
      </Card>

      <Card title="Fournisseurs">
        <form
          className="filtres"
          onSubmit={(event) => {
            event.preventDefault();
            void run(
              () =>
                apiPost('/api/suppliers', {
                  code: supplierForm.code,
                  name: supplierForm.name,
                  country: supplierForm.country === '' ? null : supplierForm.country,
                }),
              'Fournisseur créé.',
              suppliers.reload,
            );
          }}
        >
          <Field label="Code" hint={null}>
            <input
              value={supplierForm.code}
              onChange={(event) => setSupplierForm((f) => ({ ...f, code: event.target.value }))}
              required
            />
          </Field>
          <Field label="Nom" hint={null}>
            <input
              value={supplierForm.name}
              onChange={(event) => setSupplierForm((f) => ({ ...f, name: event.target.value }))}
              required
            />
          </Field>
          <Field label="Pays" hint={null}>
            <input
              value={supplierForm.country}
              onChange={(event) => setSupplierForm((f) => ({ ...f, country: event.target.value }))}
            />
          </Field>
          <div style={{ display: 'flex', alignItems: 'end' }}>
            <button type="submit" className="secondaire">
              Ajouter
            </button>
          </div>
        </form>
        <DataTable
          columns={[
            { key: 'code', label: 'Code', numeric: false },
            { key: 'nom', label: 'Nom', numeric: false },
            { key: 'pays', label: 'Pays', numeric: false },
            { key: 'actif', label: 'Actif', numeric: false },
          ]}
          isEmpty={(suppliers.data ?? []).length === 0}
          emptyText="Aucun fournisseur."
        >
          {(suppliers.data ?? []).map((row) => (
            <tr key={row.id}>
              <td>{row.code}</td>
              <td>{row.name}</td>
              <td>{row.country ?? '-'}</td>
              <td>{row.isActive ? 'Oui' : 'Non'}</td>
            </tr>
          ))}
        </DataTable>
      </Card>

      <Card title="Bateaux">
        <form
          className="filtres"
          onSubmit={(event) => {
            event.preventDefault();
            void run(
              () =>
                apiPost('/api/vessels', {
                  code: vesselForm.code,
                  name: vesselForm.name,
                  registration: vesselForm.registration === '' ? null : vesselForm.registration,
                }),
              'Bateau créé.',
              vessels.reload,
            );
          }}
        >
          <Field label="Code" hint={null}>
            <input
              value={vesselForm.code}
              onChange={(event) => setVesselForm((f) => ({ ...f, code: event.target.value }))}
              required
            />
          </Field>
          <Field label="Nom" hint={null}>
            <input
              value={vesselForm.name}
              onChange={(event) => setVesselForm((f) => ({ ...f, name: event.target.value }))}
              required
            />
          </Field>
          <Field label="Immatriculation" hint={null}>
            <input
              value={vesselForm.registration}
              onChange={(event) => setVesselForm((f) => ({ ...f, registration: event.target.value }))}
            />
          </Field>
          <div style={{ display: 'flex', alignItems: 'end' }}>
            <button type="submit" className="secondaire">
              Ajouter
            </button>
          </div>
        </form>
        <DataTable
          columns={[
            { key: 'code', label: 'Code', numeric: false },
            { key: 'nom', label: 'Nom', numeric: false },
            { key: 'immat', label: 'Immatriculation', numeric: false },
            { key: 'actif', label: 'Actif', numeric: false },
          ]}
          isEmpty={(vessels.data ?? []).length === 0}
          emptyText="Aucun bateau."
        >
          {(vessels.data ?? []).map((row) => (
            <tr key={row.id}>
              <td>{row.code}</td>
              <td>{row.name}</td>
              <td>{row.registration ?? '-'}</td>
              <td>{row.isActive ? 'Oui' : 'Non'}</td>
            </tr>
          ))}
        </DataTable>
      </Card>

      <Card title="Sous-traitants">
        <form
          className="filtres"
          onSubmit={(event) => {
            event.preventDefault();
            void run(
              () => apiPost('/api/subcontractors', subcontractorForm),
              'Sous-traitant créé.',
              subcontractors.reload,
            );
          }}
        >
          <Field label="Code" hint={null}>
            <input
              value={subcontractorForm.code}
              onChange={(event) => setSubcontractorForm((f) => ({ ...f, code: event.target.value }))}
              required
            />
          </Field>
          <Field label="Nom" hint={null}>
            <input
              value={subcontractorForm.name}
              onChange={(event) => setSubcontractorForm((f) => ({ ...f, name: event.target.value }))}
              required
            />
          </Field>
          <Field label="Emplacement externe" hint="Obligatoirement un emplacement externe.">
            <select
              value={subcontractorForm.locationId}
              onChange={(event) =>
                setSubcontractorForm((f) => ({ ...f, locationId: event.target.value }))
              }
              required
            >
              <option value="">Sélectionner...</option>
              {(locations.data ?? [])
                .filter((location) => location.stockType === 'EXTERNE')
                .map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
            </select>
          </Field>
          <div style={{ display: 'flex', alignItems: 'end' }}>
            <button type="submit" className="secondaire">
              Ajouter
            </button>
          </div>
        </form>
        <DataTable
          columns={[
            { key: 'code', label: 'Code', numeric: false },
            { key: 'nom', label: 'Nom', numeric: false },
            { key: 'emplacement', label: 'Emplacement', numeric: false },
            { key: 'actif', label: 'Actif', numeric: false },
          ]}
          isEmpty={(subcontractors.data ?? []).length === 0}
          emptyText="Aucun sous-traitant."
        >
          {(subcontractors.data ?? []).map((row) => (
            <tr key={row.id}>
              <td>{row.code}</td>
              <td>{row.name}</td>
              <td>{row.locationCode}</td>
              <td>{row.isActive ? 'Oui' : 'Non'}</td>
            </tr>
          ))}
        </DataTable>
      </Card>

      <Card title="Produits">
        <form
          className="filtres"
          onSubmit={(event) => {
            event.preventDefault();
            void run(
              () =>
                apiPost('/api/products', {
                  code: productForm.code,
                  name: productForm.name,
                  speciesId: productForm.speciesId,
                  productFamily: null,
                  format: productForm.format === '' ? null : productForm.format,
                  piecesPerCan:
                    productForm.piecesPerCan === '' ? null : Number(productForm.piecesPerCan),
                }),
              'Produit créé.',
              products.reload,
            );
          }}
        >
          <Field label="Code" hint={null}>
            <input
              value={productForm.code}
              onChange={(event) => setProductForm((f) => ({ ...f, code: event.target.value }))}
              required
            />
          </Field>
          <Field label="Nom" hint={null}>
            <input
              value={productForm.name}
              onChange={(event) => setProductForm((f) => ({ ...f, name: event.target.value }))}
              required
            />
          </Field>
          <Field label="Espèce" hint="Un produit n'est pas une espèce.">
            <select
              value={productForm.speciesId}
              onChange={(event) => setProductForm((f) => ({ ...f, speciesId: event.target.value }))}
              required
            >
              <option value="">Sélectionner...</option>
              {(species.data ?? []).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Format" hint={null}>
            <input
              value={productForm.format}
              onChange={(event) => setProductForm((f) => ({ ...f, format: event.target.value }))}
            />
          </Field>
          <Field label="Pièces par boîte" hint={null}>
            <input
              value={productForm.piecesPerCan}
              onChange={(event) =>
                setProductForm((f) => ({ ...f, piecesPerCan: event.target.value }))
              }
              inputMode="numeric"
            />
          </Field>
          <div style={{ display: 'flex', alignItems: 'end' }}>
            <button type="submit" className="secondaire">
              Ajouter
            </button>
          </div>
        </form>
        <DataTable
          columns={[
            { key: 'code', label: 'Code', numeric: false },
            { key: 'nom', label: 'Nom', numeric: false },
            { key: 'espece', label: 'Espèce', numeric: false },
            { key: 'format', label: 'Format', numeric: false },
            { key: 'pieces', label: 'Pièces / boîte', numeric: true },
            { key: 'actif', label: 'Actif', numeric: false },
          ]}
          isEmpty={(products.data ?? []).length === 0}
          emptyText="Aucun produit."
        >
          {(products.data ?? []).map((row) => (
            <tr key={row.id}>
              <td>{row.code}</td>
              <td>{row.name}</td>
              <td>{row.speciesCode}</td>
              <td>{row.format ?? '-'}</td>
              <td className="nombre">{row.piecesPerCan ?? '-'}</td>
              <td>{row.isActive ? 'Oui' : 'Non'}</td>
            </tr>
          ))}
        </DataTable>
      </Card>

      <Card title="Lignes de production">
        <form
          className="filtres"
          onSubmit={(event) => {
            event.preventDefault();
            void run(
              () =>
                apiPost('/api/production-lines', {
                  code: lineForm.code,
                  name: lineForm.name,
                  area: lineForm.area === '' ? null : lineForm.area,
                  displayOrder: (productionLines.data ?? []).length + 1,
                }),
              'Ligne créée.',
              productionLines.reload,
            );
          }}
        >
          <Field label="Code" hint={null}>
            <input
              value={lineForm.code}
              onChange={(event) => setLineForm((f) => ({ ...f, code: event.target.value }))}
              required
            />
          </Field>
          <Field label="Nom" hint={null}>
            <input
              value={lineForm.name}
              onChange={(event) => setLineForm((f) => ({ ...f, name: event.target.value }))}
              required
            />
          </Field>
          <Field label="Zone" hint={null}>
            <input
              value={lineForm.area}
              onChange={(event) => setLineForm((f) => ({ ...f, area: event.target.value }))}
            />
          </Field>
          <div style={{ display: 'flex', alignItems: 'end' }}>
            <button type="submit" className="secondaire">
              Ajouter
            </button>
          </div>
        </form>
        <DataTable
          columns={[
            { key: 'code', label: 'Code', numeric: false },
            { key: 'nom', label: 'Nom', numeric: false },
            { key: 'zone', label: 'Zone', numeric: false },
            { key: 'actif', label: 'Active', numeric: false },
          ]}
          isEmpty={(productionLines.data ?? []).length === 0}
          emptyText="Aucune ligne de production."
        >
          {(productionLines.data ?? []).map((row) => (
            <tr key={row.id}>
              <td>{row.code}</td>
              <td>{row.name}</td>
              <td>{row.area ?? '-'}</td>
              <td>{row.isActive ? 'Oui' : 'Non'}</td>
            </tr>
          ))}
        </DataTable>
      </Card>

      <Card title="Motifs de perte et de sous-produit">
        <form
          className="filtres"
          onSubmit={(event) => {
            event.preventDefault();
            void run(
              () => apiPost('/api/production-loss-reasons', reasonForm),
              'Motif créé.',
              lossReasons.reload,
            );
          }}
        >
          <Field label="Code" hint={null}>
            <input
              value={reasonForm.code}
              onChange={(event) => setReasonForm((f) => ({ ...f, code: event.target.value }))}
              required
            />
          </Field>
          <Field label="Nom" hint={null}>
            <input
              value={reasonForm.name}
              onChange={(event) => setReasonForm((f) => ({ ...f, name: event.target.value }))}
              required
            />
          </Field>
          <Field label="Catégorie" hint={null}>
            <select
              value={reasonForm.outputType}
              onChange={(event) => setReasonForm((f) => ({ ...f, outputType: event.target.value }))}
            >
              <option value="PERTE_REELLE">Perte réelle</option>
              <option value="SOUS_PRODUIT">Sous-produit</option>
              <option value="REWORK">Rework</option>
              <option value="RECLASSEMENT">Reclassement</option>
            </select>
          </Field>
          <div style={{ display: 'flex', alignItems: 'end' }}>
            <button type="submit" className="secondaire">
              Ajouter
            </button>
          </div>
        </form>
        <DataTable
          columns={[
            { key: 'code', label: 'Code', numeric: false },
            { key: 'nom', label: 'Nom', numeric: false },
            { key: 'categorie', label: 'Catégorie', numeric: false },
            { key: 'actif', label: 'Actif', numeric: false },
          ]}
          isEmpty={(lossReasons.data ?? []).length === 0}
          emptyText="Aucun motif."
        >
          {(lossReasons.data ?? []).map((row) => (
            <tr key={row.id}>
              <td>{row.code}</td>
              <td>{row.name}</td>
              <td>{label(row.outputType)}</td>
              <td>{row.isActive ? 'Oui' : 'Non'}</td>
            </tr>
          ))}
        </DataTable>
      </Card>

      <Card title="Employées">
        <form
          className="filtres"
          onSubmit={(event) => {
            event.preventDefault();
            void run(
              () => apiPost('/api/employees', employeeForm),
              'Employée créée.',
              employees.reload,
            ).then(() =>
              setEmployeeForm({ employeeNumber: '', firstName: '', lastName: '' }),
            );
          }}
        >
          <Field label="Matricule" hint={null}>
            <input
              value={employeeForm.employeeNumber}
              onChange={(event) =>
                setEmployeeForm((f) => ({ ...f, employeeNumber: event.target.value }))
              }
              required
            />
          </Field>
          <Field label="Prénom" hint={null}>
            <input
              value={employeeForm.firstName}
              onChange={(event) => setEmployeeForm((f) => ({ ...f, firstName: event.target.value }))}
              required
            />
          </Field>
          <Field label="Nom" hint={null}>
            <input
              value={employeeForm.lastName}
              onChange={(event) => setEmployeeForm((f) => ({ ...f, lastName: event.target.value }))}
              required
            />
          </Field>
          <div style={{ display: 'flex', alignItems: 'end' }}>
            <button type="submit" className="secondaire">
              Ajouter
            </button>
          </div>
        </form>
        <DataTable
          columns={[
            { key: 'matricule', label: 'Matricule', numeric: false },
            { key: 'nom', label: 'Nom', numeric: false },
            { key: 'actif', label: 'Active', numeric: false },
          ]}
          isEmpty={(employees.data ?? []).length === 0}
          emptyText="Aucune employée."
        >
          {(employees.data ?? []).map((row) => (
            <tr key={row.id}>
              <td>{row.employeeNumber}</td>
              <td>{row.displayName}</td>
              <td>{row.isActive ? 'Oui' : 'Non'}</td>
            </tr>
          ))}
        </DataTable>
      </Card>

      <Card title="Standards de cadence">
        <p style={{ color: 'var(--texte-doux)', marginTop: 0 }}>
          Le standard le plus spécifique s'applique : produit avant espèce, avant format, avant
          pièces par boîte. Laisser un champ vide pour qu'il s'applique à toutes les valeurs.
        </p>
        <form
          className="filtres"
          onSubmit={(event) => {
            event.preventDefault();
            void run(
              () =>
                apiPost('/api/cadence-standards', {
                  speciesId: standardForm.speciesId === '' ? null : standardForm.speciesId,
                  productId: standardForm.productId === '' ? null : standardForm.productId,
                  activityType: standardForm.activityType,
                  format: standardForm.format === '' ? null : standardForm.format,
                  piecesPerCan:
                    standardForm.piecesPerCan === '' ? null : Number(standardForm.piecesPerCan),
                  measurementUnit: standardForm.measurementUnit,
                  standardCadence: standardForm.standardCadence,
                  validFrom: null,
                  validTo: null,
                }),
              'Standard créé.',
              cadenceStandards.reload,
            );
          }}
        >
          <Field label="Produit" hint={null}>
            <select
              value={standardForm.productId}
              onChange={(event) => setStandardForm((f) => ({ ...f, productId: event.target.value }))}
            >
              <option value="">Tous les produits</option>
              {(products.data ?? []).map((product) => (
                <option key={product.id} value={product.id}>
                  {product.code}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Espèce" hint={null}>
            <select
              value={standardForm.speciesId}
              onChange={(event) => setStandardForm((f) => ({ ...f, speciesId: event.target.value }))}
            >
              <option value="">Toutes les espèces</option>
              {(species.data ?? []).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Activité" hint={null}>
            <select
              value={standardForm.activityType}
              onChange={(event) =>
                setStandardForm((f) => ({ ...f, activityType: event.target.value }))
              }
            >
              <option value="GRATTAGE">Grattage</option>
              <option value="REMPLISSAGE">Remplissage</option>
              <option value="GRATTAGE_REMPLISSAGE">Grattage + remplissage</option>
              <option value="TRAITEMENT">Traitement</option>
              <option value="AUTRE">Autre</option>
            </select>
          </Field>
          <Field label="Unité de mesure" hint={null}>
            <select
              value={standardForm.measurementUnit}
              onChange={(event) =>
                setStandardForm((f) => ({ ...f, measurementUnit: event.target.value }))
              }
            >
              <option value="BOITES">Boîtes</option>
              <option value="PIECES">Pièces</option>
              <option value="KG">Kg</option>
              <option value="UNITES">Unités</option>
            </select>
          </Field>
          <Field label="Cadence standard (par heure)" hint={null}>
            <input
              value={standardForm.standardCadence}
              onChange={(event) =>
                setStandardForm((f) => ({ ...f, standardCadence: event.target.value }))
              }
              inputMode="decimal"
              placeholder="120"
              required
            />
          </Field>
          <div style={{ display: 'flex', alignItems: 'end' }}>
            <button type="submit" className="secondaire">
              Ajouter
            </button>
          </div>
        </form>
        <DataTable
          columns={[
            { key: 'produit', label: 'Produit', numeric: false },
            { key: 'espece', label: 'Espèce', numeric: false },
            { key: 'activite', label: 'Activité', numeric: false },
            { key: 'unite', label: 'Unité', numeric: false },
            { key: 'cadence', label: 'Cadence (par h)', numeric: true },
            { key: 'actif', label: 'Actif', numeric: false },
          ]}
          isEmpty={(cadenceStandards.data ?? []).length === 0}
          emptyText="Aucun standard de cadence."
        >
          {(cadenceStandards.data ?? []).map((row) => (
            <tr key={row.id}>
              <td>{row.productCode ?? '-'}</td>
              <td>{row.speciesCode ?? '-'}</td>
              <td>{label(row.activityType)}</td>
              <td>{label(row.measurementUnit)}</td>
              <td className="nombre">{row.standardCadence}</td>
              <td>{row.isActive ? 'Oui' : 'Non'}</td>
            </tr>
          ))}
        </DataTable>
      </Card>

      <Card title="Catégories d'arrêt">
        <form
          className="filtres"
          onSubmit={(event) => {
            event.preventDefault();
            void run(
              () => apiPost('/api/downtime-categories', downtimeCategoryForm),
              'Catégorie créée.',
              downtimeCategories.reload,
            ).then(() => setDowntimeCategoryForm({ code: '', name: '' }));
          }}
        >
          <Field label="Code" hint={null}>
            <input
              value={downtimeCategoryForm.code}
              onChange={(event) =>
                setDowntimeCategoryForm((f) => ({ ...f, code: event.target.value }))
              }
              required
            />
          </Field>
          <Field label="Nom" hint={null}>
            <input
              value={downtimeCategoryForm.name}
              onChange={(event) =>
                setDowntimeCategoryForm((f) => ({ ...f, name: event.target.value }))
              }
              required
            />
          </Field>
          <div style={{ display: 'flex', alignItems: 'end' }}>
            <button type="submit" className="secondaire">
              Ajouter
            </button>
          </div>
        </form>
        <DataTable
          columns={[
            { key: 'code', label: 'Code', numeric: false },
            { key: 'nom', label: 'Nom', numeric: false },
            { key: 'actif', label: 'Actif', numeric: false },
          ]}
          isEmpty={(downtimeCategories.data ?? []).length === 0}
          emptyText="Aucune catégorie."
        >
          {(downtimeCategories.data ?? []).map((row) => (
            <tr key={row.id}>
              <td>{row.code}</td>
              <td>{row.name}</td>
              <td>{row.isActive ? 'Oui' : 'Non'}</td>
            </tr>
          ))}
        </DataTable>
      </Card>

      <Card title="Équipements">
        <form
          className="filtres"
          onSubmit={(event) => {
            event.preventDefault();
            void run(
              () =>
                apiPost('/api/equipment', {
                  code: equipmentForm.code,
                  name: equipmentForm.name,
                  equipmentType: equipmentForm.equipmentType,
                  locationId: null,
                }),
              'Équipement créé.',
              equipment.reload,
            ).then(() => setEquipmentForm({ code: '', name: '', equipmentType: 'AUTOCLAVE' }));
          }}
        >
          <Field label="Code" hint={null}>
            <input
              value={equipmentForm.code}
              onChange={(event) => setEquipmentForm((f) => ({ ...f, code: event.target.value }))}
              required
            />
          </Field>
          <Field label="Nom" hint={null}>
            <input
              value={equipmentForm.name}
              onChange={(event) => setEquipmentForm((f) => ({ ...f, name: event.target.value }))}
              required
            />
          </Field>
          <Field label="Type" hint={null}>
            <select
              value={equipmentForm.equipmentType}
              onChange={(event) => setEquipmentForm((f) => ({ ...f, equipmentType: event.target.value }))}
            >
              {EQUIPMENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {label(type)}
                </option>
              ))}
            </select>
          </Field>
          <div style={{ display: 'flex', alignItems: 'end' }}>
            <button type="submit" className="secondaire">
              Ajouter
            </button>
          </div>
        </form>
        <DataTable
          columns={[
            { key: 'code', label: 'Code', numeric: false },
            { key: 'nom', label: 'Nom', numeric: false },
            { key: 'type', label: 'Type', numeric: false },
            { key: 'actif', label: 'Actif', numeric: false },
          ]}
          isEmpty={(equipment.data ?? []).length === 0}
          emptyText="Aucun équipement."
        >
          {(equipment.data ?? []).map((row) => (
            <tr key={row.id}>
              <td>{row.code}</td>
              <td>{row.name}</td>
              <td>{label(row.equipmentType)}</td>
              <td>{row.isActive ? 'Oui' : 'Non'}</td>
            </tr>
          ))}
        </DataTable>
      </Card>

      <Card title="Milieux de couverture">
        <form
          className="filtres"
          onSubmit={(event) => {
            event.preventDefault();
            void run(
              () => apiPost('/api/filling-media', fillingMediumForm),
              'Milieu de couverture créé.',
              fillingMedia.reload,
            ).then(() => setFillingMediumForm({ code: '', name: '' }));
          }}
        >
          <Field label="Code" hint={null}>
            <input
              value={fillingMediumForm.code}
              onChange={(event) => setFillingMediumForm((f) => ({ ...f, code: event.target.value }))}
              required
            />
          </Field>
          <Field label="Nom" hint={null}>
            <input
              value={fillingMediumForm.name}
              onChange={(event) => setFillingMediumForm((f) => ({ ...f, name: event.target.value }))}
              required
            />
          </Field>
          <div style={{ display: 'flex', alignItems: 'end' }}>
            <button type="submit" className="secondaire">
              Ajouter
            </button>
          </div>
        </form>
        <DataTable
          columns={[
            { key: 'code', label: 'Code', numeric: false },
            { key: 'nom', label: 'Nom', numeric: false },
            { key: 'actif', label: 'Actif', numeric: false },
          ]}
          isEmpty={(fillingMedia.data ?? []).length === 0}
          emptyText="Aucun milieu de couverture."
        >
          {(fillingMedia.data ?? []).map((row) => (
            <tr key={row.id}>
              <td>{row.code}</td>
              <td>{row.name}</td>
              <td>{row.isActive ? 'Oui' : 'Non'}</td>
            </tr>
          ))}
        </DataTable>
      </Card>

      <Card title="Spécifications de remplissage">
        <p style={{ color: 'var(--texte-doux)', marginTop: 0 }}>
          Poids min/max appliqués aux contrôles poids. Le format le plus spécifique s'applique.
        </p>
        <form
          className="filtres"
          onSubmit={(event) => {
            event.preventDefault();
            void run(
              () =>
                apiPost('/api/filling-specs', {
                  productId: fillingSpecForm.productId,
                  format: fillingSpecForm.format === '' ? null : fillingSpecForm.format,
                  piecesPerCan: null,
                  targetNetWeightG:
                    fillingSpecForm.targetNetWeightG === '' ? null : fillingSpecForm.targetNetWeightG,
                  minWeightG: fillingSpecForm.minWeightG,
                  maxWeightG: fillingSpecForm.maxWeightG,
                  targetFishWeightG: null,
                  targetMediumWeightG: null,
                  validFrom: null,
                  validTo: null,
                }),
              'Spécification créée.',
              fillingSpecs.reload,
            );
          }}
        >
          <Field label="Produit" hint={null}>
            <select
              value={fillingSpecForm.productId}
              onChange={(event) => setFillingSpecForm((f) => ({ ...f, productId: event.target.value }))}
              required
            >
              <option value="">Sélectionner...</option>
              {(products.data ?? []).map((product) => (
                <option key={product.id} value={product.id}>
                  {product.code}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Format" hint="Laisser vide pour tous les formats.">
            <input
              value={fillingSpecForm.format}
              onChange={(event) => setFillingSpecForm((f) => ({ ...f, format: event.target.value }))}
            />
          </Field>
          <Field label="Poids min (g)" hint={null}>
            <input
              value={fillingSpecForm.minWeightG}
              onChange={(event) => setFillingSpecForm((f) => ({ ...f, minWeightG: event.target.value }))}
              inputMode="decimal"
              required
            />
          </Field>
          <Field label="Poids max (g)" hint={null}>
            <input
              value={fillingSpecForm.maxWeightG}
              onChange={(event) => setFillingSpecForm((f) => ({ ...f, maxWeightG: event.target.value }))}
              inputMode="decimal"
              required
            />
          </Field>
          <Field label="Poids net visé (g)" hint="Facultatif.">
            <input
              value={fillingSpecForm.targetNetWeightG}
              onChange={(event) =>
                setFillingSpecForm((f) => ({ ...f, targetNetWeightG: event.target.value }))
              }
              inputMode="decimal"
            />
          </Field>
          <div style={{ display: 'flex', alignItems: 'end' }}>
            <button type="submit" className="secondaire">
              Ajouter
            </button>
          </div>
        </form>
        <DataTable
          columns={[
            { key: 'produit', label: 'Produit', numeric: false },
            { key: 'format', label: 'Format', numeric: false },
            { key: 'min', label: 'Min (g)', numeric: true },
            { key: 'max', label: 'Max (g)', numeric: true },
            { key: 'actif', label: 'Actif', numeric: false },
          ]}
          isEmpty={(fillingSpecs.data ?? []).length === 0}
          emptyText="Aucune spécification."
        >
          {(fillingSpecs.data ?? []).map((row) => (
            <tr key={row.id}>
              <td>{row.productCode}</td>
              <td>{row.format ?? 'Tous'}</td>
              <td className="nombre">{row.minWeightG}</td>
              <td className="nombre">{row.maxWeightG}</td>
              <td>{row.isActive ? 'Oui' : 'Non'}</td>
            </tr>
          ))}
        </DataTable>
      </Card>

      <Card title="Paramètres de sertissage">
        <form
          className="filtres"
          onSubmit={(event) => {
            event.preventDefault();
            void run(
              () => apiPost('/api/seaming-parameters', seamingParameterForm),
              'Paramètre créé.',
              seamingParameters.reload,
            ).then(() => setSeamingParameterForm({ code: '', name: '', defaultUnit: 'MM' }));
          }}
        >
          <Field label="Code" hint={null}>
            <input
              value={seamingParameterForm.code}
              onChange={(event) => setSeamingParameterForm((f) => ({ ...f, code: event.target.value }))}
              required
            />
          </Field>
          <Field label="Nom" hint="Ex : Crochet corps, Épaisseur, Serrage.">
            <input
              value={seamingParameterForm.name}
              onChange={(event) => setSeamingParameterForm((f) => ({ ...f, name: event.target.value }))}
              required
            />
          </Field>
          <Field label="Unité par défaut" hint={null}>
            <input
              value={seamingParameterForm.defaultUnit}
              onChange={(event) =>
                setSeamingParameterForm((f) => ({ ...f, defaultUnit: event.target.value }))
              }
              required
            />
          </Field>
          <div style={{ display: 'flex', alignItems: 'end' }}>
            <button type="submit" className="secondaire">
              Ajouter
            </button>
          </div>
        </form>
        <DataTable
          columns={[
            { key: 'code', label: 'Code', numeric: false },
            { key: 'nom', label: 'Nom', numeric: false },
            { key: 'unite', label: 'Unité', numeric: false },
            { key: 'actif', label: 'Actif', numeric: false },
          ]}
          isEmpty={(seamingParameters.data ?? []).length === 0}
          emptyText="Aucun paramètre."
        >
          {(seamingParameters.data ?? []).map((row) => (
            <tr key={row.id}>
              <td>{row.code}</td>
              <td>{row.name}</td>
              <td>{row.defaultUnit}</td>
              <td>{row.isActive ? 'Oui' : 'Non'}</td>
            </tr>
          ))}
        </DataTable>
      </Card>

      <Card title="Spécifications de sertissage">
        <form
          className="filtres"
          onSubmit={(event) => {
            event.preventDefault();
            void run(
              () =>
                apiPost('/api/seaming-specifications', {
                  seamingParameterId: seamingSpecForm.seamingParameterId,
                  productId: seamingSpecForm.productId === '' ? null : seamingSpecForm.productId,
                  format: null,
                  minValue: seamingSpecForm.minValue === '' ? null : seamingSpecForm.minValue,
                  maxValue: seamingSpecForm.maxValue === '' ? null : seamingSpecForm.maxValue,
                  targetValue: seamingSpecForm.targetValue === '' ? null : seamingSpecForm.targetValue,
                  unit: seamingSpecForm.unit,
                  validFrom: null,
                  validTo: null,
                }),
              'Spécification créée.',
              seamingSpecs.reload,
            );
          }}
        >
          <Field label="Paramètre" hint={null}>
            <select
              value={seamingSpecForm.seamingParameterId}
              onChange={(event) =>
                setSeamingSpecForm((f) => ({ ...f, seamingParameterId: event.target.value }))
              }
              required
            >
              <option value="">Sélectionner...</option>
              {(seamingParameters.data ?? []).map((parameter) => (
                <option key={parameter.id} value={parameter.id}>
                  {parameter.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Produit" hint="Laisser vide pour tous les produits.">
            <select
              value={seamingSpecForm.productId}
              onChange={(event) => setSeamingSpecForm((f) => ({ ...f, productId: event.target.value }))}
            >
              <option value="">Tous les produits</option>
              {(products.data ?? []).map((product) => (
                <option key={product.id} value={product.id}>
                  {product.code}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Min" hint={null}>
            <input
              value={seamingSpecForm.minValue}
              onChange={(event) => setSeamingSpecForm((f) => ({ ...f, minValue: event.target.value }))}
              inputMode="decimal"
            />
          </Field>
          <Field label="Max" hint={null}>
            <input
              value={seamingSpecForm.maxValue}
              onChange={(event) => setSeamingSpecForm((f) => ({ ...f, maxValue: event.target.value }))}
              inputMode="decimal"
            />
          </Field>
          <Field label="Unité" hint={null}>
            <input
              value={seamingSpecForm.unit}
              onChange={(event) => setSeamingSpecForm((f) => ({ ...f, unit: event.target.value }))}
              required
            />
          </Field>
          <div style={{ display: 'flex', alignItems: 'end' }}>
            <button type="submit" className="secondaire">
              Ajouter
            </button>
          </div>
        </form>
        <DataTable
          columns={[
            { key: 'parametre', label: 'Paramètre', numeric: false },
            { key: 'produit', label: 'Produit', numeric: false },
            { key: 'min', label: 'Min', numeric: true },
            { key: 'max', label: 'Max', numeric: true },
            { key: 'unite', label: 'Unité', numeric: false },
            { key: 'actif', label: 'Actif', numeric: false },
          ]}
          isEmpty={(seamingSpecs.data ?? []).length === 0}
          emptyText="Aucune spécification."
        >
          {(seamingSpecs.data ?? []).map((row) => (
            <tr key={row.id}>
              <td>{row.parameterName}</td>
              <td>{row.productCode ?? 'Tous'}</td>
              <td className="nombre">{row.minValue ?? '-'}</td>
              <td className="nombre">{row.maxValue ?? '-'}</td>
              <td>{row.unit}</td>
              <td>{row.isActive ? 'Oui' : 'Non'}</td>
            </tr>
          ))}
        </DataTable>
      </Card>

      <Card title="Programmes de stérilisation">
        <p style={{ color: 'var(--texte-doux)', marginTop: 0 }}>
          Barème validé par OCEAMIC : ces limites ne sont jamais codées en dur dans l'écran de stérilisation.
        </p>
        <form
          className="filtres"
          onSubmit={(event) => {
            event.preventDefault();
            void run(
              () =>
                apiPost('/api/sterilization-programs', {
                  code: sterilizationProgramForm.code,
                  name: sterilizationProgramForm.name,
                  productId:
                    sterilizationProgramForm.productId === '' ? null : sterilizationProgramForm.productId,
                  format: null,
                  targetTemperatureC: null,
                  targetPressureBar: null,
                  targetF0: sterilizationProgramForm.targetF0 === '' ? null : sterilizationProgramForm.targetF0,
                  minimumF0:
                    sterilizationProgramForm.minimumF0 === '' ? null : sterilizationProgramForm.minimumF0,
                  maximumF0:
                    sterilizationProgramForm.maximumF0 === '' ? null : sterilizationProgramForm.maximumF0,
                  holdingTimeSeconds: null,
                  validFrom: null,
                  validTo: null,
                }),
              'Programme créé.',
              sterilizationPrograms.reload,
            );
          }}
        >
          <Field label="Code" hint={null}>
            <input
              value={sterilizationProgramForm.code}
              onChange={(event) =>
                setSterilizationProgramForm((f) => ({ ...f, code: event.target.value }))
              }
              required
            />
          </Field>
          <Field label="Nom" hint={null}>
            <input
              value={sterilizationProgramForm.name}
              onChange={(event) =>
                setSterilizationProgramForm((f) => ({ ...f, name: event.target.value }))
              }
              required
            />
          </Field>
          <Field label="Produit" hint="Laisser vide pour tous les produits.">
            <select
              value={sterilizationProgramForm.productId}
              onChange={(event) =>
                setSterilizationProgramForm((f) => ({ ...f, productId: event.target.value }))
              }
            >
              <option value="">Tous les produits</option>
              {(products.data ?? []).map((product) => (
                <option key={product.id} value={product.id}>
                  {product.code}
                </option>
              ))}
            </select>
          </Field>
          <Field label="F0 minimum" hint={null}>
            <input
              value={sterilizationProgramForm.minimumF0}
              onChange={(event) =>
                setSterilizationProgramForm((f) => ({ ...f, minimumF0: event.target.value }))
              }
              inputMode="decimal"
            />
          </Field>
          <Field label="F0 cible" hint={null}>
            <input
              value={sterilizationProgramForm.targetF0}
              onChange={(event) =>
                setSterilizationProgramForm((f) => ({ ...f, targetF0: event.target.value }))
              }
              inputMode="decimal"
            />
          </Field>
          <Field label="F0 maximum" hint={null}>
            <input
              value={sterilizationProgramForm.maximumF0}
              onChange={(event) =>
                setSterilizationProgramForm((f) => ({ ...f, maximumF0: event.target.value }))
              }
              inputMode="decimal"
            />
          </Field>
          <div style={{ display: 'flex', alignItems: 'end' }}>
            <button type="submit" className="secondaire">
              Ajouter
            </button>
          </div>
        </form>
        <DataTable
          columns={[
            { key: 'code', label: 'Code', numeric: false },
            { key: 'nom', label: 'Nom', numeric: false },
            { key: 'produit', label: 'Produit', numeric: false },
            { key: 'f0min', label: 'F0 min', numeric: true },
            { key: 'f0max', label: 'F0 max', numeric: true },
            { key: 'actif', label: 'Actif', numeric: false },
          ]}
          isEmpty={(sterilizationPrograms.data ?? []).length === 0}
          emptyText="Aucun programme."
        >
          {(sterilizationPrograms.data ?? []).map((row) => (
            <tr key={row.id}>
              <td>{row.code}</td>
              <td>{row.name}</td>
              <td>{row.productCode ?? 'Tous'}</td>
              <td className="nombre">{row.minimumF0 ?? '-'}</td>
              <td className="nombre">{row.maximumF0 ?? '-'}</td>
              <td>{row.isActive ? 'Oui' : 'Non'}</td>
            </tr>
          ))}
        </DataTable>
      </Card>

      <Card title="Points de vérification marquage">
        <form
          className="filtres"
          onSubmit={(event) => {
            event.preventDefault();
            void run(
              () => apiPost('/api/marking-verification-items', markingItemForm),
              'Point de vérification créé.',
              markingItems.reload,
            ).then(() => setMarkingItemForm({ code: '', name: '' }));
          }}
        >
          <Field label="Code" hint={null}>
            <input
              value={markingItemForm.code}
              onChange={(event) => setMarkingItemForm((f) => ({ ...f, code: event.target.value }))}
              required
            />
          </Field>
          <Field label="Nom" hint="Ex : Code lisible, Lot correct.">
            <input
              value={markingItemForm.name}
              onChange={(event) => setMarkingItemForm((f) => ({ ...f, name: event.target.value }))}
              required
            />
          </Field>
          <div style={{ display: 'flex', alignItems: 'end' }}>
            <button type="submit" className="secondaire">
              Ajouter
            </button>
          </div>
        </form>
        <DataTable
          columns={[
            { key: 'code', label: 'Code', numeric: false },
            { key: 'nom', label: 'Nom', numeric: false },
            { key: 'actif', label: 'Actif', numeric: false },
          ]}
          isEmpty={(markingItems.data ?? []).length === 0}
          emptyText="Aucun point de vérification."
        >
          {(markingItems.data ?? []).map((row) => (
            <tr key={row.id}>
              <td>{row.code}</td>
              <td>{row.name}</td>
              <td>{row.isActive ? 'Oui' : 'Non'}</td>
            </tr>
          ))}
        </DataTable>
      </Card>

      <Card title="Catégories de non-conformité">
        <form
          className="filtres"
          onSubmit={(event) => {
            event.preventDefault();
            void run(
              () => apiPost('/api/nonconformity-categories', nonconformityCategoryForm),
              'Catégorie créée.',
              nonconformityCategories.reload,
            ).then(() => setNonconformityCategoryForm({ code: '', name: '' }));
          }}
        >
          <Field label="Code" hint={null}>
            <input
              value={nonconformityCategoryForm.code}
              onChange={(event) => setNonconformityCategoryForm((f) => ({ ...f, code: event.target.value }))}
              required
            />
          </Field>
          <Field label="Nom" hint={null}>
            <input
              value={nonconformityCategoryForm.name}
              onChange={(event) => setNonconformityCategoryForm((f) => ({ ...f, name: event.target.value }))}
              required
            />
          </Field>
          <div style={{ display: 'flex', alignItems: 'end' }}>
            <button type="submit" className="secondaire">
              Ajouter
            </button>
          </div>
        </form>
        <DataTable
          columns={[
            { key: 'code', label: 'Code', numeric: false },
            { key: 'nom', label: 'Nom', numeric: false },
            { key: 'actif', label: 'Actif', numeric: false },
          ]}
          isEmpty={(nonconformityCategories.data ?? []).length === 0}
          emptyText="Aucune catégorie."
        >
          {(nonconformityCategories.data ?? []).map((row) => (
            <tr key={row.id}>
              <td>{row.code}</td>
              <td>{row.name}</td>
              <td>{row.isActive ? 'Oui' : 'Non'}</td>
            </tr>
          ))}
        </DataTable>
      </Card>

      <Card title="Grilles de contrôle d'audit">
        <form
          className="filtres"
          onSubmit={(event) => {
            event.preventDefault();
            void run(
              () => apiPost('/api/audit-checklists', auditChecklistForm),
              'Grille créée.',
              auditChecklists.reload,
            ).then(() => setAuditChecklistForm({ code: '', name: '', auditType: 'INTERNE' }));
          }}
        >
          <Field label="Code" hint={null}>
            <input
              value={auditChecklistForm.code}
              onChange={(event) => setAuditChecklistForm((f) => ({ ...f, code: event.target.value }))}
              required
            />
          </Field>
          <Field label="Nom" hint={null}>
            <input
              value={auditChecklistForm.name}
              onChange={(event) => setAuditChecklistForm((f) => ({ ...f, name: event.target.value }))}
              required
            />
          </Field>
          <Field label="Type d'audit" hint={null}>
            <select
              value={auditChecklistForm.auditType}
              onChange={(event) => setAuditChecklistForm((f) => ({ ...f, auditType: event.target.value }))}
            >
              {AUDIT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {label(type)}
                </option>
              ))}
            </select>
          </Field>
          <div style={{ display: 'flex', alignItems: 'end' }}>
            <button type="submit" className="secondaire">
              Ajouter
            </button>
          </div>
        </form>
        <p style={{ color: 'var(--texte-doux)' }}>
          Les questions de chaque grille se gèrent une fois la grille créée (voir la documentation).
        </p>
        <DataTable
          columns={[
            { key: 'code', label: 'Code', numeric: false },
            { key: 'nom', label: 'Nom', numeric: false },
            { key: 'type', label: "Type d'audit", numeric: false },
            { key: 'actif', label: 'Actif', numeric: false },
          ]}
          isEmpty={(auditChecklists.data ?? []).length === 0}
          emptyText="Aucune grille de contrôle."
        >
          {(auditChecklists.data ?? []).map((row) => (
            <tr key={row.id}>
              <td>{row.code}</td>
              <td>{row.name}</td>
              <td>{label(row.auditType)}</td>
              <td>{row.isActive ? 'Oui' : 'Non'}</td>
            </tr>
          ))}
        </DataTable>
      </Card>

      <Card title="Utilisateurs">
        <DataTable
          columns={[
            { key: 'identifiant', label: 'Identifiant', numeric: false },
            { key: 'nom', label: 'Nom', numeric: false },
            { key: 'role', label: 'Rôle', numeric: false },
            { key: 'actif', label: 'Actif', numeric: false },
          ]}
          isEmpty={(users.data ?? []).length === 0}
          emptyText="Aucun utilisateur."
        >
          {(users.data ?? []).map((row) => (
            <tr key={row.id}>
              <td>{row.username}</td>
              <td>{row.fullName}</td>
              <td>{label(row.role)}</td>
              <td>{row.isActive ? 'Oui' : 'Non'}</td>
            </tr>
          ))}
        </DataTable>
      </Card>
    </>
  );
}
