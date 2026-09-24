import { agencyMonogram, firstName, signingRecap, thankYouTitle, vehicleLine } from '../handOff';

const car = { plate: '12-BN-88', make: 'Peugeot', model: '208', year: null, color: null, vin: null };

describe('handOff copy', () => {
  it('uses the first name only', () => {
    expect(firstName('Tomás Ferreira')).toBe('Tomás');
    expect(firstName('  ')).toBeNull();
    expect(thankYouTitle('Jane Smith')).toBe('Thank you, Jane. You’re all set.');
    expect(thankYouTitle(null)).toBe('Thank you. You’re all set.');
  });

  it('recaps what is being signed', () => {
    expect(signingRecap(car, 3)).toBe(
      'You are signing the rental agreement for the Peugeot 208, 12-BN-88, including 3 existing damages.',
    );
    expect(signingRecap(car, 1)).toContain('including 1 existing damage.');
    expect(signingRecap({ ...car, make: null, model: null }, 0)).toBe(
      'You are signing the rental agreement for the 12-BN-88. No existing damage was recorded.',
    );
    expect(vehicleLine(null)).toBe('the vehicle');
  });

  it('draws a monogram when there is no logo', () => {
    expect(agencyMonogram('atlântico rent')).toBe('A');
    expect(agencyMonogram('')).toBe('·');
  });
});
