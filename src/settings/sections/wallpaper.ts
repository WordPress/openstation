/**
 * Wallpaper section — registry-driven swatch grid + editor slot +
 * custom-image tabbed picker. Also owns the built-in dynamic wallpaper
 * registrations (`custom-gradient` + `custom-image`) since those close
 * over the OS Settings state they render from.
 */

import { __, sprintf } from '../../i18n';
import { html, render } from '../../ui/core';
import * as registry from '../../wallpapers/registry';
import {
	getWallpaperSettings,
	publishWallpaperSettings,
	type WallpaperSettings,
} from '../../wallpapers/settings-store';
import type {
	WallpaperConfigContext,
	WallpaperDef,
	WallpaperTeardown,
} from '../../wallpapers/types';
import '../../ui/components/os-modal/os-modal';
import '../../ui/components/os-button/os-button';
import {
	CUSTOM_GRADIENT_ID,
	CUSTOM_IMAGE_ID,
} from '../constants';
import type { OsSettingsState, SettingsCtx } from '../types';
import { isPromise } from '../utils';
import { buildCustomImageSection } from './custom-image';
import {
	createWallpaperPreviewManager,
	type WallpaperPreviewManager,
} from './wallpaper-previews';

/** Compose the current custom-gradient CSS value from state. */
export function customGradientCss( state: OsSettingsState ): string {
	const { from, to, angle } = state.customGradient;
	return `linear-gradient(${ angle }deg, ${ from }, ${ to })`;
}

/**
 * Register the custom-gradient wallpaper. Its CSS value is computed on
 * every apply from user state (so live edits through the editor repaint
 * without re-registering).
 *
 * NOTE — no `renderEditor` here on purpose. Keeping this function
 * free of any reference to the editor closure is what lets Rollup
 * tree-shake `renderCustomGradientEditor` (and its color-picker /
 * range-slider transitive deps) out of the main bundle: it survives
 * only in the lazy OS-Settings-panel bundle, which calls
 * {@link attachCustomGradientEditor} when it loads to splice the
 * editor onto the existing registration ("late registrations win"
 * per `wallpapers/registry.ts`).
 */
const CUSTOM_GRADIENT_DESCRIPTION = (): string =>
	__( 'Mix your own two-colour gradient and set the angle — your desk, your palette.' );

export function registerCustomGradient( ctx: SettingsCtx ): void {
	registry.register( {
		id: CUSTOM_GRADIENT_ID,
		label: __( 'Custom gradient' ),
		type: 'css',
		preview: customGradientCss( ctx.state ),
		description: CUSTOM_GRADIENT_DESCRIPTION(),
		resolveValue: () => customGradientCss( ctx.state ),
	} );
}

/**
 * Re-register the custom-gradient wallpaper WITH its `renderEditor`
 * callback attached. Called by the OS Settings panel bundle on load,
 * so the editor's component-heavy code path only ships in that
 * lazy bundle and never reaches `desktop.min.js`.
 */
export function attachCustomGradientEditor( ctx: SettingsCtx ): void {
	registry.register( {
		id: CUSTOM_GRADIENT_ID,
		label: __( 'Custom gradient' ),
		type: 'css',
		preview: customGradientCss( ctx.state ),
		description: CUSTOM_GRADIENT_DESCRIPTION(),
		resolveValue: () => customGradientCss( ctx.state ),
		renderEditor: ( container ) =>
			renderCustomGradientEditor( ctx, container ),
	} );
}

/**
 * Register or update the custom-image wallpaper based on current state.
 * Called on boot and after every upload/library pick/remove action so
 * the registry entry tracks `state.customImage`.
 */
