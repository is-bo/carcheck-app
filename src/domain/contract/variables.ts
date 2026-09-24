/**
 * Contract variable registry. Templates reference entries as {{key}}. The editor's chip bar,
 * the preview and the renderer all read this list, so adding an entry here is all it takes to
 * offer a new variable.
 */
import type { RentalContext } from './context';
import { damageListHtml, damageSummaryText, signatureHtml, signatureInlineHtml } from './damageList';
import { formatContractDate, formatContractDateTime, formatDistance, formatFuel, joinText } from './format';

export type ContractVariableGroup = 'agency' | 'customer' | 'vehicle' | 'rental' | 'damage' | 'signature';

export const CONTRACT_VARIABLE_GROUPS: readonly { key: ContractVariableGroup; label: string }[] = [
  { key: 'agency', label: 'Agency' },
  { key: 'customer', label: 'Customer' },
  { key: 'vehicle', label: 'Vehicle' },
  { key: 'rental', label: 'Rental' },
  { key: 'damage', label: 'Damage' },
  { key: 'signature', label: 'Signature' },
];

export interface ContractVariable {
  /** "customer.name"; inserted as {{customer.name}}. */
  key: string;
  /** Chip label, e.g. "Customer name". */
  label: string;
  group: ContractVariableGroup;
  /** Example value for help text and chips. */
  sample: string;
  /** Plain-text value (also stored in the signed contract's variables snapshot). Null = empty. */
  resolve(ctx: RentalContext): string | null;
  /**
   * Trusted HTML built with escaping by the registry itself (lists, images). When set and the
   * variable stands alone in a paragraph, it renders as its own block element.
   */
  resolveBlockHtml?(ctx: RentalContext): string;
  /** Trusted HTML used when the variable appears inside a line of text (e.g. the signature image). */
  resolveInlineHtml?(ctx: RentalContext): string;
}

const date = (ms: number | null, ctx: RentalContext) => (ms === null ? null : formatContractDate(ms, ctx.tzOffsetMin));
const dateTime = (ms: number | null, ctx: RentalContext) =>
  ms === null ? null : formatContractDateTime(ms, ctx.tzOffsetMin);

