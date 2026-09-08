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

export type Product = Readonly<{
  id: string;
  code: string;
  name: string;
  speciesId: string;
  speciesCode: string;
  productFamily: string | null;
  format: string | null;
  piecesPerCan: number | null;
  isActive: boolean;
}>;

export type ProductionLine = Readonly<{
  id: string;
  code: string;
  name: string;
  area: string | null;
  displayOrder: number;
  isActive: boolean;
}>;

export type ProductionStage = Readonly<{
  id: string;
  code: string;
  name: string;
  displayOrder: number;
  isActive: boolean;
}>;

export type LossReason = Readonly<{
  id: string;
  code: string;
  name: string;
  outputType: string;
  isActive: boolean;
}>;

export function useProducts() {
  return useResource<readonly Product[]>('/api/products');
}
export function useProductionLines() {
  return useResource<readonly ProductionLine[]>('/api/production-lines');
}
export function useProductionStages() {
  return useResource<readonly ProductionStage[]>('/api/production-stages');
}
export function useLossReasons() {
  return useResource<readonly LossReason[]>('/api/production-loss-reasons');
}
