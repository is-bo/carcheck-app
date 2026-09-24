import { crossAgent } from '../routes';

describe('crossAgent', () => {
  it('builds the entry-point paths other waves own', () => {
    expect(crossAgent.startEntry('r1')).toBe('/rental/r1/start');
    expect(crossAgent.returnEntry('r1')).toBe('/rental/r1/return');
    expect(crossAgent.report('r1')).toBe('/rental/r1/report');
    expect(crossAgent.contractViewer('r1')).toBe('/rental/r1/contract');
    expect(crossAgent.voidContract('r1')).toBe('/rental/r1/void');
  });
});
