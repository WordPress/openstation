/**
 * Vitest global setup — runs once per test file before any
 * `describe` / `test` block.
 *
 * Pre-registers every `<wpd-*>` component class that production
 * code loads lazily via the `shell-overlays[.min].js` bundle, so
 * unit tests that exercise menu / dialog / toast call paths see
 * upgraded custom elements without each test needing its own leaf
 * import.
 *
 * Production main bundle does NOT load these — that's the whole
 * point of the lazy split. The setup file is in
 * `tests/vitest/` and only runs under vitest, so esbuild's
 * tree-shake of the production build never sees it.
 *
 * Keep this list in sync with `src/shell-overlays/entry.ts`.
 */
import '../../src/ui/components/wpd-toast/wpd-toast';
import '../../src/ui/components/wpd-confirm-dialog/wpd-confirm-dialog';
import '../../src/ui/components/wpd-context-menu/wpd-context-menu';
