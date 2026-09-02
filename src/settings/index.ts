/**
 * OpenStation — the Preferences store.
 *
 * Shell-level preferences that live outside WordPress: wallpaper, accent
 * color, dock size, layout, the feature switches, and everything else
 * OpenStation Preferences edits. Persisted to user meta through a
 * debounced REST sync with a localStorage read cache (`state.ts`), and
 * applied through the wallpaper layer + CSS custom properties on the
 * desktop shell so every downstream rule (title bars, dock chips, focus
 * rings, window chrome) inherits the new values without per-rule
 * plumbing.
 *
 * This is the STORE, not the panel. The Preferences window is an App
 * Framework app (`apps/os-settings/`) that reads the store through
 * `wp.os.getOsSettings()` and writes it through `wp.os.updateOsSettings()`
 * — the same public API a third-party settings tab uses — because the
 * store has to apply before the first paint and outlives any window.
 * Every other writer (the Mio tile, the close-all dialog, the
 * right-click navigation menu, `wp.os.updateOsSettings()`) lands here
 * too, so there is one apply pass and one save pipeline.
 *
 * Wallpapers are registry-driven: built-in presets live in
 * `src/wallpapers/built-in.ts`, the two state-derived ones
 * (`custom-gradient`, `custom-image`) in `./wallpaper-defs.ts`, and
 * third-party plugins register via `wp.os.registerWallpaper()`.
 */

import type { WallpaperLayer } from '../wallpapers/layer';
import * as registry from '../wallpapers/registry';
import { seedWallpaperSettings } from '../wallpapers/settings-store';
import {
	ADMIN_BAR_MODES,
	CUSTOM_ACCENT_ID,
	DEFAULT_WALLPAPER_ID,
	DOCK_BEHAVIORS,
	DOCK_SIZES,
	OS_SETTINGS_WINDOW_ID,
	WINDOW_RADII,
	getAccents,
	getDefaultWallpaperId,
} from './constants';
import { refreshWorkArea } from '../work-area';
import {
	DOCK_BEHAVIOR_ATTR,
	PRIMARY_DOCK_ID,
	refreshDockBehavior,
	SIDE_DOCK_ID,
} from '../dock-behavior';
import {
	cloneState,
	loadState,
	OS_SETTINGS_KEYS,
	PRESENTATION_KEYS,
	sanitizeSettings,
	saveState,
	structuredDefaults,
	type OsSettingsSaveLifecycleDetail,
} from './state';
import { setActiveDockRailRenderer } from '../dock-rail';
import { applyDesktopTheme } from '../desktop-themes/apply';
import { notifyServiceWorkerPrewarm } from '../pwa/sw-register';
import { applyThemeRecommendations } from './theme-recommendations';
import type { RecommendedOsSettings } from '../desktop-themes';
import type { OsSettingsState } from './types';
import type { OsSettingsSnapshot } from './registry';
import {
	registerCustomGradient,
	registerCustomImageIfPresent,
} from './wallpaper-defs';

/** Options for {@link OsSettings.update}. */
export interface OsSettingsUpdateOptions {
	/** Attribute the in-flight save to a window's activity dot. */
	windowId?: string;
}

/**
 * The Preferences store.
 *
 * Single instance per shell. Owns the persisted state, delegates
 * wallpaper painting to the {@link WallpaperLayer}, applies every
 * presentation key to the shell, and notifies subscribers on change.
 */
/**
 * A copy of a settings patch deep enough that no object inside it is
 * shared with the original. Every value a settings key can hold is
 * JSON-shaped (the state round-trips through `JSON.stringify` to the
 * server), so a JSON clone is exact rather than approximate.
 */
function cloneSettingsPatch< T extends Partial< OsSettingsState > >( patch: T ): T {
	return JSON.parse( JSON.stringify( patch ) ) as T;
}

/**
 * Whether two settings values are the same VALUE — scalars by
 * equality, objects by shape. Identity is the wrong test for the
 * object-valued keys: the wallpaper settings editor edits in place,
 * so an edited record can share its reference with an untouched one.
 */
function sameSettingsValue( a: unknown, b: unknown ): boolean {
	if ( a === b ) {
		return true;
	}
	if ( 'object' !== typeof a || 'object' !== typeof b || null === a || null === b ) {
		return false;
	}
	return JSON.stringify( a ) === JSON.stringify( b );
}

