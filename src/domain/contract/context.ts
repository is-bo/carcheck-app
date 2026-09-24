/**
 * Everything a contract template can print, gathered from one rental. The contracts repository
 * builds it from the DB (buildContractContext); the template editor previews with the sample.
 */
import type { Ring } from '../../media/geometry';
import type {
  CustomerSnapshot,
  DamageSeverity,
  DamageType,
  DistanceUnit,
  EpochMs,
  FuelEighths,
  Id,
  VehicleSnapshot,
} from '../types';

/** One pre-existing damage marked at pick-up, as shown in the contract. */
export interface ContractDamageItem {
  /** Badge letter ("A"). */
  label: string;
  type: DamageType | null;
  severity: DamageSeverity | null;
  locationLabel: string | null;
  note: string | null;
  angleLabel: string;
  /** The BEFORE photo the ring is on; referenced as `carcheck-photo:<photoId>`. */
  photoId: Id;
  photoWidth: number;
  photoHeight: number;
  ring: Ring;
}

export interface RentalContext {
  agency: {
    name: string;
    address: string | null;
    phone: string | null;
    email: string | null;
    registrationNumber: string | null;
  };
  rental: {
    reference: string | null;
    startedAt: EpochMs | null;
    expectedReturnAt: EpochMs | null;
    startMileage: number | null;
    startFuelEighths: FuelEighths | null;
    specialTerms: string | null;
    distanceUnit: DistanceUnit;
  };
  customer: CustomerSnapshot;
  vehicle: VehicleSnapshot | null;
  /** Pick-up marks with status pre_existing, in letter order. */
  existingDamage: ContractDamageItem[];
  /** Moment of rendering (review) or signing; prints as the signature date. */
  renderedAt: EpochMs;
  /** Minutes east of UTC used for every printed time. */
  tzOffsetMin: number;
}

/** Realistic data for the template editor's Preview (UX §7: includes 2 sample damages). */
export function sampleRentalContext(renderedAt: EpochMs = Date.UTC(2026, 2, 12, 8, 14), tzOffsetMin = 60): RentalContext {
  return {
    agency: {
      name: 'Coastline Rentals',
      address: '12 Harbour Road, Portsmouth',
      phone: '+44 23 9200 0000',
      email: 'desk@coastline-rentals.example',
      registrationNumber: 'GB 123 4567 89',
    },
    rental: {
      reference: 'R-0142',
      startedAt: renderedAt,
      expectedReturnAt: renderedAt + 3 * 24 * 60 * 60 * 1000,
      startMileage: 48210,
      startFuelEighths: 6,
      specialTerms: 'Child seat included.',
      distanceUnit: 'km',
    },
    customer: {
      fullName: 'Jane Smith',
      phone: '+44 7700 900123',
      address: '4 Elm Street, Southampton',
      licenceNumber: 'SMITH703154J99',
      idNumber: 'P1234567',
      notes: null,
    },
    vehicle: { plate: 'AB-123-CD', make: 'Renault', model: 'Clio', year: 2022, color: 'White', vin: null },
    existingDamage: [
      {
        label: 'A',
        type: 'scratch',
        severity: 'minor',
        locationLabel: 'front bumper, left corner',
        note: null,
        angleLabel: 'Front left',
        photoId: 'sample-front-left',
        photoWidth: 4032,
        photoHeight: 3024,
        ring: { x: 0.32, y: 0.62, r: 0.06 },
      },
      {
        label: 'B',
        type: 'dent',
        severity: 'moderate',
        locationLabel: 'rear door',
        note: 'Small dent below the handle',
        angleLabel: 'Right side',
        photoId: 'sample-right',
        photoWidth: 4032,
        photoHeight: 3024,
        ring: { x: 0.58, y: 0.48, r: 0.05 },
      },
    ],
    renderedAt,
    tzOffsetMin,
  };
}
