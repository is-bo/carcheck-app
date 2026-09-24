import { APP_NAME } from '@/config';

// Guards the test toolchain itself: TypeScript transform + the `@/` path alias.
describe('toolchain', () => {
  it('resolves the @/ alias', () => {
    expect(APP_NAME).toBe('CarCheck');
  });
});