export class OsSettings {
	public state: OsSettingsState;
	public layer: WallpaperLayer;

	/**
	 * Subscribers to Preferences changes — the Preferences app, the
	 * engines that read a key at use time (unfocus effects, window
	 * links, the navigation model), and third-party tabs. Fired from
	 * {@link save}.
	 */
	private listeners = new Set<( snapshot: OsSettingsSnapshot ) => void>();

	constructor( layer: WallpaperLayer ) {
		this.layer = layer;
		// `loadState()` primes the rollback + diff baseline itself,
		// but only when it read the state out of user meta. Priming
		// it unconditionally from here was the bug: with the server
		// snapshot absent, the boot state comes from the localStorage
		// cache, which can hold values a previous session never got
		// as far as saving — and a baseline that claims those are
		// confirmed is a baseline that never sends them.
		this.state = loadState();

		// Auto-rollback on save failure — restore the in-memory state
		// to the last server-confirmed snapshot and tell every
		// subscriber, so the Preferences app repaints with the
		// controls visually reverted. Without this, the optimistic UI
		// lies: the user toggles a setting offline, the save fails,
		// and the toggle stays in its (incorrect) flipped position
		// until a manual reload reconciles with the server.
		document.addEventListener(
			'os-settings-save-lifecycle',
			( e: Event ) => {
				const detail = ( e as CustomEvent< OsSettingsSaveLifecycleDetail > )
					.detail;
				if ( ! detail ) {
					return;
				}
				const manager = window.wp?.os?.windowManager;
				manager
					?.getById( OS_SETTINGS_WINDOW_ID )
					?.markActivity( detail.phase, { error: detail.error } );
				if ( detail.phase !== 'failed' || ! detail.rolledBackTo ) {
					return;
				}
				this.state = detail.rolledBackTo;
				this.apply();
				this.notify();
			},
		);

		// The state-derived built-in wallpapers, registered here
		// because their values close over this instance's state.
		registerCustomGradient( () => this.state );
	}

	/** A defensive copy of the state — the public snapshot. */
	public getOsSettingsSnapshot(): OsSettingsSnapshot {
		return cloneState( this.state );
	}

	public subscribeOsSettings(
		cb: ( snapshot: OsSettingsSnapshot ) => void,
	): () => void {
		this.listeners.add( cb );
		return () => {
			this.listeners.delete( cb );
		};
	}

