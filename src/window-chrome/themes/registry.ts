/**
 * Per-window theme registry — Layer 1 of the window-chrome framework.
 *
 * A **theme** is a named bag of CSS custom properties that the shell
 * applies to a window's outer element via `style.setProperty()`. Two
 * windows can carry different themes simultaneously — variables don't
 * bleed because they're scoped inline rather than written to a global
 * stylesheet.
 *
 * Plugin authors use this to colour, soften, or restyle individual
 * windows without having to know anything about the shell's chrome
 * structure. Designers hand off a `tokens` map of `--wp-desktop-*`
 * variables and call it a day. Power users still get the slot and
 * control registries for shape changes (Layers 2-3) and the full
 * chrome render escape hatch (Layer 4).
 *
 * Mirrors the title-bar-button registry pattern (`subscribe` fan-out,
 * `match` predicate, `owner`-based teardown). Plain module-level state
 * is fine here: every plugin reaches the registry through
 * `wp.desktop.registerWindowTheme()` on the public API, so all callers
 * land in the same singleton — same ergonomics as `registerCommand`,
 * `registerTitleBarButton`, etc.
 *
 * @since 0.6.0
 */

import { throwOnRegistrationErrors } from '../../registration-errors';

import type { Window as DesktopWindow } from '../../window';

/**
 * A registered window theme.
 *
 * @public
 */
export interface WindowThemeDef {
	/**
	 * Unique id matching `/^[a-z0-9_/-]+$/`. Use the same `vendor/sub-id`
	 * convention as commands and title-bar buttons (e.g.
	 * `'my-plugin/midnight'`, `'my-plugin/sunrise'`) so two plugins can
	 * ship the same short name without colliding.
	 */
	id: string;
	/** Optional human-readable label for tooling / theme pickers. */
	label?: string;
	/**
	 * CSS custom-property map. Keys must start with `--`; values are
	 * passed verbatim to `style.setProperty( key, value )`. The shell
	 * applies them to the window's outer element so they cascade into
	 * the chrome and the body.
	 *
	 * Example:
	 *
	 * ```ts
	 * tokens: {
	 *   '--wp-desktop-window-radius': '14px',
	 *   '--wp-desktop-titlebar-bg': '#1a1a2e',
	 *   '--wp-desktop-titlebar-color-focused': '#fafafa',
	 * }
	 * ```
	 */
	tokens: Record< string, string >;
	/**
	 * Predicate — return `true` to apply this theme to the window.
	 * Common patterns mirror the title-bar-button registry:
	 *
	 *   - `( w ) => w.config.id === 'my-plugin/foo'`  — single window
	 *   - `( w ) => w.config.native`                   — every native
	 *   - `( w ) => true`                              — every window
	 *
	 * Throwing predicates are treated as `false` (logged via
	 * `console.warn`) so a buggy plugin can't crash the shell.
	 */
	match: ( window: DesktopWindow ) => boolean;
	/**
	 * When more than one registered theme matches a window, the entry
	 * with the highest `priority` wins. Defaults to 100. Lets plugin
	 * authors layer "site-wide" base themes (low priority) under
	 * "per-feature" overrides (high priority) without juggling
	 * registration order.
	 */
	priority?: number;
	/**
	 * Owner tag — typically the WordPress script handle that registered
	 * the theme. When the chrome server-sync sees the handle leave the
	 * payload (plugin deactivation), it calls
	 * {@link unregisterWindowThemesByOwner} so the theme drops live.
	 * Plugins that omit this stay registered until the next page reload
	 * (graceful backwards-compat).
	 */
	owner?: string;
}

const registry = new Map< string, WindowThemeDef >();
const listeners = new Set<() => void >();

/**
 * Pattern of valid theme ids. Same shape every other JS-side
 * registry uses (commands, settings tabs, title-bar buttons): lower-
 * case alphanum, hyphen, underscore, slash. Slashes are accepted so
 * plugins can mirror the `vendor/sub-id` convention.
 *
 * @internal
 */
const WINDOW_THEME_ID = /^[a-z0-9_/-]+$/;

/**
 * Register (or replace) a window theme. Re-registering with the same
 * id replaces the previous entry — mirrors WordPress's `register_*`
 * semantics.
 *
 * Throws a {@link RegistrationError} when validation fails. Plugin
 * authors who registered a theme and then watched windows render
 * unchanged used to have to inspect a console warning to discover
 * the field they got wrong; an audible throw turns that into a
 * stack frame they read at registration time.
 *
 * @param  def Theme definition.
 * @throws {RegistrationError} when `def` fails validation.
 */
