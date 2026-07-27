/**
 * Desktop Mode — OS Settings panel renderer (lazy bundle).
 *
 * Holds the entire OS Settings UI: tab strip, section builders for
 * every built-in tab (Appearance / Apps & Icons / Features / Effects /
 * Components / About), wallpaper picker + editor host, and the
 * Reset button. None of this is needed before the user clicks the
 * Settings dock icon, so it ships in its own Vite target
 * (`os-settings-panel[.min].js`) and gets `<script>`-injected on
 * first open by the stub `renderPanel()` on the `OsSettings` class
 * (in `src/settings/index.ts`).
 *
 * Splitting story
 * ---------------
 * Main bundle keeps:
 *   - The `OsSettings` class with `state`, `apply()`, `save()`,
 *     `getOsSettingsSnapshot()`, `subscribeOsSettings()`. `apply()`
 *     paints wallpaper / accent / dock-size CSS variables, which
 *     must run before first paint, so the state machine is genuinely
 *     boot-critical.
 *   - The thin `renderPanel()` stub that loads this bundle and
 *     forwards.
 *
 * This bundle owns:
 *   - Every `<wpd-*>` component leaf import the panel needs
 *     (`wpd-button`, `wpd-color-field`, `wpd-range-field`,
 *     `wpd-swatch`, `wpd-swatch-grid`, `wpd-section`,
 *     `wpd-segmented`, `wpd-tabs`, `wpd-panel`, `wpd-empty-state`,
 *     `wpd-checkbox-label`, `wpd-select`, `wpd-text-field`).
 *   - Every built-in section renderer in `./sections/*`.
 *   - The tab interleaving + registry subscription that paint the
 *     final UI.
 *
 * @since 0.8.4
 */

import { __ } from '../i18n';
import { html, render } from '../ui/core';
// Side-effect imports — register every `<wpd-*>` component the
// panel constructs in this bundle (not in main). `defineComponent`
// is idempotent so other bundles can register the same tag without
// conflict.
import '../ui/components/wpd-button/wpd-button';
import '../ui/components/wpd-checkbox-label/wpd-checkbox-label';
import '../ui/components/wpd-color-field/wpd-color-field';
import '../ui/components/wpd-empty-state/wpd-empty-state';
import '../ui/components/wpd-notice/wpd-notice';
import '../ui/components/wpd-panel/wpd-panel';
import '../ui/components/wpd-range-field/wpd-range-field';
import '../ui/components/wpd-section/wpd-section';
import '../ui/components/wpd-segmented/wpd-segmented';
import '../ui/components/wpd-select/wpd-select';
import '../ui/components/wpd-swatch/wpd-swatch';
import '../ui/components/wpd-swatch-grid/wpd-swatch-grid';
import '../ui/components/wpd-tabs/wpd-tabs';
import '../ui/components/wpd-text-field/wpd-text-field';
import { structuredDefaults } from './state';
import type { OsSettings } from './index';
import type { DesktopSettingsTab } from './registry';
import { listSettingsTabs, subscribeSettingsTabs } from './registry';
import { buildAboutSection } from './sections/about';
import { buildAccentSection } from './sections/accent';
import { buildThemesSection } from './sections/themes';
import { buildAppsIconsSection } from './sections/apps-icons';
import { buildDesktopLayoutSection } from './sections/desktop-layout';
import { buildDockSizeSection } from './sections/dock-size';
import { buildWindowRadiusSection } from './sections/window-radius';
import { buildDockRailRendererSection } from './sections/dock-rail-renderer';
import { buildEffectsSection } from './sections/effects';
import { buildExtendedSection } from './sections/extended';
import { buildFeaturesSection } from './sections/features';
import { buildHelpSection } from './sections/help';
import {
	attachCustomGradientEditor,
	buildWallpaperSection,
	teardownEditor,
} from './sections/wallpaper';

