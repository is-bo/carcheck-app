/**
 * Default contract template, seeded into contract_template on first boot and restored by
 * "Reset to default". Starter text only: it is NOT legal advice and agencies must have it
 * checked for their country before use (the editor shows STARTER_TEMPLATE_NOTICE).
 */

export const STARTER_TEMPLATE_KEY = 'default';

export const STARTER_TEMPLATE_TITLE = 'Vehicle condition agreement';

export const STARTER_TEMPLATE_NOTICE =
  'Starter template — not legal advice. Have it checked for your country before using it with customers.';

export const STARTER_TEMPLATE_BODY = `# Vehicle condition agreement

**{{agency.name}}**
{{agency.address}}
Phone: {{agency.phone}}
Email: {{agency.email}}

Rental reference: **{{rental.reference}}**

## Customer
**{{customer.name}}**
Phone: {{customer.phone}}
Address: {{customer.address}}
Driving licence no.: {{customer.licence_number}}
ID / passport no.: {{customer.id_number}}

## Vehicle
**{{vehicle.make_model}}**, plate **{{vehicle.plate}}**
Colour: {{vehicle.color}}
Year: {{vehicle.year}}
VIN: {{vehicle.vin}}

## Rental
Pick-up: {{rental.start}}
Expected return: {{rental.expected_return}}
Mileage at pick-up: {{rental.start_mileage}}
Fuel at pick-up: {{rental.fuel}}

## Condition at pick-up
The vehicle was inspected and photographed with the customer before handover. Damage that was already present is listed below and marked with letters on the photos.

{{damage.existing_list}}

## Customer responsibilities
- Return the vehicle by the agreed date, in the same condition as at pick-up apart from normal wear.
- Report any accident, damage, theft or warning light to {{agency.name}} as soon as possible.
- The vehicle will be photographed again at return and compared with the pick-up photos.
- Damage found at return that is not listed above may be charged according to the rental terms.

## Special terms
{{rental.terms}}

## Signature
By signing, the customer confirms that they have checked the vehicle and the photos, and that the condition described above is accurate.

{{signature.customer}}

**{{signature.customer_name}}**
Signed on {{signature.date}}
`;

/** True while the agency still uses the unmodified starter text (the review screen can remind them). */
export function isStarterTemplate(body: string): boolean {
  return body.replace(/\r\n?/g, '\n').trim() === STARTER_TEMPLATE_BODY.trim();
}
