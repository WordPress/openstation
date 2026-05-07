/**
 * Window system — architecture-0.8.1 umbrella barrel.
 *
 * Combines the three historical window-related directories
 * (`src/window/`, `src/window-manager/`, `src/window-chrome/`) into
 * a single discoverable namespace under `@window-system/*`. New
 * code SHOULD reach for this barrel; existing consumers can
 * continue to import from the legacy paths because everything
 * here is a direct re-export.
 *
 * The actual decomposition (splitting `src/window/index.ts` —
 * 2,642 LOC — into focused window/{window,renderer,messenger,
 * geometry,event-bus}.ts modules) ships incrementally on top of
 * this barrel; consumers that switch to `@window-system` today
 * get the migration for free when those splits land.
 *
 * @since 0.8.1
 */

export * from '../window';
export * from '../window-manager';
export * from '../window-chrome';
