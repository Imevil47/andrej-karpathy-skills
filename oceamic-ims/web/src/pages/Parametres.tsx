import { useState } from 'react';
import { apiPost } from '../api';
import { Badge, Card, DataTable, Field, Message, PageHeader } from '../components/ui';
import { label } from '../format';
import { useLocations, useSpecies, useSubcontractors, useSuppliers, useVessels } from '../masterdata';
import { useResource } from '../hooks';

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
  });
  const [subcontractorForm, setSubcontractorForm] = useState({
    code: '',
    name: '',
    locationId: '',
  });

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
              <td>{row.canReceive ? 'Oui' : 'Non'}</td>
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