export function registerWindowTheme( def: WindowThemeDef ): void {
	const errors: string[] = [];

	if ( ! def || typeof def !== 'object' ) {
		errors.push( 'def (not an object)' );
	} else {
		if ( typeof def.id !== 'string' || def.id.trim() === '' ) {
			errors.push( 'id (missing)' );
		} else if ( ! WINDOW_THEME_ID.test( def.id.trim().toLowerCase() ) ) {
			errors.push(
				`id (must match ${ WINDOW_THEME_ID } — lowercase alphanum, hyphens, underscores, slashes for vendor/sub-id)`,
			);
		}
		if ( ! def.tokens || typeof def.tokens !== 'object' ) {
			errors.push( 'tokens (must be an object of CSS custom-property → value)' );
		} else {
			for ( const key of Object.keys( def.tokens ) ) {
				if ( ! key.startsWith( '--' ) ) {
					errors.push(
						`tokens.${ key } (CSS custom-property keys must start with "--")`,
					);
					break;
				}
			}
		}
		if ( typeof def.match !== 'function' ) {
			errors.push( 'match (must be a function)' );
		}
	}

	throwOnRegistrationErrors( 'WindowTheme', errors, def );

	const id = def.id.trim().toLowerCase();
	registry.set( id, { ...def, id } );
	notify();
}

/**
 * Remove a theme by id. No-op when the id wasn't registered.
 */
export function unregisterWindowTheme( id: string ): void {
	if ( registry.delete( id.toLowerCase() ) ) {
		notify();
	}
}

/**
 * Bulk teardown — drop every theme whose `owner` matches. Returns the
 * number of removed entries. Called by the chrome server-sync when a
 * plugin deactivates without F5.
 */
export function unregisterWindowThemesByOwner( owner: string ): number {
	if ( ! owner ) {
		return 0;
	}
	let removed = 0;
	for ( const [ id, def ] of Array.from( registry.entries() ) ) {
		if ( def.owner === owner ) {
			registry.delete( id );
			removed++;
		}
	}
	if ( removed > 0 ) {
		notify();
	}
	return removed;
}

/**
 * Snapshot of every registered theme, sorted ascending by priority
 * (lower first, so consumers can iterate and let later entries win).
 */
export function listWindowThemes(): WindowThemeDef[] {
	return Array.from( registry.values() ).sort(
		( a, b ) => ( a.priority ?? 100 ) - ( b.priority ?? 100 ),
	);
}

/**
 * Resolve the highest-priority theme that matches `win`, or `null`
 * when no registered theme claims the window. Throwing predicates are
 * treated as non-matching.
 */
export function resolveWindowTheme(
	win: DesktopWindow,
): WindowThemeDef | null {
	let winner: WindowThemeDef | null = null;
	for ( const def of listWindowThemes() ) {
		try {
			if ( ! def.match( win ) ) {
				continue;
			}
		} catch ( err ) {
			if ( typeof console !== 'undefined' ) {
				// eslint-disable-next-line no-console
				console.warn(
					`[wp-desktop-mode] window-theme "${ def.id }" match() threw — skipping`,
					err,
				);
			}
			continue;
		}
		winner = def;
	}
	return winner;
}

/**
 * Subscribe to registry changes — register, unregister, owner-bulk
 * teardown all fire. The shell uses this to repaint open windows
 * when the registry mutates mid-session.
 */
export function subscribeWindowThemes( cb: () => void ): () => void {
	listeners.add( cb );
	return () => {
		listeners.delete( cb );
	};
}

function notify(): void {
	const snapshot = Array.from( listeners );
	for ( const cb of snapshot ) {
		try {
			cb();
		} catch ( err ) {
			if ( typeof console !== 'undefined' ) {
				// eslint-disable-next-line no-console
				console.error(
					'[wp-desktop-mode] window-theme registry listener threw:',
					err,
				);
			}
		}
	}
}

/**
 * Test-only: drop every theme + clear subscribers. Vitest setups use
 * this between cases so registry state doesn't leak across tests.
 *
 * @internal
 */
export function _resetWindowThemeRegistryForTests(): void {
	registry.clear();
	listeners.clear();
}