export function registerCustomImageIfPresent( state: OsSettingsState ): void {
	if ( ! state.customImage ) {
		registry.unregister( CUSTOM_IMAGE_ID );
		return;
	}
	const safeUrl = encodeURI( state.customImage.url );
	const value = `url("${ safeUrl }") center/cover no-repeat, #1d2327`;
	registry.register( {
		id: CUSTOM_IMAGE_ID,
		label: __( 'Custom image' ),
		type: 'css',
		value,
		preview: value,
		description: __(
			'Any image from your media library or an upload, sized to cover the whole desk.',
		),
	} );
}

/**
 * Select a wallpaper by id. Updates state, persists, applies to the
 * shell, refreshes the grid's aria-pressed attributes, and swaps the
 * description card to the new selection.
 */
export function selectWallpaper(
	ctx: SettingsCtx,
	id: string,
	body: HTMLElement,
): void {
	ctx.state.wallpaper = id;
	ctx.save();
	ctx.apply();
	refreshWallpaperPressedState( ctx, body );
	const slot = body.querySelector<HTMLElement>(
		'.os-settings__wallpaper-description-slot',
	);
	if ( slot ) {
		syncWallpaperDescription( ctx, slot );
	}
	const configSlot = body.querySelector<HTMLElement>(
		'.os-settings__wallpaper-config-slot',
	);
	if ( configSlot ) {
		syncWallpaperConfigButton( ctx, configSlot );
	}
}

/**
 * Render (or collapse) the "Wallpaper settings" button for the active
 * selection. Only wallpapers whose def carries `renderConfig` get the
 * button — for everything else the slot stays collapsed, so the
 * surface is invisible unless the wallpaper opted in.
 */
export function syncWallpaperConfigButton(
	ctx: SettingsCtx,
	slot: HTMLElement,
): void {
	const inner = slot.firstElementChild as HTMLElement | null;
	if ( ! inner ) {
		return;
	}
	const def = registry.get( ctx.state.wallpaper );
	if ( ! def || typeof def.renderConfig !== 'function' ) {
		slot.dataset.expanded = 'false';
		slot.style.marginTop = '';
		return;
	}
	// The expanded margin also lives in os-settings.css, but this
	// surface is reached by lazy-loaded JS in long-lived sessions
	// whose stylesheet predates it — inline the one load-bearing
	// spacing rule so the button never renders flush against the
	// description card above it.
	slot.style.marginTop = '12px';
	render(
		html`
			<div class="os-settings__wallpaper-config">
				<os-button
					variant="secondary"
					@click=${ () => openWallpaperConfigDialog( ctx, def ) }
				>
					<os-icon name="admin-generic"></os-icon>
					${ __( 'Wallpaper settings' ) }
				</os-button>
			</div>
		`,
		inner,
	);
	slot.dataset.expanded = 'true';
}

/**
 * Open the wallpaper's settings dialog: a `<os-modal>` on
 * `document.body` whose body is handed to the def's `renderConfig`.
 * The shell owns the chrome (title, focus trap, Done button, ESC /
 * click-outside); the wallpaper owns the form.
 *
 * The config context's `setSettings` merges into the persisted
 * per-wallpaper bag, saves through the normal OS Settings pipeline,
 * and publishes to the shared store — which fires
 * `os.wallpaper.settings-changed` so a mounted instance of
 * the wallpaper live-applies without a remount.
 */
