/**
 * OS Settings panel — lazy bundle entry.
 *
 * Compiled by Vite (target `os-settings-panel`) into
 * `assets/js/os-settings-panel[.min].js`. The bundle is injected on
 * demand by the main-bundle `OsSettings.renderPanel()` stub the
 * first time the user opens OS Settings, so the ~13 `<wpd-*>`
 * component classes the panel uses and the section renderers never
 * reach `desktop.min.js`.
 *
 * Publishes a single global:
 * `window.desktopModeRenderOsSettingsPanel( ctx, body )`. The stub
 * awaits the script's `load` event and forwards every panel open
 * (and registry-driven re-render) to this function.
 */

import { renderOsSettingsPanel } from './panel';
import type { OsSettings } from './index';

declare global {
	interface Window {
		desktopModeRenderOsSettingsPanel?: (
			ctx: OsSettings,
			body: HTMLElement,
		) => void;
	}
}

window.desktopModeRenderOsSettingsPanel = renderOsSettingsPanel;
