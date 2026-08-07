/**
 * OpenStation — Games hub bundle entry.
 *
 * Lazy-loaded by the native-window sync the first time the
 * `desktop-mode-games` window opens. Publishes the hub's render
 * callback and leaf-imports the `<os-*>` components this bundle
 * constructs that the main shell bundle doesn't ship.
 *
 * The games registry + challenges store live in `createSharedStore`
 * records, so everything this bundle paints is the same data the
 * main bundle's server-sync and Heartbeat client maintain.
 *
 * @public
 */

// The `<os-*>` components are side-effect-imported by the leaf
// modules that construct them (hub, scoreboard, challenges view,
// challenge dialog) — nothing to register at the entry level.
import { renderGamesHub } from './hub';

// NOTE: kept in lock-step with the canonical declaration in
// `src/native-windows.ts` — the two must agree structurally.
type RenderCallback = ( body: HTMLElement ) => void;

declare global {
	interface Window {
		openStationNativeWindows?: Record< string, RenderCallback | undefined >;
	}
}

const registry = ( window.openStationNativeWindows ??= {} );
registry[ 'desktop-mode-games' ] = renderGamesHub as RenderCallback;