export function openWallpaperConfigDialog(
	ctx: SettingsCtx,
	def: WallpaperDef,
): void {
	if ( typeof def.renderConfig !== 'function' ) {
		return;
	}

	const modal = document.createElement( 'os-modal' );
	modal.setAttribute( 'size', 'sm' );
	modal.setAttribute(
		'title',
		sprintf(
			/* translators: %s: wallpaper name. */
			__( '%s settings' ),
			def.label,
		),
	);

	const body = document.createElement( 'div' );
	body.className = 'os-settings__wallpaper-config-form';
	// Same class exists in os-settings.css, but the dialog opens from
	// lazy-loaded JS in sessions whose stylesheet may predate this
	// surface — without the column layout the fields flow inline and
	// the form is unreadable. Inline the critical rules so the dialog
	// is correct in every session; the stylesheet adds the finish.
	body.style.display = 'flex';
	body.style.flexDirection = 'column';
	body.style.gap = '14px';
	modal.appendChild( body );

	const done = document.createElement( 'os-button' );
	done.setAttribute( 'slot', 'footer' );
	done.setAttribute( 'variant', 'primary' );
	done.textContent = __( 'Done' );
	modal.appendChild( done );

	let configTeardown: WallpaperTeardown | null = null;
	let closed = false;
	const close = (): void => {
		if ( closed ) {
			return;
		}
		closed = true;
		if ( configTeardown ) {
			try {
				configTeardown();
			} catch ( err ) {
				if ( typeof console !== 'undefined' ) {
					console.error(
						`[openstation] Wallpaper "${ def.id }" config teardown threw:`,
						err,
					);
				}
			}
			configTeardown = null;
		}
		modal.remove();
	};
	done.addEventListener( 'click', close );
	modal.addEventListener( 'os-modal-cancel', close );

	const configCtx: WallpaperConfigContext = {
		id: def.id,
		pluginUrl: '',
		prefersReducedMotion:
			typeof window.matchMedia === 'function' &&
			window.matchMedia( '( prefers-reduced-motion: reduce )' ).matches,
		visible: ! document.hidden,
		settings: getWallpaperSettings( def.id ),
		setSettings: ( partial ) => {
			const merged: WallpaperSettings = {
				...( ctx.state.wallpaperSettings[ def.id ] ?? {} ),
				...partial,
			};
			ctx.state.wallpaperSettings[ def.id ] = merged;
			ctx.save();
			publishWallpaperSettings( def.id, merged );
		},
	};

	document.body.appendChild( modal );
	modal.setAttribute( 'open', '' );

	try {
		const result = def.renderConfig( body, configCtx );
		if ( isPromise( result ) ) {
			result.then( ( teardown: WallpaperTeardown ) => {
				if ( closed ) {
					// The user closed the dialog before the async render
					// resolved — release immediately.
					try {
						teardown();
					} catch {
						/* best-effort */
					}
					return;
				}
				configTeardown = teardown;
			} );
		} else {
			configTeardown = result;
		}
	} catch ( err ) {
		if ( typeof console !== 'undefined' ) {
			console.error(
				`[openstation] Wallpaper "${ def.id }" renderConfig threw:`,
				err,
			);
		}
		close();
	}
}

/**
 * Render the active wallpaper's description card into its slot — the
 * "what am I looking at?" a swatch can't tell. Collapses when the
 * selection carries no description; expands with the same
 * grid-template-rows animation the editor slot uses.
 *
 * The card is `<os-*>`-built: an icon column beside the wallpaper's
 * name and its story, on a `os-panel`-rhythm surface.
 */
export function syncWallpaperDescription(
	ctx: SettingsCtx,
	slot: HTMLElement,
): void {
	const inner = slot.firstElementChild as HTMLElement | null;
	if ( ! inner ) {
		return;
	}
	const def = registry.get( ctx.state.wallpaper );
	const text = ( def?.description ?? '' ).trim();
	if ( ! def || ! text ) {
		slot.dataset.expanded = 'false';
		return;
	}
	render(
		html`
			<div class="os-settings__wallpaper-description">
				<div class="os-settings__wallpaper-description-header">
					<os-icon
						class="os-settings__wallpaper-description-icon"
						name=${ def.type === 'canvas' ? 'star-filled' : 'art' }
					></os-icon>
					<strong>${ def.label }</strong>
				</div>
				<p>${ text }</p>
			</div>
		`,
		inner,
	);
	slot.dataset.expanded = 'true';
}

/**
 * Re-apply aria-pressed + the `selected` attribute across every tile
 * matching `[data-wallpaper-id]` in the panel. Used when the selection
 * changes via a code path that doesn't re-render the full grid (e.g.,
 * remove-custom-image, library-tile pick).
 */
