/**
 * Full component kit — lazy bundle entry.
 *
 * Compiled by Vite (target `components`) into
 * `assets/js/os-components[.min].js`. Side-effect-imports the
 * barrel, which registers every `<os-*>` tag in
 * {@link OS_COMPONENT_TAGS}, and nothing else.
 *
 * **Why it exists.** Components register per bundle, at import
 * time. The shell's own bundles between them cover about a third of
 * the kit — whatever `desktop.min.js`, `shell-overlays` and
 * `window-system` happen to render. Every other tag upgrades only
 * once some loaded bundle has imported its module, which is fine
 * for code inside this repo and a wall for code outside it: a
 * plugin that ships as a zip has no `file:` path to import from at
 * build time, and bundling its own copy means shipping components
 * the page already has.
 *
 * So the kit gets a URL. `wp.os.loadComponents()` injects this
 * bundle on demand and every tag upgrades — see
 * `src/ui/components/loader.ts` for the caller-side contract.
 *
 * The duplication with the eagerly-registered subset is deliberate
 * and cheap: a lazy bundle cannot import from `desktop.min.js`, and
 * `defineComponent()` no-ops on a tag that is already defined, so
 * the overlap costs bytes on a fetch nobody makes unless they asked
 * for it.
 */

import './index';

// Readiness marker, same contract as `window.openStationShellOverlays`:
// a flag this bundle and only this bundle sets. Never sniff a tag to
// answer "did this bundle load?" — any bundle can register any tag,
// and the shell-overlays loader spent months believing one that
// another bundle had registered for it.
window.openStationComponents = true;
