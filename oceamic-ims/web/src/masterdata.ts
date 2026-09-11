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
  stockDomain: 'MP' | 'PF' | 'MIXTE' | 'INGREDIENT';
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

// --- Phase 3: workforce cadence ---------------------------------------------

export type Employee = Readonly<{
  id: string;
  employeeNumber: string;
  firstName: string;
  lastName: string;
  displayName: string;
  department: string | null;
  isActive: boolean;
}>;

export type DowntimeCategory = Readonly<{ id: string; code: string; name: string; isActive: boolean }>;

export type CadenceStandard = Readonly<{
  id: string;
  speciesId: string | null;
  speciesCode: string | null;
  productId: string | null;
  productCode: string | null;
  activityType: string;
  sizeGrade: string | null;
  format: string | null;
  piecesPerCan: number | null;
  measurementUnit: string;
  standardCadence: string;
  validFrom: string | null;
  validTo: string | null;
  isActive: boolean;
}>;

export function useEmployees() {
  return useResource<readonly Employee[]>('/api/employees');
}
export function useDowntimeCategories() {
  return useResource<readonly DowntimeCategory[]>('/api/downtime-categories');
}
export function useCadenceStandards() {
  return useResource<readonly CadenceStandard[]>('/api/cadence-standards');
}

// --- Phase 4: filling, seaming, marking, sterilization -----------------------

export type Equipment = Readonly<{
  id: string;
  code: string;
  name: string;
  equipmentType: string;
  locationId: string | null;
  locationCode: string | null;
  isActive: boolean;
  // Phase 7 (section 8): asset identity, hierarchy, criticality and status.
  manufacturer: string | null;
  model: string | null;
  serialNumber: string | null;
  productionLineId: string | null;
  productionLineCode: string | null;
  parentEquipmentId: string | null;
  parentEquipmentCode: string | null;
  criticality: string;
  commissionedAt: string | null;
  status: string;
}>;

export type FillingMedium = Readonly<{ id: string; code: string; name: string; isActive: boolean }>;

export type FillingSpec = Readonly<{
  id: string;
  productId: string;
  productCode: string;
  format: string | null;
  piecesPerCan: number | null;
  targetNetWeightG: string | null;
  minWeightG: string;
  maxWeightG: string;
  targetFishWeightG: string | null;
  targetMediumWeightG: string | null;
  validFrom: string | null;
  validTo: string | null;
  isActive: boolean;
}>;

export type SeamingParameter = Readonly<{
  id: string;
  code: string;
  name: string;
  defaultUnit: string;
  isActive: boolean;
}>;

export type SeamingSpec = Readonly<{
  id: string;
  seamingParameterId: string;
  parameterName: string;
  productId: string | null;
  productCode: string | null;
  format: string | null;
  minValue: string | null;
  maxValue: string | null;
  targetValue: string | null;
  unit: string;
  validFrom: string | null;
  validTo: string | null;
  isActive: boolean;
}>;

export type SterilizationProgram = Readonly<{
  id: string;
  code: string;
  name: string;
  productId: string | null;
  productCode: string | null;
  format: string | null;
  targetTemperatureC: string | null;
  targetPressureBar: string | null;
  targetF0: string | null;
  minimumF0: string | null;
  maximumF0: string | null;
  holdingTimeSeconds: number | null;
  validFrom: string | null;
  validTo: string | null;
  isActive: boolean;
}>;

export type MarkingVerificationItem = Readonly<{ id: string; code: string; name: string; isActive: boolean }>;

export function useEquipment(equipmentType?: string) {
  return useResource<readonly Equipment[]>(
    equipmentType ? `/api/equipment?type=${equipmentType}` : '/api/equipment',
  );
}
export function useFillingMedia() {
  return useResource<readonly FillingMedium[]>('/api/filling-media');
}
export function useFillingSpecs() {
  return useResource<readonly FillingSpec[]>('/api/filling-specs');
}
export function useSeamingParameters() {
  return useResource<readonly SeamingParameter[]>('/api/seaming-parameters');
}
export function useSeamingSpecs() {
  return useResource<readonly SeamingSpec[]>('/api/seaming-specifications');
}
export function useSterilizationPrograms() {
  return useResource<readonly SterilizationProgram[]>('/api/sterilization-programs');
}
export function useMarkingVerificationItems() {
  return useResource<readonly MarkingVerificationItem[]>('/api/marking-verification-items');
}