export function refreshWallpaperPressedState(
	ctx: SettingsCtx,
	body: HTMLElement,
): void {
	body.querySelectorAll<HTMLElement>( '[data-wallpaper-id]' ).forEach( ( el ) => {
		const selected = el.dataset.wallpaperId === ctx.state.wallpaper;
		// `<os-swatch>` drives its inner aria-pressed from the
		// `selected` host attribute; upload-tile (still hand-rolled
		// for the drag/drop surface) uses aria-pressed directly, so
		// we set both — whichever the element cares about applies.
		if ( selected ) {
			el.setAttribute( 'selected', '' );
		} else {
			el.removeAttribute( 'selected' );
		}
		el.setAttribute( 'aria-pressed', selected ? 'true' : 'false' );
	} );
}

/**
 * Mount the given wallpaper's editor into the editor slot, tearing
 * down any prior editor first. If the wallpaper has no editor, the
 * slot collapses.
 *
 * Every mount gets a brand-new inner container. Recycling the previous
 * element looks equivalent, but breaks any editor that keeps
 * per-container state keyed on element identity — the framework's own
 * `render()` caches its mounted parts per container, so a cleared-then-
 * reused element would take the update fast path against detached
 * nodes and paint nothing (that was the "custom gradient can't be
 * edited after switching away and back" bug). Third-party editors
 * built on lit-html carry the same per-container cache. A fresh
 * element also can't leak the previous editor's classes.
 */
export function syncEditorSlot(
	ctx: SettingsCtx,
	slot: HTMLElement,
	def: WallpaperDef,
): void {
	teardownEditor( ctx );
	const inner = document.createElement( 'div' );
	inner.className = 'os-settings__editor-slot-inner';
	slot.textContent = '';
	slot.appendChild( inner );

	if ( ! def.renderEditor ) {
		slot.dataset.expanded = 'false';
		return;
	}

	const editorCtx = {
		id: def.id,
		pluginUrl: '',
		prefersReducedMotion:
			typeof window.matchMedia === 'function' &&
			window.matchMedia( '( prefers-reduced-motion: reduce )' ).matches,
		visible: ! document.hidden,
		settings: getWallpaperSettings( def.id ),
	};

	try {
		const result = def.renderEditor( inner, editorCtx );
		if ( isPromise( result ) ) {
			result.then( ( teardown: WallpaperTeardown ) => {
				ctx.activeEditorTeardown = teardown;
			} );
		} else {
			ctx.activeEditorTeardown = result;
		}
	} catch ( err ) {
		if ( typeof console !== 'undefined' ) {
			console.error(
				`[openstation] Wallpaper "${ def.id }" renderEditor threw:`,
				err,
			);
		}
	}

	slot.dataset.expanded = 'true';
}

export function teardownEditor( ctx: SettingsCtx ): void {
	if ( ctx.activeEditorTeardown ) {
		try {
			ctx.activeEditorTeardown();
		} catch ( err ) {
			if ( typeof console !== 'undefined' ) {
				console.error(
					'[openstation] Wallpaper editor teardown threw:',
					err,
				);
			}
		}
		ctx.activeEditorTeardown = null;
	}
}

/**
 * `renderEditor` implementation for the built-in custom-gradient
 * wallpaper. Color + angle inputs write to state; every change updates
 * the swatch preview and re-applies.
 */
