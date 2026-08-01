/**
 * Desktop Mode — Mascot lazy-bundle entry.
 *
 * Built as `assets/js/mascot[.min].js`. Its only side effect is
 * publishing the mount function on `window.desktopModeMountMascot`;
 * the shell controller (`src/mascot/controller.ts`, main bundle)
 * `<script>`-injects this file the first time the user switches the
 * mascot on and calls the global.
 *
 * Same publish-a-global pattern the wallpaper, widget, and about-
 * scene bundles use — see `docs/architecture.md`.
 */

import { mountMascot } from './mascot';
// Side-effect import: `types.ts` carries the `declare global` that
// puts `desktopModeMountMascot` on `Window`.
import './types';

window.desktopModeMountMascot = mountMascot;
