/**
 * Desktop Mode — Mio lazy-bundle entry.
 *
 * Built as `assets/js/mio[.min].js`. Its only side effect is
 * publishing the mount function on `window.desktopModeMountMio`;
 * the shell controller (`src/mio/controller.ts`, main bundle)
 * `<script>`-injects this file the first time the user switches the
 * Mio on and calls the global.
 *
 * Same publish-a-global pattern the wallpaper, widget, and about-
 * scene bundles use — see `docs/architecture.md`.
 */

import { mountMio } from './mio';
// Side-effect import: `types.ts` carries the `declare global` that
// puts `desktopModeMountMio` on `Window`.
import './types';

window.desktopModeMountMio = mountMio;