export function renderCustomGradientEditor(
	ctx: SettingsCtx,
	container: HTMLElement,
): WallpaperTeardown {
	container.classList.add( 'os-settings__gradient-editor-inner' );

	const onFrom = ( e: Event ): void => {
		ctx.state.customGradient.from = ( e as CustomEvent ).detail.value;
		onChange();
	};
	const onTo = ( e: Event ): void => {
		ctx.state.customGradient.to = ( e as CustomEvent ).detail.value;
		onChange();
	};
	const onAngle = ( e: Event ): void => {
		ctx.state.customGradient.angle = ( e as CustomEvent ).detail.value;
		onChange();
	};
	const onChange = (): void => {
		ctx.save();
		ctx.apply();
		syncGradientPreviewSwatch( ctx, container );
		paint();
	};

	const paint = (): void =>
		render(
			html`
				<div class="os-settings__gradient-row">
					<os-color-field
						variant="block"
						label=${ __( 'From' ) }
						value=${ ctx.state.customGradient.from }
						@os-color-change=${ onFrom }
					></os-color-field>
					<os-color-field
						variant="block"
						label=${ __( 'To' ) }
						value=${ ctx.state.customGradient.to }
						@os-color-change=${ onTo }
					></os-color-field>
				</div>
				<os-range-field
					label=${ __( 'Angle' ) }
					min="0"
					max="360"
					step="1"
					suffix="°"
					value=${ String( ctx.state.customGradient.angle ) }
					@os-range-change=${ onAngle }
				></os-range-field>
			`,
			container,
		);
	paint();

	// Empty teardown — the editor holds no long-lived resources
	// (timers, observers) and the container is cleared by the slot.
	return () => {
		/* noop */
	};
}

function syncGradientPreviewSwatch(
	ctx: SettingsCtx,
	editorEl: HTMLElement,
): void {
	// The gradient editor is mounted inside the wallpaper `<os-section>`'s
	// slot, alongside the swatch grid. Walking up to the os-section and
	// querying for the custom-gradient swatch finds it regardless of DOM
	// shuffles from a future refactor of the wallpaper section's
	// internals.
	const section = editorEl.closest( 'os-section' );
	const preview = section?.querySelector<HTMLElement>(
		`[data-wallpaper-id="${ CUSTOM_GRADIENT_ID }"]`,
	);
	if ( preview ) {
		preview.style.background = customGradientCss( ctx.state );
	}
}

/**
 * The live-preview manager for the CURRENT wallpaper section build.
 * Module-level so a panel re-render (Reset to defaults, tab registry
 * change) disposes the previous build's previews before creating the
 * next — the old wrapper is silently dropped from the DOM on that
 * path, and nothing else would release its WebGL contexts.
 */
let activePreviewManager: WallpaperPreviewManager | null = null;