	/**
	 * Apply the current state: wallpaper via the layer, accent + dock
	 * size as CSS custom properties on the shell.
	 *
	 * Safe to call repeatedly — calls into `layer.apply` dedupe via
	 * generation counter; CSS property writes are idempotent.
	 */
	public apply(): void {
		const shell = document.getElementById( 'os-shell' );
		if ( ! shell ) {
			return;
		}

		// Mirror the persisted per-wallpaper settings into the shared
		// runtime store BEFORE the layer mounts anything, so the mount's
		// `ctx.settings` reads the user's saved values. apply() runs on
		// boot, on every settings change, and after a save-failure
		// rollback — re-seeding on each covers all three paths.
		seedWallpaperSettings( this.state.wallpaperSettings );

		// The uploaded-image wallpaper exists exactly while the state
		// names one. Idempotent, so the registry only wakes when the
		// image actually changed.
		registerCustomImageIfPresent( this.state );

		// Wallpaper — look up in the registry. Fall back to the
		// server-declared default id (via `openstation_default_wallpaper`)
		// if the saved wallpaper was registered by a plugin that's no
		// longer loaded, then to the TS compile-time default as a last
		// resort.
		const def =
			registry.get( this.state.wallpaper ) ||
			registry.get( getDefaultWallpaperId() ) ||
			registry.get( DEFAULT_WALLPAPER_ID ) ||
			registry.all()[ 0 ];
		if ( def ) {
			this.layer.apply( def );
		}

		const accents = getAccents();
		/*
		 * Custom resolves from state, not from the list: it is the one
		 * accent with no fixed value, so a lookup would miss it and
		 * fall through to the first preset. Checked before the lookup
		 * rather than after, because the fallback that catches an
		 * unknown id is the same expression and would swallow it.
		 */
		const preset =
			accents.find( ( a ) => a.id === this.state.accent ) ?? accents[ 0 ];
		const accentValue =
			this.state.accent === CUSTOM_ACCENT_ID
				? this.state.customAccent
				: preset.value;
		const dockSize =
			DOCK_SIZES.find( ( d ) => d.id === this.state.dockSize ) ?? DOCK_SIZES[ 1 ];
		const windowRadius =
			WINDOW_RADII.find( ( r ) => r.id === this.state.windowRadius ) ??
			WINDOW_RADII[ 1 ];

		// Set on <body> rather than the shell so the cascade reaches
		// siblings of #os-shell — specifically the WordPress
		// admin bar, which needs --os-dock-width to size its
		// leftmost (W-logo) slot in visual alignment with the dock
		// below it. Shell-scoped variables cascade to shell children
		// only; everything the shell page renders is inside <body>.
		//
		// <body> specifically, not <html>, and that is load-bearing:
		// the brand palette declares `--wp-admin-theme-color` on
		// `body.os-active` (see `variables.css`, which is
		// scoped there so it cannot leak into iframe documents). A
		// custom property inherits from the NEAREST ancestor that has
		// one, regardless of the specificity behind it — so a value
		// written on <html> would lose to that rule for everything
		// inside the body, and the accent picker would appear to do
		// nothing. On the same element, an inline style always wins.
		const root = document.body;
		root.style.setProperty( '--wp-admin-theme-color', accentValue );
		// The control kit paints its on states and selection rings from
		// `--os-ui-accent` — switches, checkboxes, radios, sliders, the
		// segmented pill, the swatch ring. The palette declares it at
		// Pulse, and that declaration stays the brand's; this inline
		// write is the user's pick, and without it choosing an accent
		// moves the title bars and leaves every control pink.
		root.style.setProperty( '--os-ui-accent', accentValue );
		/*
		 * The ambient layer resolves one step back through
		 * `--os-ui-accent-dim` — the dock divider, the selected
		 * sidebar row's wash and bloom, every glow. It has to move
		 * with the pick too, or the station stays pink around a teal
		 * control.
		 *
		 * Pulse keeps the palette's own value rather than a derived
		 * one: the brand mixes its dim by hand, pulling saturation
		 * and lightness down together, and no single step reproduces
		 * that pair. Every other accent gets the darkening step,
		 * which is what "one step back" means for a colour we were
		 * handed rather than given a twin for.
		 */
		const BRAND_ACCENT = '#f252fc';
		const accentDim =
			accentValue.toLowerCase() === BRAND_ACCENT
				? null
				: `color-mix( in srgb, ${ accentValue } 88%, #000 )`;
		if ( accentDim === null ) {
			root.style.removeProperty( '--os-ui-accent-dim' );
		} else {
			root.style.setProperty( '--os-ui-accent-dim', accentDim );
		}
		/*
		 * And again on the shell, for the same reason `--os-window-radius`
		 * is written twice below: a desktop theme declares its own
		 * `--os-ui-accent` on `.os-shell[data-os-desktop-theme="…"]`,
		 * which is a NEARER ancestor of every control than <body> is.
		 * Legacy ships `#2271b1`, so with a theme worn the write above
		 * reaches nothing inside the shell and picking Teal left every
		 * control WordPress blue while the derived `-dim` wash went teal:
		 * one pick, two answers, from the same click.
		 *
		 * An inline style on the shell outranks any selector, so the
		 * user's pick is authoritative in both places.
		 */
		shell.style.setProperty( '--os-ui-accent', accentValue );
		if ( accentDim === null ) {
			shell.style.removeProperty( '--os-ui-accent-dim' );
		} else {
			shell.style.setProperty( '--os-ui-accent-dim', accentDim );
		}
		root.style.setProperty( '--os-dock-width', `${ dockSize.width }px` );
		root.style.setProperty( '--os-dock-icon-size', `${ dockSize.icon }px` );
		// And on the shell, for the reason the accent is written twice
		// above and the radius twice below: a desktop theme declares
		// both dock tokens on the shell root — Legacy ships `56px` and
		// `20px` — and that is a nearer ancestor of the dock than
		// <body>. With a theme worn, the writes above reached the admin
		// bar's logo slot and nothing else, and picking Large in
		// Preferences moved the dock not at all. Inline on the shell,
		// the user's pick outranks the theme's selector; the body write
		// stays, because the admin bar is the shell's sibling.
		shell.style.setProperty( '--os-dock-width', `${ dockSize.width }px` );
		shell.style.setProperty( '--os-dock-icon-size', `${ dockSize.icon }px` );
		root.style.setProperty(
			'--os-window-radius',
			`${ windowRadius.value }px`,
		);
		// ALSO on the shell element, and this one is not redundant.
		//
		// A desktop theme may declare `--os-window-radius`
		// in its `tokens`, and the compiled stylesheet writes it on
		// `.os-shell[data-os-desktop-theme="…"]`
		// and `body.os-desktop-theme-…`. Both of those
		// MATCH an ancestor of every window, while the `:root` write
		// above only reaches windows by inheritance — so the theme
		// would win and the Window-corners preset would silently do
		// nothing for as long as that theme was worn.
		//
		// An inline style on the shell outranks any selector, so the
		// user's pick is authoritative. A theme that wants a
		// particular radius asks for it through
		// `recommendedOsSettings.windowRadius`, which sets the user's
		// preference once and leaves it theirs to change.
		shell.style.setProperty(
			'--os-window-radius',
			`${ windowRadius.value }px`,
		);

		// Admin-bar mode — a body class rather than a shell-scoped
		// attribute, because the thing it styles (`#wpadminbar`) is a
		// SIBLING of the shell, not a descendant. PHP writes the same
		// class on `admin_body_class` so the first paint is already
		// correct; re-writing it here is what makes a pick in
		// Preferences take effect without a reload.
		const adminBarMode =
			ADMIN_BAR_MODES.find( ( m ) => m.id === this.state.adminBarMode ) ??
			ADMIN_BAR_MODES[ 0 ];
		for ( const mode of ADMIN_BAR_MODES ) {
			document.body.classList.toggle(
				`os-admin-bar-${ mode.id }`,
				mode.id === adminBarMode.id,
			);
		}

		// Dock behavior — one `data-os-dock-behavior` attribute PER
		// RAIL rather than a body class, because the Split layout's
		// sidebar and bottom dock answer independently. PHP stamps
		// the dock for the first paint; this re-stamps both so a pick
		// lands live, `src/dock-behavior.ts` re-stamps whenever the
		// dispatcher rebuilds a rail, `dock.css` folds a rail off the
		// attribute, and the work area stops reserving a dynamic
		// rail's band — which is why it is re-measured right after.
		const behaviorOf = ( id: string ): string =>
			( DOCK_BEHAVIORS.find( ( b ) => b.id === id ) ?? DOCK_BEHAVIORS[ 0 ] ).id;
		document
			.getElementById( PRIMARY_DOCK_ID )
			?.setAttribute( DOCK_BEHAVIOR_ATTR, behaviorOf( this.state.dockBehavior ) );
		document
			.getElementById( SIDE_DOCK_ID )
			?.setAttribute( DOCK_BEHAVIOR_ATTR, behaviorOf( this.state.sideDockBehavior ) );
		refreshDockBehavior();
		refreshWorkArea();

		// Desktop layout is driven by an attribute on the shell root;
		// the layout dispatcher (desktop.ts) reads it on init and on
		// every settings change to rebuild the dock(s). Written here so
		// every apply() is the single source of truth — no matter how
		// the state got to this point (init from localStorage, picker
		// change, reset).
		shell.setAttribute(
			'data-os-layout',
			this.state.desktopLayout,
		);

		// Dock rail renderer pick — push into the registry so the
		// dispatcher rebuilds the rails when the resolved renderer
		// changes. Doing this from `apply()` (rather than only on
		// settings save) covers the boot path: state loads from
		// server / localStorage, `apply()` runs, registry mirrors
		// the persisted choice.
		setActiveDockRailRenderer( this.state.dockRailRenderer );

		// Desktop theme. One line covers every path that can change
		// it — boot, picking a theme in the Themes tab, resetting
		// settings, and the rollback after a failed save all funnel
		// through `apply()`. `applyDesktopTheme` dedupes on the active
		// id, so the repeated calls this makes cost two comparisons.
		applyDesktopTheme( this.state.desktopTheme );
	}

