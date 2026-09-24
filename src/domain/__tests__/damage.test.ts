import { compactSequence, damageCaption, damageLabel, damageLetter, nextSequenceNumber } from '../damage';

describe('damage labels', () => {
  it('letters pre-existing damage like spreadsheet columns', () => {
    expect([1, 2, 26, 27, 28, 52, 53, 702, 703].map(damageLetter)).toEqual(['A', 'B', 'Z', 'AA', 'AB', 'AZ', 'BA', 'ZZ', 'AAA']);
    expect(() => damageLetter(0)).toThrow();
  });

  it('labels by status: letters for existing, numbers for new and uncertain', () => {
    expect(damageLabel({ status: 'pre_existing', number: 3 })).toBe('C');
    expect(damageLabel({ status: 'new', number: 3 })).toBe('3');
    expect(damageCaption({ status: 'uncertain', number: 2 })).toBe('Uncertain 2');
    expect(damageCaption({ status: 'pre_existing', number: 1 })).toBe('Existing A');
  });
});

describe('sequence compaction', () => {
  it('closes gaps among editable rows and never moves locked rows', () => {
    expect(
      compactSequence([
        { id: 'a', number: 1, locked: true },
        { id: 'b', number: 2, locked: true },
        { id: 'd', number: 4, locked: false },
        { id: 'f', number: 6, locked: false },
      ]),
    ).toEqual([
      { id: 'd', number: 3 },
      { id: 'f', number: 4 },
    ]);
    // An editable gap before a locked row is filled only up to it.
    expect(
      compactSequence([
        { id: 'x', number: 2, locked: false },
        { id: 'y', number: 3, locked: true },
        { id: 'z', number: 5, locked: false },
      ]),
    ).toEqual([
      { id: 'x', number: 1 },
      { id: 'z', number: 4 },
    ]);
    expect(nextSequenceNumber([])).toBe(1);
    expect(nextSequenceNumber([1, 4, 2])).toBe(5);
  });
});
