import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiPost } from '../api';
import { Card, Field, Message, PageHeader } from '../components/ui';
import { useCustomers } from '../masterdata';

/** Creates a shipment (section 21): customer, destination and optional
 * container info. Pallets are loaded afterwards, on the detail screen. */
export function ExpeditionNouvelle() {
  const navigate = useNavigate();
  const customers = useCustomers();

  const [customerId, setCustomerId] = useState('');
  const [plannedDate, setPlannedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [destination, setDestination] = useState('');
  const [containerNumber, setContainerNumber] = useState('');
  const [sealNumber, setSealNumber] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const shipment = await apiPost<{ id: string }>('/api/shipments', {
        customerId,
        plannedDate,
        destination: destination.trim(),
        containerNumber: containerNumber.trim() === '' ? null : containerNumber.trim(),
        sealNumber: sealNumber.trim() === '' ? null : sealNumber.trim(),
        vehicleRegistration: null,
        targetTemperatureC: null,
        gensetRequired: null,
        notes: null,
      });
      navigate(`/expeditions/${shipment.id}`);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="Nouvelle expédition" subtitle={null} actions={null} />
      <Message kind="erreur" text={error} />

      <Card title={null}>
        <form onSubmit={submit}>
          <div className="grille-champs">
            <Field label="Client" hint={null}>
              <select value={customerId} onChange={(event) => setCustomerId(event.target.value)} required>
                <option value="">Sélectionner...</option>
                {(customers.data ?? []).map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Date prévue" hint={null}>
              <input
                type="date"
                value={plannedDate}
                onChange={(event) => setPlannedDate(event.target.value)}
                required
              />
            </Field>
            <Field label="Destination" hint={null}>
              <input value={destination} onChange={(event) => setDestination(event.target.value)} required />
            </Field>
            <Field label="N° conteneur" hint="Facultatif.">
              <input value={containerNumber} onChange={(event) => setContainerNumber(event.target.value)} />
            </Field>
            <Field label="N° scellé" hint="Facultatif.">
              <input value={sealNumber} onChange={(event) => setSealNumber(event.target.value)} />
            </Field>
          </div>
          <div className="ligne-boutons">
            <button type="submit" disabled={busy || !customerId || destination.trim() === ''}>
              Créer l'expédition
            </button>
          </div>
        </form>
      </Card>
    </>
  );
}