	/**
	 * The user's own settings, before any workspace override, or `null`
	 * when none is active.
	 *
	 * The whole reason a workspace can repaint the desk without editing
	 * anything: `state` becomes the overridden view, this keeps what to
	 * hand back on the way out, and {@link save} writes from here.
	 */
	private baseState: OsSettingsState | null = null;

	/** The active override itself, for {@link save} to compare against. */
	private overridePatch: Partial< OsSettingsState > | null = null;

	/**
	 * Paint the desk with a workspace's appearance, or hand it back.
	 *
	 * A view, never a write. The user's settings survive intact in
	 * {@link baseState} and go back on screen the moment they leave the
	 * workspace — the same rule the navigation and the widget column
	 * follow, and for the same reason: a workspace they delete must
	 * cost them nothing.
	 *
	 * Re-entrant by design. Switching straight from one overridden desk
	 * to another restores the base first, so the second workspace's
	 * patch lands on the user's settings rather than on the first
	 * workspace's.
	 *
	 * @param patch Sparse appearance patch, or `null` to restore.
	 */
	public setWorkspaceAppearance(
		patch: Partial< OsSettingsState > | null,
	): void {
		const base = this.baseState ?? this.state;
		const empty = ! patch || Object.keys( patch ).length === 0;
		if ( empty ) {
			// Nothing to restore and nothing to apply — a plain Space
			// following a plain Space, which is most switches.
			if ( ! this.baseState ) {
				return;
			}
			this.state = base;
			this.baseState = null;
			this.overridePatch = null;
		} else {
			this.baseState = base;
			// Two copies of every object-valued key — one on the state
			// the panel edits, one kept aside to compare against at
			// save time. With ONE object shared between them, an edit
			// made in place (the wallpaper settings editor merges into
			// `wallpaperSettings[ id ]` rather than replacing it) would
			// change both at once, the comparison would still say
			// "untouched", and the user's edit would be dropped on save.
			this.overridePatch = cloneSettingsPatch( patch );
			this.state = { ...base, ...cloneSettingsPatch( patch ) };
		}
		this.apply();
		// A Preferences window already on screen is showing the values
		// that just changed under it; it subscribes, so this is what
		// repaints it.
		this.notify();
	}

