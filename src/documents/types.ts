/**
 * Inputs of the document builders. Plain objects derived from the domain types: callers read
 * the DB, resolve images to data URIs (see pdf.ts), then hand these to the pure HTML builders.
 *
 * Images are always embedded as base64 data URIs (expo-print's Android WebView cannot reliably
 * read file:// URLs). Timestamps are epoch ms paired with a UTC offset in minutes east of UTC.
 */
import type {
  AgencySettings,
  Damage,
  EpochMs,
  Id,
  PairKey,
  Rental,
  SignedContractWithState,
  SkipReason,
} from '@/domain/types';

/** "data:image/jpeg;base64,…" (or png). Anything else is ignored by the builders. */
export type DataUri = string;

export interface DocAgency
  extends Pick<AgencySettings, 'name' | 'address' | 'phone' | 'email' | 'registrationNumber' | 'reportFooter'> {
  /** Downscaled logo (≈600 px), or null to print the name only. */
  logo: DataUri | null;
}

/** The rental snapshot as printed. `reference` is always set once a contract exists. */
export type DocRental = Pick<
  Rental,
  | 'reference'
  | 'customer'
  | 'vehicle'
  | 'distanceUnit'
  | 'startedAt'
  | 'expectedReturnAt'
  | 'startMileage'
  | 'startFuelEighths'
  | 'returnedAt'
  | 'returnMileage'
  | 'returnFuelEighths'
  | 'returnNotes'
  | 'returnRevision'
>;

export interface DocDamage
  extends Pick<
    Damage,
    'id' | 'status' | 'number' | 'type' | 'severity' | 'locationLabel' | 'note' | 'foundPhase' | 'angleKey' | 'slot'
  > {
  /** Catalog label of the angle, e.g. "Rear left" or "Close-up 2". */
  angleLabel: string;
  /** Optional close-up photo, downscaled (≈800 px). */
  closeup: DataUri | null;
}

/** The composed BEFORE/AFTER evidence image of one damaged angle (never the raw photos). */
export interface DocEvidenceImage extends PairKey {
  angleLabel: string;
  image: DataUri;
  /** Pixel size of the embedded image; drives the printed size. */
  width: number;
  height: number;
  /** Damages drawn on this image; captions are printed in evidence order (new, uncertain, existing). */
  damageIds: Id[];
}

/** One tile of a condition contact sheet. */
export interface DocPhotoThumb extends PairKey {
  angleLabel: string;
  /** Downscaled photo (≈800 px); null when the angle was skipped or the file is missing. */
  image: DataUri | null;
  capturedAt: EpochMs | null;
  tzOffsetMin: number | null;
  skipReason: SkipReason | null;
}

/** A signed contract exactly as frozen at signing, plus its void record if any. */
export type FrozenContract = Pick<
  SignedContractWithState,
  | 'id'
  | 'rentalId'
  | 'sequence'
  | 'templateVersion'
  | 'renderedHtml'
  | 'signerName'
  | 'signedAt'
  | 'tzOffsetMin'
  | 'contentSha256'
  | 'void'
>;

/** Resolved `carcheck-photo:` / `carcheck-signature:` tokens -> data URI (null = file unavailable). */
export type ContractAssets = Record<string, DataUri | null>;

export interface ResolvedContract {
  contract: FrozenContract;
  assets: ContractAssets;
}

/** Standalone signed-contract PDF. */
export interface ContractDocInput extends FrozenContract {
  reference: string;
  agencyName: string;
}

export interface DocumentOptions {
  /** Embed Barlow as base64 @font-face (default true). Off only for tests and previews. */
  embedFonts?: boolean;
}

export interface DamageReportInput {
  agency: DocAgency;
  rental: DocRental;
  /** Every damage observation of the rental: pick-up (existing) and return marks. */
  damages: DocDamage[];
  /** One per damaged angle, in walk-around order. */
  evidence: DocEvidenceImage[];
  /** AFTER photos of every angle (skipped angles included), in walk-around order. */
  returnPhotos: DocPhotoThumb[];
  /** Every signed contract of the rental, oldest first; voided ones need only their signature asset. */
  contracts: ResolvedContract[];
  generatedAt: EpochMs;
  /** Device offset when the report is generated; used for rental-level dates. */
  tzOffsetMin: number;
}

export interface EvidencePackInput {
  agency: DocAgency;
  rental: Pick<DocRental, 'reference' | 'customer' | 'vehicle' | 'returnedAt'>;
  damages: DocDamage[];
  evidence: DocEvidenceImage[];
  generatedAt: EpochMs;
  tzOffsetMin: number;
}
