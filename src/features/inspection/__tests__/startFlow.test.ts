import { resumeStepFor, routeForResume, routeForStep, startHref, stepNumber } from '../startFlow';

describe('startFlow', () => {
  it('numbers the five steps', () => {
    expect(stepNumber('vehicle')).toBe(1);
    expect(stepNumber('customer')).toBe(2);
    expect(stepNumber('capture')).toBe(3);
    expect(stepNumber('condition')).toBe(3);
    expect(stepNumber('details')).toBe(4);
    expect(stepNumber('contract')).toBe(5);
    expect(stepNumber('sign')).toBe(5);
  });

  it('resumes an unsigned hand-off at the employee review', () => {
    expect(resumeStepFor('sign')).toBe('contract');
    expect(routeForResume('sign')).toBe('contract');
    expect(routeForResume('capture')).toBe('capture');
    expect(routeForResume('return_compare')).toBeNull();
    expect(routeForResume(null)).toBeNull();
  });

  it('jumps to the grid once photos exist', () => {
    expect(routeForStep('inspect', false)).toBe('capture');
    expect(routeForStep('inspect', true)).toBe('condition');
    expect(routeForStep('sign', true)).toBe('contract');
  });

  it('builds hrefs with encoded query params', () => {
    expect(startHref('r1', 'capture')).toBe('/rental/r1/start/capture');
    expect(startHref('r1', 'capture', { angle: 'front_left', single: '1', extra: undefined })).toBe(
      '/rental/r1/start/capture?angle=front_left&single=1',
    );
  });
});
