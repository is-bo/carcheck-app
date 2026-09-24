/**
 * Repository API. Every function is async, uses the live connection (initializeData() first)
 * and returns plain objects from '@/domain/types'. Writes emit a data-change event after commit
 * (subscribeDataChanges) and throw typed errors from '@/data/errors'.
 */
export {
  allocateRentalReference,
  getAgencySettings,
  getPref,
  isAgencyConfigured,
  listAngles,
  normalizeRefPrefix,
  setAgencyLogo,
  setPref,
  updateAgencySettings,
  type AgencySettingsPatch,
  type PrefKey,
} from './settings';

export {
  archiveVehicle,
  createVehicle,
  findVehiclesByPlate,
  getVehicle,
  getVehicleDetail,
  listVehicles,
  plateKey,
  removeVehicle,
  setVehiclePhoto,
  unarchiveVehicle,
  updateVehicle,
  type VehicleInput,
  type VehiclePatch,
} from './vehicles';

export {
  addCustomerDocument,
  archiveCustomer,
  createCustomer,
  deleteCustomerDocuments,
  getCustomer,
  getCustomerDetail,
  listCustomerDocuments,
  listCustomers,
  removeCustomer,
  unarchiveCustomer,
  updateCustomer,
  type CustomerInput,
  type CustomerPatch,
} from './customers';

export {
  cancelRental,
  completeReturn,
  createDraftRental,
  discardDraft,
  getHome,
  getRental,
  getRentalDetail,
  getRentalFacts,
  getRentalItem,
  listRentals,
  pickRentalCustomer,
  reopenReturn,
  searchRentals,
  setRentalCustomer,
  setRentalVehicle,
  setResumeStep,
  startReturn,
  updateRentalDetails,
  updateReturnDetails,
  type RentalCustomerInput,
  type RentalDetailsPatch,
  type RentalFilter,
  type ReturnDetailsPatch,
} from './rentals';

export {
  addPhoto,
  confirmMarksChecked,
  deletePhoto,
  getAnglePairs,
  getInspection,
  getPhoto,
  listInspectionAngles,
  listPhotos,
  markPairReviewed,
  nextFreeSlot,
  retakePhoto,
  setAngleSkipped,
  setPairAlignment,
  startInspection,
  type AddPhotoInput,
} from './inspections';

export {
  addDamage,
  confirmKnownDamage,
  deleteDamage,
  getDamage,
  listDamage,
  listKnownDamage,
  listKnownDamageForRental,
  resolveKnownDamage,
  updateDamage,
  type DamagePatch,
  type NewDamageInput,
} from './damage';

export {
  buildContractContext,
  deviceTzOffsetMin,
  getActiveTemplate,
  getContract,
  getTemplate,
  getValidContract,
  listContracts,
  listTemplateVersions,
  prepareContract,
  resetTemplateToDefault,
  saveTemplateVersion,
  signContract,
  verifyContract,
  voidContract,
  type ContextOptions,
  type ContractPreparation,
  type ContractVerification,
  type SignContractInput,
} from './contracts';

export {
  deleteArtifact,
  getArtifact,
  getArtifactStatus,
  listArtifacts,
  saveArtifact,
  type ArtifactFile,
  type ArtifactMeta,
  type ArtifactMimeType,
  type ArtifactStatus,
} from './artifacts';

export {
  getLastBackupAt,
  getRecordCounts,
  getStorageUsage,
  listBackupLog,
  listFileRefs,
  recordBackupLog,
  type StorageUsage,
} from './storage';

export {
  ConflictError,
  DataError,
  DataNotReadyError,
  ImmutableError,
  InvalidStateError,
  LockedError,
  NotFoundError,
  ValidationError,
  type ConflictReason,
  type DataErrorCode,
} from '../errors';
export { affects, subscribeDataChanges, type DataChangeEvent, type DataEntity } from '../events';