// --- Phase 5: packaging, finished goods, pallets, PF stock, shipments -------

export type Customer = Readonly<{
  id: string;
  code: string;
  name: string;
  country: string | null;
  city: string | null;
  isActive: boolean;
}>;

export function useCustomers() {
  return useResource<readonly Customer[]>('/api/customers');
}

export type UserOption = Readonly<{ id: string; fullName: string; role: string }>;

export function useUsers() {
  return useResource<readonly UserOption[]>('/api/qms/users');
}

// --- Phase 6: horizontal QMS -------------------------------------------------

export type NonconformityCategory = Readonly<{ id: string; code: string; name: string; isActive: boolean }>;

export type AuditChecklist = Readonly<{
  id: string;
  code: string;
  name: string;
  auditType: string;
  isActive: boolean;
}>;

export type AuditChecklistItem = Readonly<{
  id: string;
  auditChecklistId: string;
  displayOrder: number;
  question: string;
  expectedReference: string | null;
  isActive: boolean;
}>;

export function useNonconformityCategories() {
  return useResource<readonly NonconformityCategory[]>('/api/nonconformity-categories');
}
export function useAuditChecklists() {
  return useResource<readonly AuditChecklist[]>('/api/audit-checklists');
}
export function useAuditChecklistItems(auditChecklistId: string | null) {
  return useResource<readonly AuditChecklistItem[]>(`/api/audit-checklists/${auditChecklistId ?? 'aucun'}/items`);
}

// --- Phase 7: maintenance / CMMS --------------------------------------------

export function useMaintenanceUsers() {
  return useResource<readonly UserOption[]>('/api/maintenance/users');
}

export type FailureModeOrCause = Readonly<{ id: string; code: string; name: string }>;

export function useFailureModes() {
  return useResource<readonly FailureModeOrCause[]>('/api/failure-modes');
}
export function useFailureCauses() {
  return useResource<readonly FailureModeOrCause[]>('/api/failure-causes');
}

export type SparePartOption = Readonly<{
  id: string;
  partCode: string;
  name: string;
  unit: string;
  minimumStock: string;
  currentStock: string;
  belowMinimum: boolean;
  locationCode: string | null;
  isActive: boolean;
}>;

export function useSpareParts(belowMinimumOnly = false) {
  return useResource<readonly SparePartOption[]>(`/api/spare-parts${belowMinimumOnly ? '?sousMinimum=true' : ''}`);
}

// --- Phase 8: ingredients, consumables, oil tracking, consumption, recovery -

export type IngredientType = Readonly<{ id: string; code: string; name: string; isActive: boolean }>;

export type IngredientOption = Readonly<{
  id: string;
  ingredientCode: string;
  name: string;
  ingredientTypeId: string;
  ingredientTypeName: string;
  defaultUnit: string;
  fillingMediumId: string | null;
  fillingMediumCode: string | null;
  requiresLotTraceability: boolean;
  isRecoverable: boolean;
  isActive: boolean;
}>;

export type IngredientTankOption = Readonly<{
  id: string;
  tankCode: string;
  name: string;
  ingredientTypeId: string | null;
  ingredientTypeName: string | null;
  capacityLiters: string | null;
  locationId: string | null;
  locationCode: string | null;
  isActive: boolean;
}>;

export type IngredientLossReason = Readonly<{ id: string; code: string; name: string }>;

export type IngredientContainer = Readonly<{ id: string; containerCode: string; containerType: string; capacity: string | null }>;

export function useIngredientTypes() {
  return useResource<readonly IngredientType[]>('/api/ingredient-types');
}
export function useIngredients() {
  return useResource<readonly IngredientOption[]>('/api/ingredients');
}
export function useIngredientTanks() {
  return useResource<readonly IngredientTankOption[]>('/api/ingredient-tanks');
}
export function useIngredientLossReasons() {
  return useResource<readonly IngredientLossReason[]>('/api/ingredient-loss-reasons');
}
export function useIngredientContainers() {
  return useResource<readonly IngredientContainer[]>('/api/ingredient-containers');
}