	/**
	 * Persist the current state (localStorage now, user meta after the
	 * debounce) and tell every subscriber. The path for a writer that
	 * edited `state` in place; {@link update} is the path for a patch.
	 *
	 * With a workspace appearance active, an overridden key is written
	 * back as the USER's value, not the workspace's — unless they
	 * changed it since, in which case that edit is theirs and is saved.
	 * Without this, opening Preferences on a Woo desk and pressing save
	 * would quietly adopt the workspace's wallpaper as the user's own.
	 * {@link update} and {@link reset} land here too, so the rule holds
	 * for every write.
	 */
	public save( opts: OsSettingsUpdateOptions = {} ): void {
		saveState( this._persistableState(), opts );
		this.notify();
	}

	/** {@link state}, with untouched workspace overrides unwound. */
	private _persistableState(): OsSettingsState {
		const base = this.baseState;
		const patch = this.overridePatch;
		if ( ! base || ! patch ) {
			return this.state;
		}
		// `Record<string, unknown>` for the write: indexing a mapped
		// union by a runtime key narrows the assignable type to
		// `never`, and there is no key-by-key form of this loop that
		// does not restate the whole settings schema.
		const out = { ...this.state } as unknown as Record< string, unknown >;
		const source = patch as Record< string, unknown >;
		const original = base as unknown as Record< string, unknown >;
		for ( const key of Object.keys( source ) ) {
			// Still holding exactly what the workspace asked for → the
			// user never touched it, so their own value stands.
			// Anything else is an edit they made on this desk, and it
			// is theirs to keep. Compared by VALUE: the state holds its
			// own copy of each object-valued key (see
			// `setWorkspaceAppearance`), so an edit made in place shows
			// up as a difference and identity would never have.
			if ( sameSettingsValue( out[ key ], source[ key ] ) ) {
				out[ key ] = original[ key ];
			}
		}
		return out as unknown as OsSettingsState;
	}

