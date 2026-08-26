/**
 * OpenStation — Public API barrel (architecture-0.8.1 location).
 *
 * The canonical home of the public API for plugin authors going
 * forward. Re-exports the historical `src/public-api.ts` types
 * unchanged so existing imports keep working, and also exports the
 * runtime helpers (`installDeprecatedAlias`) that arrived with the
 * 1.0 refactor.
 *
 * Phase 5 (boot decomposition) will move the runtime facade
 * assembly here as well — a single `attachPublicApi(services)`
 * function that wires every `wp.os.*` method in one place.
 * Until then, the runtime assembly continues to live in
 * `src/desktop.ts`.
 */

export * from '../public-api';
export {
	installDeprecatedAlias,
	_resetDeprecationWarningsForTests,
} from './deprecated';
