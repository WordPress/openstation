/**
 * OpenStation — Public API barrel (architecture-0.8.1 location).
 *
 * The canonical home of the public API for plugin authors going
 * forward. Re-exports the historical `src/public-api.ts` types
 * unchanged so existing imports keep working, and also exports the
 * runtime helpers (`installDeprecatedAlias`) that arrived with the
 * 1.0 refactor.
 *
 * The runtime facade assembly lives in `./facade.ts`
 * (`buildPublicApi()`), which `src/desktop.ts` calls from `init()`.
 */

export * from '../public-api';
export {
	installDeprecatedAlias,
	_resetDeprecationWarningsForTests,
} from './deprecated';