export function buildWallpaperSection(
	ctx: SettingsCtx,
	body: HTMLElement,
): HTMLElement {
	// Editor slot: a stable DOM position where the currently-selected
	// wallpaper's `renderEditor` output lives. Uses the same
	// `data-expanded` collapsing pattern the old gradient editor used
	// (CSS animates grid-template-rows 0fr ↔ 1fr). Kept as imperative
	// DOM refs because `renderEditor` contracts with third-party
	// plugins receive a plain `HTMLElement` — no templating, just a
	// container they can own. `syncEditorSlot` replaces the inner
	// element on every mount; this initial one just keeps the collapsed
	// slot's grid row populated until the first sync.
	const editorSlot = document.createElement( 'div' );
	editorSlot.className = 'os-settings__editor-slot';
	editorSlot.dataset.expanded = 'false';
	const editorInner = document.createElement( 'div' );
	editorInner.className = 'os-settings__editor-slot-inner';
	editorSlot.appendChild( editorInner );

	// Description slot: same collapsing pattern, hosting the selected
	// wallpaper's description card (see syncWallpaperDescription).
	const descriptionSlot = document.createElement( 'div' );
	descriptionSlot.className =
		'os-settings__wallpaper-description-slot';
	descriptionSlot.dataset.expanded = 'false';
	const descriptionInner = document.createElement( 'div' );
	descriptionInner.className =
		'os-settings__wallpaper-description-slot-inner';
	descriptionSlot.appendChild( descriptionInner );

	// Config slot: same collapsing pattern, hosting the "Wallpaper
	// settings" button when the selected wallpaper ships a
	// `renderConfig` dialog (see syncWallpaperConfigButton).
	const configSlot = document.createElement( 'div' );
	configSlot.className = 'os-settings__wallpaper-config-slot';
	configSlot.dataset.expanded = 'false';
	const configInner = document.createElement( 'div' );
	configInner.className =
		'os-settings__wallpaper-config-slot-inner';
	configSlot.appendChild( configInner );

	const onPick = ( e: Event ): void => {
		const id = ( ( e as CustomEvent ).detail?.value ?? '' ) as string;
		const def = registry.get( id );
		if ( ! def || def.id === CUSTOM_IMAGE_ID ) {
			return;
		}
		selectWallpaper( ctx, def.id, body );
		syncEditorSlot( ctx, editorSlot, def );
		paint();
	};

	// The swatch grid is templated; the editor slot + custom-image
	// section are DOM refs threaded in as nodes.
	const customImageSection = buildCustomImageSection( ctx, body );
	const wrapper = document.createElement( 'div' );

	// One preview manager per section build; the previous build's
	// manager (if any) is disposed so its previews can't leak.
	activePreviewManager?.dispose();
	const previewManager = createWallpaperPreviewManager( wrapper );
	activePreviewManager = previewManager;

	const paint = (): void =>
		render(
			html`
				<os-section
					heading=${ __( 'Wallpaper' ) }
					description=${ __(
		'The backdrop behind your windows. Pick a preset, mix your own gradient, or drop in an image.',
	) }
				>
					<div
						class="os-settings__grid os-settings__grid--wallpapers"
						@os-pick=${ onPick }
					>
						${ registry
		.all()
		.filter( ( def ) => def.id !== CUSTOM_IMAGE_ID )
		.map(
			( def ) => html`<os-swatch
									value=${ def.id }
									label=${ def.label }
									preview=${ def.preview }
									variant="wallpaper"
									data-wallpaper-id=${ def.id }
									?selected=${ ctx.state.wallpaper === def.id }
								>
									<span class="os-settings__swatch-label"
										>${ def.label }</span
									>
								</os-swatch>`,
		) }
					</div>
					${ descriptionSlot } ${ configSlot } ${ editorSlot }
					${ customImageSection }
				</os-section>
			`,
			wrapper,
		);
	paint();
	previewManager.sync();

	// Initial editor + description state — mounted for the active
	// wallpaper before the section enters the live DOM so the expansion
	// doesn't animate on panel open.
	const active = registry.get( ctx.state.wallpaper );
	if ( active ) {
		syncEditorSlot( ctx, editorSlot, active );
	}
	syncWallpaperDescription( ctx, descriptionSlot );
	syncWallpaperConfigButton( ctx, configSlot );

	// Live-update when plugins register or unregister wallpapers
	// mid-session. The server-sync module fires register()/unregister()
	// when `os-plugins-changed` arrives from a plugins.php
	// iframe; we re-paint so the swatch grid reflects reality without
	// the user having to close and re-open the settings window.
	//
	// Self-unsubscribes when the wrapper is no longer in the DOM (the
	// panel has been torn down), so stale listeners don't pile up
	// across repeated settings-window opens.
	const unsubscribe = registry.subscribe( () => {
		if ( ! wrapper.isConnected ) {
			unsubscribe();
			previewManager.dispose();
			return;
		}
		paint();
		previewManager.sync();
		// Re-sync the editor + description slots too, in case the
		// currently active wallpaper's def just arrived (plugin
		// activation with the user's saved selection pointing at the
		// new wallpaper).
		const now = registry.get( ctx.state.wallpaper );
		if ( now ) {
			syncEditorSlot( ctx, editorSlot, now );
		}
		syncWallpaperDescription( ctx, descriptionSlot );
		syncWallpaperConfigButton( ctx, configSlot );
	} );

	return wrapper;
}
