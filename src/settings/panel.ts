/**
 * OpenStation — OS Settings panel renderer (lazy bundle).
 *
 * Holds the entire OS Settings UI: tab strip, section builders for
 * every built-in tab (Appearance / Themes / Windows / Navigation /
 * Features / Components / About), wallpaper picker + editor host, and
 * the Reset button. None of this is needed before the user clicks the
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
 *   - Every `<os-*>` component leaf import the panel needs
 *     (`os-button`, `os-color-field`, `os-range-field`,
 *     `os-swatch`, `os-swatch-grid`, `os-section`,
 *     `os-segmented`, `os-tabs`, `os-panel`, `os-empty-state`,
 *     `os-checkbox-label`, `os-select`, `os-text-field`).
 *   - Every built-in section renderer in `./sections/*`.
 *   - The tab interleaving + registry subscription that paint the
 *     final UI.
 */

import { __ } from '../i18n';
import { html, render } from '../ui/core';
import { osIcon } from '../ui/icons';
// Side-effect imports — register every `<os-*>` component the
// panel constructs in this bundle (not in main). `defineComponent`
// is idempotent so other bundles can register the same tag without
// conflict.
import '../ui/components/os-button/os-button';
import '../ui/components/os-checkbox-label/os-checkbox-label';
import '../ui/components/os-color-field/os-color-field';
import '../ui/components/os-empty-state/os-empty-state';
import '../ui/components/os-notice/os-notice';
import '../ui/components/os-panel/os-panel';
import '../ui/components/os-range-field/os-range-field';
import '../ui/components/os-section/os-section';
import '../ui/components/os-segmented/os-segmented';
import '../ui/components/os-select/os-select';
import '../ui/components/os-swatch/os-swatch';
import '../ui/components/os-swatch-grid/os-swatch-grid';
import '../ui/components/os-tabs/os-tabs';
import '../ui/components/os-text-field/os-text-field';
import { setPanelTabs } from '../window/tab-strip';
import { NAV_ICONS } from './nav-icons';
import { structuredDefaults } from './state';
import type { OsSettings } from './index';
import type { DesktopSettingsTab } from './registry';
import { listSettingsTabs, subscribeSettingsTabs } from './registry';
import { buildAboutSection } from './sections/about';
import { buildAccentSection } from './sections/accent';
import { buildAdminBarSection } from './sections/admin-bar';
import { buildThemesSection } from './sections/themes';
import { buildNavigationSection } from './sections/navigation';
import { buildDesktopLayoutSection } from './sections/desktop-layout';
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
 * Which band of the sidebar a page belongs to.
 *
 * The nav is three groups separated by a gap and nothing else: no
 * headings, no rules, no labels. A group heading over two rows costs
 * more vertical space than the rows it is describing, and every name
 * we tried for these three ("Desktop", "Content", "System") was
 * either a category the user does not think in or a word already
 * spoken by one of the rows underneath it.
 *
 * The band is derived from `order` rather than declared per row, and
 * that is what makes the grouping survive third-party tabs. The
 * settings-tab registry has no group field, so a plugin cannot name
 * one; what it does declare is an order, and a plugin that registers
 * at 15 already means "next to Appearance and Themes". Reading the
 * band off that number puts it there instead of stranding it at the
 * bottom. Tabs that take the registry default (100) land in the last
 * group, which is where a flat strip used to put them too.
 *
 * 1. The desktop itself: Appearance, Themes, Dock, Windows.
 * 2. What is running on it: Apps and Plugins, Features.
 * 3. The system: Components, About, and anything unplaced.
 */
function navGroup( order: number ): number {
	if ( order < 20 ) {
		return 1;
	}
	return order < 40 ? 2 : 3;
}

/**
 * Attributes across the `<os-*>` kit that carry text a person reads.
 *
 * The search index has to collect these separately from `textContent`:
 * a component renders them inside its own shadow root, so none of them
 * is light-DOM text no matter how prominent it looks on screen. Every
 * section title in the panel is one of them.
 */
const TEXT_ATTRIBUTES = [
	'heading',
	'description',
	'label',
	'placeholder',
] as const;

