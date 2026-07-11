/**
 * Wallpaper section — registry-driven swatch grid + editor slot +
 * custom-image tabbed picker. Also owns the built-in dynamic wallpaper
 * registrations (`custom-gradient` + `custom-image`) since those close
 * over the OS Settings state they render from.
 */

import { __ } from '../../i18n';
import { html, render } from '../../ui/core';
import * as registry from '../../wallpapers/registry';
import type { WallpaperDef, WallpaperTeardown } from '../../wallpapers/types';
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
		'.desktop-mode-os-settings__wallpaper-description-slot',
	);
	if ( slot ) {
		syncWallpaperDescription( ctx, slot );
	}
}

/**
 * Render the active wallpaper's description card into its slot — the
 * "what am I looking at?" a swatch can't tell. Collapses when the
 * selection carries no description; expands with the same
 * grid-template-rows animation the editor slot uses.
 *
 * The card is `<wpd-*>`-built: an icon column beside the wallpaper's
 * name and its story, on a `wpd-panel`-rhythm surface.
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
			<div class="desktop-mode-os-settings__wallpaper-description">
				<div class="desktop-mode-os-settings__wallpaper-description-header">
					<wpd-icon
						class="desktop-mode-os-settings__wallpaper-description-icon"
						name=${ def.type === 'canvas' ? 'star-filled' : 'art' }
					></wpd-icon>
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
		// `<wpd-swatch>` drives its inner aria-pressed from the
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
 */
export function syncEditorSlot(
	ctx: SettingsCtx,
	slot: HTMLElement,
	inner: HTMLElement,
	def: WallpaperDef,
): void {
	teardownEditor( ctx );
	inner.innerHTML = '';

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
				`[desktop-mode] Wallpaper "${ def.id }" renderEditor threw:`,
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
					'[desktop-mode] Wallpaper editor teardown threw:',
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
	container.classList.add( 'desktop-mode-os-settings__gradient-editor-inner' );

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
				<div class="desktop-mode-os-settings__gradient-row">
					<wpd-color-field
						variant="block"
						label=${ __( 'From' ) }
						value=${ ctx.state.customGradient.from }
						@wpd-color-change=${ onFrom }
					></wpd-color-field>
					<wpd-color-field
						variant="block"
						label=${ __( 'To' ) }
						value=${ ctx.state.customGradient.to }
						@wpd-color-change=${ onTo }
					></wpd-color-field>
				</div>
				<wpd-range-field
					label=${ __( 'Angle' ) }
					min="0"
					max="360"
					step="1"
					suffix="°"
					value=${ String( ctx.state.customGradient.angle ) }
					@wpd-range-change=${ onAngle }
				></wpd-range-field>
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
	// The gradient editor is mounted inside the wallpaper `<wpd-section>`'s
	// slot, alongside the swatch grid. Walking up to the wpd-section and
	// querying for the custom-gradient swatch finds it regardless of DOM
	// shuffles from a future refactor of the wallpaper section's
	// internals.
	const section = editorEl.closest( 'wpd-section' );
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
	// container they can own.
	const editorSlot = document.createElement( 'div' );
	editorSlot.className = 'desktop-mode-os-settings__editor-slot';
	editorSlot.dataset.expanded = 'false';
	const editorInner = document.createElement( 'div' );
	editorInner.className = 'desktop-mode-os-settings__editor-slot-inner';
	editorSlot.appendChild( editorInner );

	// Description slot: same collapsing pattern, hosting the selected
	// wallpaper's description card (see syncWallpaperDescription).
	const descriptionSlot = document.createElement( 'div' );
	descriptionSlot.className =
		'desktop-mode-os-settings__wallpaper-description-slot';
	descriptionSlot.dataset.expanded = 'false';
	const descriptionInner = document.createElement( 'div' );
	descriptionInner.className =
		'desktop-mode-os-settings__wallpaper-description-slot-inner';
	descriptionSlot.appendChild( descriptionInner );

	const onPick = ( e: Event ): void => {
		const id = ( ( e as CustomEvent ).detail?.value ?? '' ) as string;
		const def = registry.get( id );
		if ( ! def || def.id === CUSTOM_IMAGE_ID ) {
			return;
		}
		selectWallpaper( ctx, def.id, body );
		syncEditorSlot( ctx, editorSlot, editorInner, def );
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
				<wpd-section
					heading=${ __( 'Wallpaper' ) }
					description=${ __(
		'The backdrop behind your windows. Pick a preset, mix your own gradient, or drop in an image.',
	) }
				>
					<div
						class="desktop-mode-os-settings__grid desktop-mode-os-settings__grid--wallpapers"
						@wpd-pick=${ onPick }
					>
						${ registry
		.all()
		.filter( ( def ) => def.id !== CUSTOM_IMAGE_ID )
		.map(
			( def ) => html`<wpd-swatch
									value=${ def.id }
									label=${ def.label }
									preview=${ def.preview }
									variant="wallpaper"
									data-wallpaper-id=${ def.id }
									?selected=${ ctx.state.wallpaper === def.id }
								>
									<span class="desktop-mode-os-settings__swatch-label"
										>${ def.label }</span
									>
								</wpd-swatch>`,
		) }
					</div>
					${ descriptionSlot } ${ editorSlot } ${ customImageSection }
				</wpd-section>
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
		syncEditorSlot( ctx, editorSlot, editorInner, active );
	}
	syncWallpaperDescription( ctx, descriptionSlot );

	// Live-update when plugins register or unregister wallpapers
	// mid-session. The server-sync module fires register()/unregister()
	// when `desktop-mode-plugins-changed` arrives from a plugins.php
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
			syncEditorSlot( ctx, editorSlot, editorInner, now );
		}
		syncWallpaperDescription( ctx, descriptionSlot );
	} );

	return wrapper;
}