/**
 * Capability → visibility gate. The shell today collapses capability
 * to a simple admin-or-everyone distinction: `manage_options` requires
 * admin; anything else (including empty) is visible to everyone.
 * Widening to real capability checks is a future expansion.
 */
function isTabVisible( tab: DesktopSettingsTab, isAdmin: boolean ): boolean {
	if ( tab.capability && tab.capability === 'manage_options' ) {
		return isAdmin;
	}
	return true;
}

/**
 * Render the settings panel into the given native-window body.
 *
 * Builds the built-in tabs, interleaves third-party tabs registered
 * via the settings-tab registry, and wires the tab strip and Reset
 * button. The panel is a one-shot build per window open — closing
 * and re-opening renders a fresh tree.
 *
 * Re-entrancy: a save-failure rollback or a registry mutation can
 * re-invoke this function with the same `body`. The function tears
 * down its previous registry subscription on each call to avoid
 * leaks, and the `<wpd-*>` host elements deduplicate by reusing the
 * existing DOM nodes under `lit`.
 *
 * @param ctx  The `OsSettings` instance the panel reads/writes
 *             state on.
 * @param body Native-window body to render into.
 */
export function renderOsSettingsPanel(
	ctx: OsSettings,
	body: HTMLElement,
): void {
	// First call after the bundle loads: splice the
	// custom-gradient editor onto its registration so the wallpaper
	// picker can render the color/angle controls. The main bundle
	// registered the wallpaper without `renderEditor` so its closure
	// didn't drag the editor code into `desktop.min.js`. Subsequent
	// calls re-register with the same def — harmless ("late
	// registrations win") and saves us from threading a one-shot
	// flag around.
	attachCustomGradientEditor( ctx );

	// Tear down any editor mounted by a previous render — closing
	// the OS Settings window doesn't necessarily fire our teardown
	// path, so we do it defensively here.
	teardownEditor( ctx );

	// Drop any previous registry subscription — we'll resubscribe
	// below. Without this, every re-render leaks a listener.
	if ( ctx.tabRegistryUnsubscribe ) {
		ctx.tabRegistryUnsubscribe();
		ctx.tabRegistryUnsubscribe = null;
	}

	body.classList.add( 'desktop-mode-os-settings' );

	const onReset = (): void => {
		// Preserve the uploaded image so the user doesn't lose
		// their upload just by resetting theme preferences — the
		// image still lives in Media Library, and it's an easy
		// re-pick.
		const preservedImage = ctx.state.customImage;
		// `structuredDefaults()` deep-clones the nested objects, so the
		// reset can never alias (and later corrupt) the module-level
		// DEFAULTS singleton — see the function's own note.
		ctx.state = { ...structuredDefaults(), customImage: preservedImage };
		ctx.save();
		ctx.apply();
		ctx.renderPanel( body );
	};

	// Interleave third-party tabs with the built-ins by `order`.
	// Built-in orders match the hardcoded visual sequence so a
	// plugin registering at `order: 15` slots between Appearance
	// and AI Settings.
	const isAdmin = ctx.config.isAdmin;
	const externalTabs = listSettingsTabs().filter( ( tab ) =>
		isTabVisible( tab, isAdmin ),
	);

	interface TabRow {
		id: string;
		order: number;
		tab: ReturnType< typeof html >;
		panel: ReturnType< typeof html >;
		/** For external tabs — invoked after render to mount content. */
		mount?: ( host: HTMLElement ) => void;
	}

	const rows: TabRow[] = [
		{
			id: 'appearance',
			order: 10,
			tab: html`<wpd-tab value="appearance"
				>${ __( 'Appearance' ) }</wpd-tab
			>`,
			panel: html`<wpd-tabpanel for="appearance">
				<wpd-panel>
					<p class="desktop-mode-os-settings__intro">
						${ __(
							'Personalize your desktop. Changes apply instantly and are saved to this browser.',
						) }
					</p>
					${ buildWallpaperSection( ctx, body ) }
					${ buildAccentSection( ctx ) }
					${ buildDesktopLayoutSection( ctx ) }
					${ buildDockSizeSection( ctx ) }
					${ buildWindowRadiusSection( ctx ) }
					${ buildDockRailRendererSection( ctx ) }
				</wpd-panel>
			</wpd-tabpanel>`,
		},
		{
			id: 'features',
			order: 25,
			tab: html`<wpd-tab value="features"
				>${ __( 'Features' ) }</wpd-tab
			>`,
			panel: html`<wpd-tabpanel for="features">
				<wpd-panel>
					${ buildFeaturesSection( ctx ) }
					${ isAdmin ? buildExtendedSection( ctx ) : '' }
				</wpd-panel>
			</wpd-tabpanel>`,
		},
		{
			id: 'themes',
			// Between Appearance (10) and Apps & Icons (22): a desktop
			// theme is a coarser version of what Appearance does, so
			// it reads as the next step, not a separate concern.
			order: 12,
			tab: html`<wpd-tab value="themes">${ __( 'Themes' ) }</wpd-tab>`,
			panel: html`<wpd-tabpanel for="themes">
				<wpd-panel>${ buildThemesSection( ctx ) }</wpd-panel>
			</wpd-tabpanel>`,
		},
		{
			id: 'apps-icons',
			order: 22,
			tab: html`<wpd-tab value="apps-icons"
				>${ __( 'Apps & Icons' ) }</wpd-tab
			>`,
			panel: html`<wpd-tabpanel for="apps-icons">
				<wpd-panel>${ buildAppsIconsSection( ctx ) }</wpd-panel>
			</wpd-tabpanel>`,
		},
		{
			id: 'effects',
			order: 27,
			tab: html`<wpd-tab value="effects"
				>${ __( 'Effects' ) }</wpd-tab
			>`,
			panel: html`<wpd-tabpanel for="effects">
				<wpd-panel>${ buildEffectsSection( ctx ) }</wpd-panel>
			</wpd-tabpanel>`,
		},
	];

	if ( isAdmin ) {
		rows.push( {
			id: 'help',
			order: 40,
			tab: html`<wpd-tab value="help">${ __( 'Components' ) }</wpd-tab>`,
			panel: html`<wpd-tabpanel for="help">
				<wpd-panel>${ buildHelpSection( ctx ) }</wpd-panel>
			</wpd-tabpanel>`,
		} );
	}

	// About — credits + the interactive Pixi particle scene. Pinned
	// to the very end of the tab strip with a sentinel order
	// (`Number.MAX_SAFE_INTEGER`) so it stays last regardless of
	// any third-party tabs registered through the settings-tab
	// registry (which default to `order: 100`). The visual moment
	// belongs at the end of the settings tour. Visible to every
	// user, not just admins; `padding="0"` so the dark stage
	// extends to the tabpanel edge without the wpd-panel's
	// default 16px frame.
	rows.push( {
		id: 'about',
		order: Number.MAX_SAFE_INTEGER,
		tab: html`<wpd-tab value="about">${ __( 'About' ) }</wpd-tab>`,
		panel: html`<wpd-tabpanel for="about">
			<wpd-panel padding="0">${ buildAboutSection() }</wpd-panel>
		</wpd-tabpanel>`,
	} );

	for ( const tab of externalTabs ) {
		const tabId = `ext-${ tab.id }`;
		const hostAttr = `wpd-settings-tab-host-${ tab.id }`;
		const tabRef = tab;
		rows.push( {
			id: tabId,
			order: tab.order ?? 100,
			tab: html`<wpd-tab value=${ tabId }>${ tab.label }</wpd-tab>`,
			panel: html`<wpd-tabpanel for=${ tabId }>
				<wpd-panel><div data-host=${ hostAttr }></div></wpd-panel>
			</wpd-tabpanel>`,
			mount: ( rootBody: HTMLElement ): void => {
				const host = rootBody.querySelector< HTMLElement >(
					`[data-host="${ hostAttr }"]`,
				);
				if ( ! host ) {
					return;
				}
				try {
					tabRef.render( host, {
						isAdmin,
						getOsSettings: () => ctx.getOsSettingsSnapshot(),
						subscribeOsSettings: ( cb ) =>
							ctx.subscribeOsSettings( cb ),
					} );
				} catch ( err ) {
					if ( typeof console !== 'undefined' ) {
						console.error(
							'[desktop-mode] settings tab render threw:',
							tabRef.id,
							err,
						);
					}
				}
			},
		} );
	}

	rows.sort( ( a, b ) => a.order - b.order );

	// Preserve the active tab across re-renders triggered by the
	// settings-tab registry (e.g. when a third-party plugin live-
	// registers a settings tab via the chromeless bridge and we
	// rebuild the strip in response). Without this, every
	// refreshMenu() snaps the user back to the Appearance tab
	// mid-action.
	//
	// `<wpd-tabs>` keeps the live selected value on the JS property,
	// not the attribute — `getAttribute('value')` would always
	// return the initial value, regardless of what the user picked.
	const previousTabs = body.querySelector( 'wpd-tabs' ) as
		| ( HTMLElement & { value?: string } )
		| null;
	const previousValue =
		ctx.activeTabId ??
		previousTabs?.value ??
		previousTabs?.getAttribute( 'value' ) ??
		'appearance';
	const activeRowExists = rows.some( ( r ) => r.id === previousValue );
	const initialTab = activeRowExists ? previousValue : 'appearance';

	render(
		html`
			<wpd-tabs value=${ initialTab } label=${ __( 'Settings sections' ) }>
				${ rows.map( ( r ) => r.tab ) }
			</wpd-tabs>
			${ rows.map( ( r ) => r.panel ) }
			<wpd-panel class="desktop-mode-os-settings__footer">
				<wpd-button variant="ghost" @click=${ onReset }
					>${ __( 'Reset to defaults' ) }</wpd-button
				>
			</wpd-panel>
		`,
		body,
	);
	// Save feedback lives on the OS Settings window's title-bar
	// activity dot — the always-on modem light next to the icon.
	// No section-level or footer indicator: one canonical
	// affordance per window, no duplication across the panel.

	// Mount external tab content after the tabpanels are in the
	// DOM so their hosts can be queried.
	for ( const row of rows ) {
		if ( row.mount ) {
			row.mount( body );
		}
	}

	// Track the active tab id so a registry-driven re-render can
	// land the user back on it. Bound on the freshly-rendered
	// `<wpd-tabs>` host — `lit` reuses the DOM node across
	// renders, but the listener idempotently overwrites
	// `activeTabId` so duplicates are harmless.
	const tabsHost = body.querySelector( 'wpd-tabs' );
	if ( tabsHost ) {
		tabsHost.addEventListener( 'wpd-tab-change', ( e: Event ) => {
			const detail = ( e as CustomEvent ).detail as { value?: string };
			if ( detail?.value ) {
				ctx.activeTabId = detail.value;
			}
		} );
	}
	ctx.activeTabId = initialTab;

	// Re-render when the registry changes so a plugin that loads
	// *after* the OS Settings window opens (via the server-sync
	// script injection) still gets its tab painted live.
	ctx.tabRegistryUnsubscribe = subscribeSettingsTabs( () => {
		// Guard against the window being closed between the
		// notification and the re-render: if body is detached,
		// silently drop the subscription.
		if ( ! body.isConnected ) {
			if ( ctx.tabRegistryUnsubscribe ) {
				ctx.tabRegistryUnsubscribe();
				ctx.tabRegistryUnsubscribe = null;
			}
			return;
		}
		ctx.renderPanel( body );
	} );
}