export const CONTRACT_VARIABLES: readonly ContractVariable[] = [
  // Agency
  { key: 'agency.name', label: 'Agency name', group: 'agency', sample: 'Coastline Rentals', resolve: (c) => joinText([c.agency.name]) },
  { key: 'agency.address', label: 'Agency address', group: 'agency', sample: '12 Harbour Road, Portsmouth', resolve: (c) => c.agency.address },
  { key: 'agency.phone', label: 'Agency phone', group: 'agency', sample: '+44 23 9200 0000', resolve: (c) => c.agency.phone },
  { key: 'agency.email', label: 'Agency email', group: 'agency', sample: 'desk@coastline-rentals.example', resolve: (c) => c.agency.email },
  {
    key: 'agency.registration_number',
    label: 'Agency registration no.',
    group: 'agency',
    sample: 'GB 123 4567 89',
    resolve: (c) => c.agency.registrationNumber,
  },

  // Customer
  { key: 'customer.name', label: 'Customer name', group: 'customer', sample: 'Jane Smith', resolve: (c) => joinText([c.customer.fullName]) },
  { key: 'customer.phone', label: 'Customer phone', group: 'customer', sample: '+44 7700 900123', resolve: (c) => c.customer.phone },
  { key: 'customer.address', label: 'Customer address', group: 'customer', sample: '4 Elm Street, Southampton', resolve: (c) => c.customer.address },
  {
    key: 'customer.licence_number',
    label: 'Driving licence no.',
    group: 'customer',
    sample: 'SMITH703154J99',
    resolve: (c) => c.customer.licenceNumber,
  },
  { key: 'customer.id_number', label: 'ID / passport no.', group: 'customer', sample: 'P1234567', resolve: (c) => c.customer.idNumber },

  // Vehicle
  { key: 'vehicle.plate', label: 'Plate', group: 'vehicle', sample: 'AB-123-CD', resolve: (c) => c.vehicle?.plate ?? null },
  {
    key: 'vehicle.make_model',
    label: 'Make and model',
    group: 'vehicle',
    sample: 'Renault Clio',
    resolve: (c) => joinText([c.vehicle?.make, c.vehicle?.model]),
  },
  { key: 'vehicle.make', label: 'Make', group: 'vehicle', sample: 'Renault', resolve: (c) => c.vehicle?.make ?? null },
  { key: 'vehicle.model', label: 'Model', group: 'vehicle', sample: 'Clio', resolve: (c) => c.vehicle?.model ?? null },
  { key: 'vehicle.year', label: 'Year', group: 'vehicle', sample: '2022', resolve: (c) => (c.vehicle?.year ? String(c.vehicle.year) : null) },
  { key: 'vehicle.color', label: 'Colour', group: 'vehicle', sample: 'White', resolve: (c) => c.vehicle?.color ?? null },
  { key: 'vehicle.vin', label: 'VIN', group: 'vehicle', sample: 'VF1RJA00012345678', resolve: (c) => c.vehicle?.vin ?? null },

  // Rental
  { key: 'rental.reference', label: 'Rental reference', group: 'rental', sample: 'R-0142', resolve: (c) => c.rental.reference },
  { key: 'rental.start', label: 'Pick-up date and time', group: 'rental', sample: '12 Mar 2026, 09:14', resolve: (c) => dateTime(c.rental.startedAt, c) },
  { key: 'rental.start_date', label: 'Pick-up date', group: 'rental', sample: '12 Mar 2026', resolve: (c) => date(c.rental.startedAt, c) },
  {
    key: 'rental.expected_return',
    label: 'Expected return',
    group: 'rental',
    sample: '15 Mar 2026, 09:14',
    resolve: (c) => dateTime(c.rental.expectedReturnAt, c),
  },
  {
    key: 'rental.start_mileage',
    label: 'Mileage at pick-up',
    group: 'rental',
    sample: '48 210 km',
    resolve: (c) => (c.rental.startMileage === null ? null : formatDistance(c.rental.startMileage, c.rental.distanceUnit)),
  },
  {
    key: 'rental.fuel',
    label: 'Fuel at pick-up',
    group: 'rental',
    sample: '¾',
    resolve: (c) => (c.rental.startFuelEighths === null ? null : formatFuel(c.rental.startFuelEighths)),
  },
  { key: 'rental.terms', label: 'Special terms', group: 'rental', sample: 'Child seat included.', resolve: (c) => c.rental.specialTerms },

  // Damage
  {
    key: 'damage.existing_list',
    label: 'Existing damage (photos + list)',
    group: 'damage',
    sample: 'A — Scratch, front bumper · Minor',
    resolve: (c) => damageSummaryText(c.existingDamage),
    resolveBlockHtml: (c) => damageListHtml(c.existingDamage),
  },
  {
    key: 'damage.existing_summary',
    label: 'Existing damage (text)',
    group: 'damage',
    sample: 'A — Scratch, front bumper · Minor; B — Dent, rear door',
    resolve: (c) => damageSummaryText(c.existingDamage),
  },
  { key: 'damage.existing_count', label: 'Existing damage count', group: 'damage', sample: '2', resolve: (c) => String(c.existingDamage.length) },

  // Signature
  {
    key: 'signature.customer',
    label: 'Customer signature',
    group: 'signature',
    sample: '(signature)',
    resolve: (c) => joinText([`Signed by ${c.customer.fullName ?? 'the customer'}`]),
    resolveBlockHtml: (c) => signatureHtml(`Signature of ${c.customer.fullName ?? 'the customer'}`),
    resolveInlineHtml: (c) => signatureInlineHtml(`Signature of ${c.customer.fullName ?? 'the customer'}`),
  },
  { key: 'signature.customer_name', label: 'Signer name', group: 'signature', sample: 'Jane Smith', resolve: (c) => joinText([c.customer.fullName]) },
  { key: 'signature.date', label: 'Signing date', group: 'signature', sample: '12 Mar 2026', resolve: (c) => date(c.renderedAt, c) },
  {
    key: 'signature.timestamp',
    label: 'Signing date and time',
    group: 'signature',
    sample: '12 Mar 2026, 09:31',
    resolve: (c) => dateTime(c.renderedAt, c),
  },
];

const BY_KEY = new Map(CONTRACT_VARIABLES.map((v) => [v.key, v]));

export function getContractVariable(key: string): ContractVariable | null {
  return BY_KEY.get(key.trim().toLowerCase()) ?? null;
}

/** Plain-text value of every registered variable: the signed contract's variables snapshot. */
export function resolveAllVariables(ctx: RentalContext): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const v of CONTRACT_VARIABLES) out[v.key] = v.resolve(ctx);
  return out;
}