	/**
	 * Patch the state and persist it — the write behind
	 * `wp.os.updateOsSettings()`, and what the Preferences app calls.
	 *
	 * Every key of `OsSettingsState` is accepted and coerced by the
	 * same sanitizer that reads user meta, with the CURRENT value as
	 * the fallback: an invalid field is ignored, an unknown key never
	 * lands. The one exception is `appliedThemeRecommendations`, the
	 * seeded-theme ledger — shell-owned, because writing it from
	 * outside would let a caller re-arm a theme's one-time seed.
	 *
	 * Activating a theme through here seeds that theme's recommended
	 * settings once, the first time this user wears it, exactly as the
	 * Themes tab does — so the documented
	 * `updateOsSettings( { desktopTheme } )` recipe is a full
	 * activation rather than a bare stylesheet swap.
	 *
	 * Presentation keys are applied, not just saved: a caller that sets
	 * a theme, an accent or a layout sees the change now, not on the
	 * next page load. A patch that touches none of them skips the
	 * apply pass — `unfocusEffect`, the reveals and the window-link
	 * knobs reach their engines through the subscribers `save()` fires.
	 */
	public update(
		patch: Partial< OsSettingsState >,
		opts: OsSettingsUpdateOptions = {},
	): void {
		const incoming: Record< string, unknown > = { ...patch };
		delete incoming.appliedThemeRecommendations;

		const next = sanitizeSettings( incoming, this.state );
		const touched = OS_SETTINGS_KEYS.filter( ( key ) => key in incoming );

		let seeded = false;
		if (
			touched.includes( 'desktopTheme' ) &&
			next.desktopTheme !== this.state.desktopTheme
		) {
			seeded =
				Object.keys( applyThemeRecommendations( next, next.desktopTheme ) )
					.length > 0;
		}

		Object.assign( this.state, next );

		// The running service worker keeps its own copy of the
		// prewarm flag, baked in when it installed; without telling
		// it, turning this on leaves the worker dropping every
		// speculation and turning it off leaves it speculating.
		// `adminAssetCacheEnabled` needs no equivalent — it reaches
		// the worker inside the served `sw.js` bytes, as a normal SW
		// update.
		if ( typeof incoming.windowPrewarmEnabled === 'boolean' ) {
			notifyServiceWorkerPrewarm( incoming.windowPrewarmEnabled );
		}

		this.save( opts );
		if ( seeded || touched.some( ( key ) => PRESENTATION_KEYS.has( key ) ) ) {
			this.apply();
		}
	}

	/**
	 * Re-apply a theme's recommended settings — the deliberate way back
	 * to the author's arrangement after the user has moved things
	 * around, and the ONLY path that applies a recommendation twice.
	 *
	 * @return The keys written; empty when the theme recommends nothing
	 *         this shell can apply.
	 */
	public applyThemeRecommendations( themeId: string ): RecommendedOsSettings {
		const applied = applyThemeRecommendations( this.state, themeId, {
			force: true,
		} );
		if ( Object.keys( applied ).length > 0 ) {
			this.save();
			this.apply();
		}
		return applied;
	}

	/**
	 * Put every preference back to its default — the Preferences
	 * window's Reset button, and `wp.os.resetOsSettings()`.
	 *
	 * The uploaded image survives. It is a pointer at something the
	 * user made, not a preference: putting the wallpaper back to the
	 * default is the visible thing they asked for, and throwing away
	 * the upload on the way would be a second, silent, destructive act
	 * they did not. It stays in the picker, one click from being
	 * chosen again.
	 */
	public reset( opts: OsSettingsUpdateOptions = {} ): void {
		const next = structuredDefaults();
		next.wallpaper = getDefaultWallpaperId();
		next.customImage = this.state.customImage;
		Object.assign( this.state, next );
		this.save( opts );
		this.apply();
	}

	private notify(): void {
		if ( this.listeners.size === 0 ) {
			return;
		}
		const snapshot = this.getOsSettingsSnapshot();
		for ( const cb of Array.from( this.listeners ) ) {
			try {
				cb( snapshot );
			} catch ( err ) {
				if ( typeof console !== 'undefined' ) {
					console.error( '[openstation] os-settings listener threw:', err );
				}
			}
		}
	}
}
