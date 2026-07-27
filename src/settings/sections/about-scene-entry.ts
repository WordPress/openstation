/**
 * About-scene lazy bundle entry.
 *
 * Built by Vite (target `about-scene`) into
 * `assets/js/about-scene[.min].js`. The bundle is `<script>`-injected
 * by the main-bundle loader (`./about-scene-loader.ts`) the first
 * time the user opens the OS Settings → About tab, so the ~25 kB
 * Pixi-driven particle scene never ships in `desktop.min.js`.
 *
 * Publishes a single global: `window.desktopModeMountAboutScene`.
 * The loader awaits the script's `load` event, reads the global,
 * and forwards the caller's options to it.
 */

import { mountAboutScene, type AboutScene, type SceneOptions } from './about-scene';

declare global {
	interface Window {
		desktopModeMountAboutScene?: ( opts: SceneOptions ) => Promise< AboutScene >;
	}
}

window.desktopModeMountAboutScene = mountAboutScene;
