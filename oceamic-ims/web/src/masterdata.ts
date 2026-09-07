import { useResource } from './hooks';

export type Species = Readonly<{ id: string; code: string; name: string; isActive: boolean }>;
export type Supplier = Readonly<{ id: string; code: string; name: string; country: string | null; isActive: boolean }>;
export type Vessel = Readonly<{ id: string; code: string; name: string; registration: string | null; isActive: boolean }>;
export type Location = Readonly<{
  id: string;
  code: string;
  name: string;
  stockType: 'INTERNE' | 'EXTERNE';
  locationType: string;
  canReceive: boolean;
  canStore: boolean;
  isActive: boolean;
}>;
export type Subcontractor = Readonly<{
  id: string;
  code: string;
  name: string;
  locationId: string;
  locationCode: string;
  isActive: boolean;
}>;

export function useSpecies() {
  return useResource<readonly Species[]>('/api/species');
}
export function useSuppliers() {
  return useResource<readonly Supplier[]>('/api/suppliers');
}
export function useVessels() {
  return useResource<readonly Vessel[]>('/api/vessels');
}
export function useLocations() {
  return useResource<readonly Location[]>('/api/locations');
}
export function useSubcontractors() {
  return useResource<readonly Subcontractor[]>('/api/subcontractors');
}

export type LotOption = Readonly<{
  id: string;
  lotCode: string;
  speciesCode: string;
  status: string;
  stockKg: string;
  isBlocked: boolean;
}>;

export function useLots(query: string) {
  return useResource<readonly LotOption[]>(`/api/lots${query}`);
}