/**
 * The heading a page opens with, and the sentence under it.
 *
 * The sidebar names the page in 14px Regular, which is enough to pick
 * it and not enough to arrive at it: with the nav's own label the only
 * title on screen, every page began mid-thought at whatever its first
 * section happened to be. This is the same word again at the size of a
 * title, plus the one line that says what the page is FOR, which is
 * the thing the nav has no room to say.
 *
 * Rendered by the panel rather than by each section builder so the
 * pages cannot drift apart, and so a section stays a section: reusable
 * on any page, with no opinion about being first on one.
 */
function pageHeader( title: string, description = '' ) {
	return html`
		<header class="os-settings__page-header">
			<h2 class="os-settings__page-title">${ title }</h2>
			${ description
				? html`<p class="os-settings__page-description">
						${ description }
					</p>`
				: html`` }
		</header>
	`;
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
 * leaks, and the `<os-*>` host elements deduplicate by reusing the
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

	// The hook every rule in `os-settings.css` hangs off. It is a CSS
	// class, not one of the frozen `desktop_mode_*` stored values — the
	// stylesheet was renamed to `.os-settings` in the rebrand and this
	// line was not, which left all 153 of its rules matching nothing.
	//
	// The About tab is where that showed: its canvas gets its height
	// from a `flex: 1; min-height: 0` chain whose first two links are
	// scoped under `.os-settings`, so the stage host measured zero, and
	// `waitForSize()` — which has no timeout, by design, because a
	// hidden tabpanel legitimately takes a while — waited for a box
	// that was never coming. The scene never mounted and never errored.
	body.classList.add( 'os-settings' );

	/**
	 * Put every setting back to its default.
	 *
	 * One button for the whole panel, at the foot of the nav, because
	 * that is where the panel itself is addressed from: the column
	 * lists the pages, and the thing under the list acts on all of
	 * them. A per-page bar was tried and it cost a permanent strip
	 * across the bottom of every page to say what one button in the
	 * furniture says once.
	 *
	 * The uploaded image survives. It is a pointer at something the
	 * user made, not a preference: putting the wallpaper back to Galaxy
	 * is the visible thing they asked for, and throwing away the upload
	 * on the way would be a second, silent, destructive act they did
	 * not. It stays in the grid, one click from being chosen again.
	 *
	 * `structuredDefaults()` deep-clones the nested objects, so a reset
	 * can never alias (and later corrupt) the module-level DEFAULTS
	 * singleton. See the function's own note.
	 */
	const onReset = (): void => {
		const preservedImage = ctx.state.customImage;
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
		/*
		 * A plain string, not a rendered `<os-tab>`. The strip lives
		 * in the window chrome now, outside this panel's render root,
		 * and the shell builds the buttons from these.
		 */
		label: string;
		panel: ReturnType< typeof html >;
		/**
		 * The sidebar glyph. Built-in rows resolve straight from
		 * NAV_ICONS by row id; external rows carry theirs here,
		 * because their row id wears the ext- prefix while NAV_ICONS
		 * keys on the raw registry id (see the File Associations
		 * entry in nav-icons.ts).
		 */
		icon?: SVGSVGElement;
		/** For external tabs — invoked after render to mount content. */
		mount?: ( host: HTMLElement ) => void;
	}

	const rows: TabRow[] = [
		{
			id: 'appearance',
			order: 10,
			label: __( 'Appearance' ),
			panel: html`<os-tabpanel for="appearance">
				<os-panel>
					${ pageHeader(
						__( 'Appearance' ),
						__(
							'Personalize your desktop. Changes apply instantly and are saved to this browser.',
						),
					) }
					<!--
						Accent first. It is one row of swatches and the
						fastest thing on the page to change, where the
						wallpaper grid below it is fourteen tiles deep.
						Under the grid it fell below the fold on a short
						window and read as an afterthought to it.
					-->
					${ buildAccentSection( ctx ) }
					${ buildWallpaperSection( ctx, body ) }
					${ buildDesktopLayoutSection( ctx ) }
					${ buildDockRailRendererSection( ctx ) }
					${ buildAdminBarSection( ctx ) }
				</os-panel>
			</os-tabpanel>`,
		},
		{
			// Corners came from Appearance, the rest from Effects.
			// Shape, motion and links are all one object's settings;
			// "Effects" named the technique rather than the thing.
			id: 'windows',
			order: 18,
			label: __( 'Windows' ),
			panel: html`<os-tabpanel for="windows">
				<os-panel>
					${ pageHeader(
						__( 'Windows' ),
						__(
							'How windows look, how they arrive, and how they behave when they are not the one you are using.',
						),
					) }
					${ buildWindowRadiusSection( ctx ) }
					${ buildEffectsSection( ctx ) }
				</os-panel>
			</os-tabpanel>`,
		},
		{
			id: 'features',
			order: 30,
			label: __( 'Features' ),
			panel: html`<os-tabpanel for="features">
				<os-panel>
					${ pageHeader(
						__( 'Features' ),
						__(
							'The assistant, the developer tools, and the betas. Every switch here affects only your account and takes effect immediately.',
						),
					) }
					${ buildFeaturesSection( ctx ) }
					${ isAdmin ? buildExtendedSection( ctx ) : '' }
				</os-panel>
			</os-tabpanel>`,
		},
		{
			id: 'themes',
			// Between Appearance (10) and the dock: a desktop theme is
			// a coarser version of what Appearance does, so it reads as
			// the next step, not a separate concern.
			order: 12,
			label: __( 'Themes' ),
			panel: html`<os-tabpanel for="themes">
				<os-panel>
					${ pageHeader(
						__( 'Themes' ),
						__(
							'A desktop theme repaints every token at once. A coarser version of what Appearance does one control at a time.',
						),
					) }
					${ buildThemesSection( ctx ) }
				</os-panel>
			</os-tabpanel>`,
		},
		{
			id: 'navigation',
			order: 22,
			label: __( 'Navigation' ),
			panel: html`<os-tabpanel for="navigation">
				<os-panel>
					<!--
						No description here. The page's opening
						sentence names the rails the user is
						actually looking at, which the split layout
						changes, so the section owns it — that is
						the node that repaints on a settings change.
					-->
					${ pageHeader( __( 'Navigation' ) ) }
					${ buildNavigationSection( ctx ) }
				</os-panel>
			</os-tabpanel>`,
		},
	];

	if ( isAdmin ) {
		rows.push( {
			id: 'help',
			order: 40,
			label: __( 'Components' ),
			panel: html`<os-tabpanel for="help">
				<os-panel>
					${ pageHeader(
						__( 'Components' ),
						__(
							'Every <os-*> web component shipped by this plugin, with its props, slots, and a live example.',
						),
					) }
					${ buildHelpSection( ctx ) }
				</os-panel>
			</os-tabpanel>`,
		} );
	}

	// About — credits + the interactive Pixi particle scene. Pinned
	// to the very end of the tab strip with a sentinel order
	// (`Number.MAX_SAFE_INTEGER`) so it stays last regardless of
	// any third-party tabs registered through the settings-tab
	// registry (which default to `order: 100`). The visual moment
	// belongs at the end of the settings tour. Visible to every
	// user, not just admins; `padding="0"` so the dark stage
	// extends to the tabpanel edge without the os-panel's
	// default 16px frame.
	rows.push( {
		id: 'about',
		order: Number.MAX_SAFE_INTEGER,
		label: __( 'About' ),
		panel: html`<os-tabpanel for="about">
			<os-panel padding="0">${ buildAboutSection() }</os-panel>
		</os-tabpanel>`,
	} );

	for ( const tab of externalTabs ) {
		const tabId = `ext-${ tab.id }`;
		const hostAttr = `os-settings-tab-host-${ tab.id }`;
		const tabRef = tab;
		rows.push( {
			id: tabId,
			order: tab.order ?? 100,
			label: tab.label,
			// The registry has no icon field, but the shell may know
			// its OWN registry-delivered tabs by raw id. Looked up
			// here rather than in the template, because the row id
			// carries the ext- prefix and would never match.
			icon: NAV_ICONS[ tab.id ]?.(),
			panel: html`<os-tabpanel for=${ tabId }>
				<os-panel><div data-host=${ hostAttr }></div></os-panel>
			</os-tabpanel>`,
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
							'[openstation] settings tab render threw:',
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
	// `ctx.activeTabId` is the record now. The strip itself lives in
	// the window chrome, outside this render root, and survives a
	// re-render on its own — but the panes below do not, so the tab
	// we hand the shell has to be one that still exists.
	const previousValue = ctx.activeTabId ?? 'appearance';
	const activeRowExists = rows.some( ( r ) => r.id === previousValue );
	const initialTab = activeRowExists ? previousValue : 'appearance';

	/**
	 * What each page can be found by.
	 *
	 * Built from the rendered panes rather than from a hand-kept list
	 * of keywords, because a hand-kept list is a second copy of every
	 * label in the panel and goes stale the first time one is reworded.
	 * Every pane is in the DOM from the first paint (they are toggled
	 * with `hidden`, not mounted on demand), so their text is readable
	 * here without showing anything.
	 *
	 * That makes the search match what a person would actually go
	 * looking for: typing "corners" finds Windows, "galaxy" finds
	 * Appearance, "beta" finds Features. None of those words is a page
	 * name, which is exactly why searching only the nav labels would
	 * have been close to useless with nine of them on screen already.
	 *
	 * About indexes to little more than its own name: it is a canvas,
	 * and there is no text in it to read.
	 */
	const buildSearchIndex = (): Map< string, string > => {
		const index = new Map< string, string >();
		for ( const row of rows ) {
			const pane = body.querySelector( `os-tabpanel[for="${ row.id }"]` );
			/*
			 * `textContent` alone is not enough, and the gap is not
			 * obvious: every section title in this panel is an
			 * ATTRIBUTE that `<os-section>` renders inside its own
			 * shadow root, so none of them is light-DOM text. Indexing
			 * only textContent gave a search where "galaxy" found
			 * Appearance (a swatch label, light DOM) but "corners"
			 * found nothing at all, because "Window corners" is a
			 * heading. Half-working search is worse than none: it
			 * answers confidently and wrongly.
			 *
			 * So the attributes that carry human-readable text are
			 * collected too. These four are the ones the kit uses for
			 * anything a person reads.
			 */
			const parts: string[] = [ row.label, pane?.textContent ?? '' ];
			if ( pane ) {
				const labelled = pane.querySelectorAll(
					'[heading],[description],[label],[placeholder]',
				);
				for ( const el of Array.from( labelled ) ) {
					for ( const attr of TEXT_ATTRIBUTES ) {
						parts.push( el.getAttribute( attr ) ?? '' );
					}
				}
			}
			index.set(
				row.id,
				parts.join( ' ' ).replace( /\s+/g, ' ' ).toLowerCase(),
			);
		}
		return index;
	};

	let searchIndex: Map< string, string > | null = null;

	const onSearch = ( e: Event ): void => {
		const query = ( e.target as HTMLInputElement ).value
			.trim()
			.toLowerCase();
		// Built on first use, not at render: the panes have to be in the
		// DOM, and most sessions never type in this field at all.
		searchIndex = searchIndex ?? buildSearchIndex();
		let visible = 0;
		for ( const tab of Array.from(
			body.querySelectorAll< HTMLElement >( ':scope > os-tabs > os-tab' ),
		) ) {
			const id = tab.getAttribute( 'value' ) ?? '';
			const hit =
				query === '' || ( searchIndex.get( id ) ?? '' ).includes( query );
			tab.toggleAttribute( 'data-search-hidden', ! hit );
			if ( hit ) {
				visible++;
			}
		}
		const empty = body.querySelector< HTMLElement >(
			'.os-settings__search-empty',
		);
		if ( empty ) {
			empty.hidden = visible > 0;
		}
	};

	/*
	 * The search field, the strip and the panes are SIBLINGS, and that
	 * is a hard constraint rather than a layout preference.
	 * `<os-tabs>` finds the panes it drives by looking for
	 * `os-tabpanel` children of its own parent, so wrapping the strip
	 * in a sidebar div puts every pane out of its reach and the panel
	 * renders all nine at once, stacked. The column is assembled by
	 * the grid in `os-settings.css` instead.
	 */
	render(
		html`
			<div class="os-settings__search">
				<label class="os-settings__search-field">
					${ osIcon( 'search', { size: null } ) }
					<input
						type="search"
						class="os-settings__search-input"
						placeholder=${ __( 'Search settings' ) }
						aria-label=${ __( 'Search settings' ) }
						aria-controls="os-settings-nav"
						@input=${ onSearch }
					/>
				</label>
			</div>
			<os-tabs
				id="os-settings-nav"
				orientation="vertical"
				value=${ initialTab }
				label=${ __( 'Settings sections' ) }
			>
				${ rows.map( ( r, i ) => {
					// The first row of a band opens a new group; every
					// other row sits flush against the one above it.
					// Compared against the PREVIOUS row rather than
					// counted, so a band with nothing in it (Components
					// is admin-only, and a site with no third-party tabs
					// has an empty group 3 for non-admins) leaves no
					// orphan gap behind.
					const startsGroup =
						i > 0 &&
						navGroup( r.order ) !== navGroup( rows[ i - 1 ].order );
					return html`<os-tab
						value=${ r.id }
						data-group-start=${ startsGroup ? 'true' : null }
						>${ NAV_ICONS[ r.id ]?.() ??
						r.icon ??
						// Third-party tabs have no glyph to render: the
						// registry has no icon field. The spacer keeps
						// their label on the same line as every other
						// label rather than hanging 28px to the left.
						html`<span
							class="os-settings__nav-glyph-blank"
							aria-hidden="true"
						></span>` }${ r.label }</os-tab
					>`;
				} ) }
			</os-tabs>
			<p class="os-settings__search-empty" hidden>
				${ __( 'No settings match that.' ) }
			</p>
			<os-panel class="os-settings__footer">
				<os-button variant="ghost" @click=${ onReset }
					>${ __( 'Reset to defaults' ) }</os-button
				>
			</os-panel>
			${ rows.map( ( r ) => r.panel ) }
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

	/*
	 * The strip lives in the panel body, not the window chrome.
	 *
	 * `setPanelTabs()` puts a window's tabs under its title bar, which
	 * is right for an admin-page window and wrong here: that strip is
	 * horizontal and shared with every native window, and OS Settings
	 * needs a sidebar that can hold more entries than a title bar has
	 * room for. Eight tabs already measured 1178px inside an 1180px
	 * window, and `openstation_register_settings_tab()` exists to
	 * invite more.
	 *
	 * `<os-tabs>` pairs itself with the sibling `<os-tabpanel for="…">`
	 * panes above, so selection, `aria-selected`, roving tabindex and
	 * pane visibility all come with it.
	 */
	const tabsHost = body.querySelector( 'os-tabs' );
	if ( tabsHost ) {
		/*
		 * Track the user's choice so a registry-driven re-render lands
		 * them back on it. `lit` reuses the host across renders, so the
		 * listener would stack; an `AbortSignal` off a per-render
		 * controller retires the previous one.
		 */
		ctx.tabChangeAbort?.abort();
		const controller = new AbortController();
		ctx.tabChangeAbort = controller;
		tabsHost.addEventListener(
			'os-tab-change',
			( e: Event ) => {
				const detail = ( e as CustomEvent ).detail as {
					value?: string;
				};
				if ( detail?.value ) {
					ctx.activeTabId = detail.value;
				}
			},
			{ signal: controller.signal },
		);
	}

	/*
	 * Clear any panel tabs a previous render left in the chrome. The
	 * window is reused across opens, so a build that still handed its
	 * tabs upward would otherwise leave a stale strip under the title
	 * bar with nothing behind it.
	 */
	const winEl = body.closest< HTMLElement >( '.os-window' );
	if ( winEl ) {
		setPanelTabs( winEl, [] );
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
