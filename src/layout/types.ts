/**
 * Layout type re-exports.
 *
 * The canonical `DesktopLayoutId` lives in `src/settings/types.ts`
 * because it's part of the OS-Settings persisted state. This
 * module re-exports it under the `@layout/*` alias so consumers
 * that only care about the layout (not the broader settings
 * surface) have a focused import path.
 */

export type { DesktopLayoutId } from '../settings/types';
