/**
 * Desktop Mode — Built-in plugin bootstrap.
 *
 * Side-effect-only imports for every plugin that ships inside the
 * main bundle. Each plugin subscribes to `desktop-mode.init` (or runs
 * at module-load when that's enough) via the public hook API —
 * exactly what a third-party plugin would do. This module exists to
 * dogfood the public API from inside the main bundle.
 *
 * Adding a new built-in: create `./<plugin-id>/index.ts`, import it
 * here. That's it.
 *
 * @since 0.6.0
 */

import './animated-logo-wallpaper';
