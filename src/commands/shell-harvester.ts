/**
 * Shell-side harvester for `wp.data.select('core/commands')`.
 *
 * The chromeless iframe bridge already harvests the focused iframe's
 * command registry and re-publishes it to the parent palette under
 * `owner: 'iframe:<windowId>'`. That covers per-window extras (Gutenberg
 * "Duplicate block", pattern commands, etc.), but it leaves the shell
 * empty whenever the focused window is a native window — Posts, Files,
 * Comments, Plugins — because native windows have no iframe and no
 * `core/commands` runtime to subscribe to.
 *
 * This module fixes that by registering the *baseline* WordPress command
 * set (Add new post, Manage plugins, Switch theme, Browse patterns, …)
 * directly from the shell's own runtime. `includes/render/assets.php`
 * force-enqueues `wp-core-commands` on the shell page, which seeds the
 * `core/commands` store with the same baseline a real admin user would
 * see. We mount a hidden React harvester here, classify each command
 * (navigation → opens a desktop window; action → invokes the callback
 * in-place), and register the result with `owner: 'global'` so the
 * commands are visible in the palette regardless of which window has
 * focus.
 *
 * Note on plugin install/activate: the React harvester re-runs on every
 * `core/commands` store tick automatically, so any command added to the
 * store after boot (rare, but happens) shows up without intervention.
 * A freshly *activated* plugin's commands won't appear until the shell
 * page is reloaded — the plugin's JS isn't injected into the live shell.
 * The per-window iframe harvester (`iframe-bridge.ts`) covers that gap
 * for any screen the user navigates into.
 */

import {
	registerCommand,
	unregisterByOwner,
	type DesktopCommand,
} from './../commands';
import { __, sprintf } from './../i18n';
import { tryNativeUrlRemap } from './../native-url-remap';
import type { WindowManager } from './../window-manager';
import { deriveWindowId, sanitizeIconSvg } from './../utils';

const OWNER = 'global';

// `core/commands` callbacks for navigation are written as direct
// assignments to `document.location` (with `.href` or without). We
// classify by reading the callback source — never by execution.
// `document.location` and `Location.prototype` members are
// `[LegacyUnforgeable]` in WebIDL, so a runtime intercept via
// `Object.defineProperty` is silently rejected by the browser; an
// undetected nav callback would therefore navigate the SHELL and
// trigger the "leave site?" dialog on every iframe under it.
const NAV_HREF_LITERAL_RE =
	/(?:document\.location\.href|window\.location\.href|location\.href)\s*=\s*['"]([^'"$]+?)['"]/;
const NAV_ASSIGN_LITERAL_RE =
	/(?:document\.location|window\.location|location)\s*=\s*['"]([^'"$]+?)['"]/;
const NAV_CALL_LITERAL_RE =
	/location\.(?:assign|replace)\s*\(\s*['"]([^'"$]+?)['"]\s*\)/;
// Broad "this callback writes to location somehow" detector. Used to
// flag callbacks whose URL we couldn't extract statically — they're
// either safely re-routable (site-editor special case below) or unsafe
// to register at all.
const NAV_INTENT_RE =
	/(?:document\.location|window\.location|location)\s*(?:\.href\s*)?=|location\.(?:assign|replace)\s*\(/;
// Site-editor navigation pattern — the callback references the WP
// helpers that build a site-editor URL. We can't read the captured
// `templateType` / `record.id` from the closure, but the command
// `name` encodes both as `<type>-<id>` (e.g. `wp_template_part-
// twentytwentyfive//footer-columns`). When this matches, we synthesize
// the URL ourselves and treat the command as a safe navigate.
const SITE_EDITOR_INTENT_RE = /getSiteEditorPage\s*\(|site-editor\.php/;
const SITE_EDITOR_NAME_RE = /^(wp_template_part|wp_template|wp_navigation|wp_block)-(.+)$/;

/**
 * Look up a command name in the stashed `menu_commands` array (set by
 * `includes/render/assets.php` as an inline script before our bundle).
 * Each entry has shape `{ label, url, name }`. Returns the full entry
 * (so callers can also adopt the clean label — "Posts" — instead of
 * the harvested "Go to: Posts" used in the palette row).
 */
function lookupMenuCommand(
	name: string,
): { label: string; url: string } | null {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const list = ( window as any ).__openStationMenuCommands;
	if ( ! Array.isArray( list ) ) {
		return null;
	}
	for ( const entry of list ) {
		if (
			entry &&
			typeof entry === 'object' &&
			entry.name === name &&
			typeof entry.url === 'string' &&
			entry.url !== ''
		) {
			return {
				label: typeof entry.label === 'string' ? entry.label : '',
				url: entry.url,
			};
		}
	}
	return null;
}

interface RawCommand {
	name: string;
	label: string;
	icon?: unknown;
	context?: string;
	disabled?: boolean;
	callback?: ( ...args: unknown[] ) => void;
}

interface Classified {
	name: string;
	label: string;
	icon?: string;
	iconSvg?: string;
	// `navigate` — safe to open as a desktop window (URL was extracted).
	// `action` — pure JS callback that doesn't touch `location`; safe to
	//   run inline in the shell.
	// `skip` — callback navigates dynamically and we couldn't recover a
	//   URL; registering would risk navigating the shell. Excluded from
	//   the registry.
	kind: 'navigate' | 'action' | 'skip';
	url?: string;
	// Title for the desktop window the command opens. Distinct from
	// the palette row's `label` (which keeps the "Go to: Posts" form
	// the user types). For admin-menu navigation we adopt the clean
	// menu label ("Posts") so the window's title bar matches what
	// the user clicked in the menu, not the palette phrasing.
	windowTitle?: string;
	callback?: ( ...args: unknown[] ) => void;
}

export interface ShellCommandHarvesterOptions {
	manager: WindowManager;
	adminUrl: string;
}

export class ShellCommandHarvester {
	private readonly manager: WindowManager;
	private readonly adminUrl: string;

	private mounted = false;
	private host: HTMLDivElement | null = null;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private root: any = null;
	private kindCache: Record< string, { kind: 'navigate' | 'action' | 'skip'; url?: string; iconSvg?: string } > =
		Object.create( null );
	private callbackCache: Record< string, ( ...args: unknown[] ) => void > =
		Object.create( null );
	private lastFingerprint = '';

	constructor( opts: ShellCommandHarvesterOptions ) {
		this.manager = opts.manager;
		this.adminUrl = opts.adminUrl;
	}

	/** Mount the harvester. Idempotent. Safe to call before `wp.data` loads. */
	public install(): void {
		this.tryMount( 0 );
	}

	private tryMount( attempt: number ): void {
		if ( this.mounted ) {
			return;
		}
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const wp = ( window as any ).wp;
		if ( ! wp || ! wp.data || ! wp.element || typeof wp.data.subscribe !== 'function' ) {
			if ( attempt < 40 ) {
				window.setTimeout( () => this.tryMount( attempt + 1 ), 150 );
			}
			return;
		}
		this.mount();
	}

	private mount(): void {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const wp = ( window as any ).wp;
		const el = wp.element;
		const data = wp.data;
		const createEl = el.createElement;
		const useEffect = el.useEffect;
		const useRef = el.useRef;
		const useMemo = el.useMemo;
		const useSelect = data.useSelect;
		if (
			typeof createEl !== 'function' ||
			typeof useEffect !== 'function' ||
			typeof useRef !== 'function' ||
			typeof useMemo !== 'function' ||
			typeof useSelect !== 'function' ||
			typeof el.createRoot !== 'function'
		) {
			return;
		}
		this.mounted = true;

		const host = document.createElement( 'div' );
		host.setAttribute( 'aria-hidden', 'true' );
		host.style.cssText =
			'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none;left:-9999px;top:-9999px;';
		( document.body || document.documentElement ).appendChild( host );
		this.host = host;

		// Ref-based aggregation bucket — see the chromeless bridge's
		// `__wpdMountReactHarvester` for the full rationale. A
		// `setState` inside the effect would loop with the hook's
		// fresh-reference renders. Refs don't re-render, so the loop
		// is broken even when hooks churn references.
		const bucket: {
			perLoader: Record< string, RawCommand[] >;
			statics: RawCommand[];
			loadersList: string[];
		} = {
			perLoader: {},
			statics: [],
			loadersList: [],
		};

		const fingerprint = ( cmds: RawCommand[] ): string => {
			if ( ! Array.isArray( cmds ) || cmds.length === 0 ) {
				return '';
			}
			const keys = new Array( cmds.length );
			for ( let i = 0; i < cmds.length; i++ ) {
				const c = cmds[ i ];
				keys[ i ] = c && c.name ? c.name : '';
			}
			return keys.join( '|' );
		};

		const mergeAndPublish = (): void => {
			let merged: RawCommand[] = [];
			for ( const name of bucket.loadersList ) {
				const slice = bucket.perLoader[ name ];
				if ( Array.isArray( slice ) ) {
					merged = merged.concat( slice );
				}
			}
			if ( Array.isArray( bucket.statics ) ) {
				merged = merged.concat( bucket.statics );
			}
			// Refresh the callback cache off the same snapshot we're
			// about to publish — loader-returned commands close over
			// React state that's only valid this render pass.
			this.callbackCache = Object.create( null );
			for ( const cc of merged ) {
				if ( cc && cc.name && typeof cc.callback === 'function' ) {
					this.callbackCache[ cc.name ] = cc.callback;
				}
			}
			this.publish( merged );
		};

		/* eslint-disable react-hooks/exhaustive-deps --
		   Dependency arrays intentionally key off the fingerprint
		   (or are deliberately empty) rather than tracking the raw
		   arrays / props that hooks return fresh on every render. A
		   "complete" dependency list would re-fire the effects every
		   render → re-publish → infinite loop. Same trick as the
		   chromeless bridge's harvester. */
		const LoaderSlot = ( props: { loader: { name: string; hook: ( a: { search: string } ) => { commands?: RawCommand[] } } } ) => {
			const loader = props.loader;
			let result: { commands?: RawCommand[] } | null = null;
			try {
				result = loader.hook( { search: '' } );
			} catch {
				/* a buggy loader shouldn't take the harvester down */
			}
			const cmds: RawCommand[] =
				result && Array.isArray( result.commands ) ? result.commands : [];
			const key = useMemo( () => fingerprint( cmds ), [ cmds ] );

			useEffect( () => {
				bucket.perLoader[ loader.name ] = cmds;
				mergeAndPublish();
			}, [ key ] );

			useEffect( () => {
				return () => {
					delete bucket.perLoader[ loader.name ];
					mergeAndPublish();
				};
			}, [] );

			return null;
		};

		const Harvester = () => {
			// `core/commands` `getCommands( contextual )` partitions the
			// store: `true` returns commands whose `command.context`
			// matches the current `state.context`, `false` returns the
			// non-contextual rest. The WP-wide baseline registered by
			// `wp.coreCommands.initializeCommandPalette()` (Add new
			// post, Manage plugins, …) carries no `context`, so it
			// sits in the non-contextual bucket. The shell has no
			// context set, so we want both buckets concatenated:
			// non-contextual covers the baseline; contextual covers
			// the rare case where a plugin sets a global context.
			const loaders = useSelect( ( s: ( store: string ) => unknown ) => {
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const ss = s( 'core/commands' ) as any;
				if ( ! ss || typeof ss.getCommandLoaders !== 'function' ) {
					return [];
				}
				return [
					...( ss.getCommandLoaders( false ) || [] ),
					...( ss.getCommandLoaders( true ) || [] ),
				];
			}, [] );
			const staticCmds = useSelect( ( s: ( store: string ) => unknown ) => {
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const ss = s( 'core/commands' ) as any;
				if ( ! ss || typeof ss.getCommands !== 'function' ) {
					return [];
				}
				return [
					...( ss.getCommands( false ) || [] ),
					...( ss.getCommands( true ) || [] ),
				];
			}, [] );

			const loadersNames = useMemo( () => {
				return Array.isArray( loaders )
					? loaders.map( ( l: { name?: string } ) => ( l ? l.name || '' : '' ) )
					: [];
			}, [ loaders ] );
			const loadersKey = loadersNames.join( '|' );
			useEffect( () => {
				bucket.loadersList = loadersNames;
				mergeAndPublish();
			}, [ loadersKey ] );

			const staticKey = useMemo(
				() => fingerprint( Array.isArray( staticCmds ) ? staticCmds : [] ),
				[ staticCmds ],
			);
			useEffect( () => {
				bucket.statics = Array.isArray( staticCmds ) ? staticCmds : [];
				mergeAndPublish();
			}, [ staticKey ] );

			if ( ! Array.isArray( loaders ) || loaders.length === 0 ) {
				return null;
			}
			const children: unknown[] = [];
			for ( const loader of loaders ) {
				if ( ! loader || typeof loader.hook !== 'function' ) {
					continue;
				}
				children.push(
					createEl( LoaderSlot, { key: loader.name, loader } ),
				);
			}
			return createEl( el.Fragment || 'div', null, children );
		};
		/* eslint-enable react-hooks/exhaustive-deps */

		try {
			this.root = el.createRoot( host );
			this.root.render( createEl( Harvester ) );
		} catch {
			this.mounted = false;
			this.root = null;
			if ( this.host && this.host.parentNode ) {
				this.host.parentNode.removeChild( this.host );
			}
			this.host = null;
		}
	}

	private publish( raw: RawCommand[] ): void {
		// Dedupe + finalize. Same shape as the chromeless harvester's
		// `__wpdFinalizeCommands` — drop disabled, drop duplicates,
		// drop entries missing name/label.
		const seen: Record< string, boolean > = Object.create( null );
		const classified: Classified[] = [];
		for ( const cmd of raw ) {
			if ( ! cmd || ! cmd.name || ! cmd.label ) {
				continue;
			}
			if ( cmd.disabled ) {
				continue;
			}
			if ( seen[ cmd.name ] ) {
				continue;
			}
			seen[ cmd.name ] = true;
			classified.push( this.classify( cmd ) );
		}

		// Cheap fingerprint dedupe — `core/commands` ticks on every
		// unrelated preference change. Re-registering an identical
		// list every tick would notify subscribers for no reason.
		let key = '';
		for ( const c of classified ) {
			key += `${ c.name }|${ c.kind }|${ c.url || '' }\n`;
		}
		if ( key === this.lastFingerprint ) {
			return;
		}
		this.lastFingerprint = key;

		unregisterByOwner( OWNER );

		for ( const c of classified ) {
			// `skip` commands navigate dynamically and we couldn't
			// recover the URL — registering them would let a /search
			// pick navigate the shell out of OpenStation. Drop.
			if ( c.kind === 'skip' ) {
				continue;
			}
			const slug = `global-${ c.name.toLowerCase().replace( /[^a-z0-9_-]+/g, '-' ) }`;
			const icon = this.iconFor( c );
			const def: DesktopCommand = {
				slug,
				label: c.label,
				icon,
				iconSvg: c.iconSvg && c.iconSvg !== '' ? sanitizeIconSvg( c.iconSvg ) : undefined,
				owner: OWNER,
				// NOT eager. The palette splits the registry into two
				// disjoint surfaces: `eager` commands show on empty
				// input (and are excluded from slash search at
				// `src/ai-assistant/impl.ts:494`); non-eager commands
				// show when the user types `/<query>`. The WP baseline
				// is large (~150 entries) and meant to be searched —
				// surfacing it eagerly would drown the iframe-harvested
				// contextual shortcuts on every open. Slash-search is
				// the right surface for it, matching the native WP
				// palette UX (open, type, find).
				run: c.kind === 'navigate' && c.url
					? this.runNavigate( c.url, c.windowTitle || c.label, icon )
					: this.runInvoke( c.name ),
			};
			try {
				registerCommand( def );
			} catch ( err ) {
				// eslint-disable-next-line no-console
				console.error(
					'[openstation] shell-harvester: dropping bad command',
					def,
					err,
				);
			}
		}
	}

	private classify( cmd: RawCommand ): Classified {
		const out: Classified = {
			name: String( cmd.name ),
			label: String( cmd.label ),
			icon: typeof cmd.icon === 'string' ? cmd.icon : undefined,
			iconSvg: undefined,
			kind: 'action',
			url: undefined,
			callback: typeof cmd.callback === 'function' ? cmd.callback : undefined,
		};

		const cached = this.kindCache[ out.name ];
		if ( cached ) {
			out.kind = cached.kind;
			out.url = cached.url;
			out.iconSvg = cached.iconSvg;
			return out;
		}

		// Flatten React-element icons to a static SVG string once per
		// command name — Gutenberg ships icons as `@wordpress/icons`
		// React elements that the palette can't render directly.
		if ( cmd.icon && typeof cmd.icon !== 'string' ) {
			out.iconSvg = this.renderIcon( cmd.icon );
		}

		// Tier 0 — known admin-menu navigation.
		// (See class doc-block above.)
		//
		// WP's `useCommands` wraps every command's `callback` in a stable
		// ref before exposing it through the store; the source we read
		// via `Function.prototype.toString` is the wrapper, not the
		// real handler that does `document.location = menuCommand.url`.
		// Source-regex classification therefore can never identify
		// these commands. Instead, check the PHP-built menu map
		// (`window.__openStationMenuCommands`, injected by
		// `includes/render/assets.php` from the live `$menu`/
		// `$submenu` globals). If the command name matches an entry,
		// we know the URL and can safely route it through the window
		// manager. Skip source inspection for these — the URL is the
		// source of truth, the callback would just navigate the shell.
		const menuEntry = lookupMenuCommand( out.name );
		if ( menuEntry ) {
			try {
				out.url = new URL( menuEntry.url, this.adminUrl ).toString();
				out.kind = 'navigate';
				if ( menuEntry.label !== '' ) {
					out.windowTitle = menuEntry.label;
				}
			} catch {
				out.kind = 'skip';
			}
			this.kindCache[ out.name ] = {
				kind: out.kind,
				url: out.url,
				iconSvg: out.iconSvg,
			};
			return out;
		}

		if ( typeof cmd.callback === 'function' ) {
			let src = '';
			try {
				src = Function.prototype.toString.call( cmd.callback );
			} catch {
				src = '';
			}

			// Tier 1 — literal URL extractable from the callback source.
			const literal =
				src.match( NAV_HREF_LITERAL_RE ) ||
				src.match( NAV_ASSIGN_LITERAL_RE ) ||
				src.match( NAV_CALL_LITERAL_RE );
			if ( literal && literal[ 1 ] ) {
				try {
					out.url = new URL( literal[ 1 ], window.location.href ).toString();
					out.kind = 'navigate';
				} catch {
					out.kind = 'action';
				}
			} else if ( NAV_INTENT_RE.test( src ) ) {
				// Callback writes to `location` but the URL isn't a
				// string literal — could be `addQueryArgs(...)`,
				// template literal, captured closure, etc. We can't
				// safely execute (shell would navigate). Admin-menu
				// nav was already handled above via Tier 0; the
				// remaining recoverable case is site-editor template
				// navigation.

				// Site-editor template navigation. The callback uses
				// `getSiteEditorPage()` / `site-editor.php`, and the
				// command name encodes `<entityType>-<entityId>`
				// (e.g. `wp_template_part-twentytwentyfive//footer-
				// columns`). Rebuild the URL from the name.
				const isSiteEditorIntent = SITE_EDITOR_INTENT_RE.test( src );
				const nameMatch = isSiteEditorIntent
					? out.name.match( SITE_EDITOR_NAME_RE )
					: null;
				if ( nameMatch ) {
					const entityType = nameMatch[ 1 ];
					const entityId = nameMatch[ 2 ];
					const p = `/${ entityType }/${ entityId }`;
					try {
						const siteEditor = new URL( 'site-editor.php', this.adminUrl );
						siteEditor.searchParams.set( 'p', p );
						siteEditor.searchParams.set( 'canvas', 'edit' );
						out.url = siteEditor.toString();
						out.kind = 'navigate';
					} catch {
						out.kind = 'skip';
					}
				} else {
					// Unrecoverable nav. Skip rather than register
					// a command that would unload the shell.
					out.kind = 'skip';
				}
			}
			// else: pure JS action (no `location` writes detected).
			// Keep `kind: 'action'` — `runInvoke` executes the callback
			// in the shell. Toggles, dispatches, modal opens all land
			// here and work fine.
			//
			// The detection is textual and therefore only as good as
			// the callback's own body: a handler that navigates
			// through a helper (`callback: ( a ) => goTo( url,
			// a.close )`) mentions no sink here and is classified an
			// action. There is no runtime net under it — `location`
			// cannot be shadowed (see the note at the top of this
			// file) — so such a command navigates the shell for real
			// when it runs. Widening the regexes past the callback's
			// own source is not possible; what IS possible is that the
			// command says so, which is why `runInvoke` no longer
			// swallows what the callback does or throws.
		}

		this.kindCache[ out.name ] = {
			kind: out.kind,
			url: out.url,
			iconSvg: out.iconSvg,
		};
		return out;
	}

	private renderIcon( icon: unknown ): string {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const wp = ( window as any ).wp;
		if ( ! wp || ! wp.element || typeof wp.element.renderToString !== 'function' ) {
			return '';
		}
		try {
			const rendered = wp.element.renderToString( icon );
			if (
				typeof rendered === 'string' &&
				rendered.toLowerCase().startsWith( '<svg' )
			) {
				return rendered;
			}
		} catch {
			/* swallow */
		}
		return '';
	}

	private iconFor( c: Classified ): string {
		if ( c.icon && c.icon.startsWith( 'dashicons-' ) ) {
			return c.icon;
		}
		return c.kind === 'navigate' ? 'dashicons-external' : 'dashicons-arrow-right-alt';
	}

	private runNavigate(
		url: string,
		title: string,
		icon: string,
	): DesktopCommand[ 'run' ] {
		return ( _args, ctx ) => {
			ctx.close();
			// Consult the native URL remap registry first — if a
			// native window claims this URL (e.g. the Posts window
			// for `edit.php`, the Plugins window for `plugins.php`),
			// open that instead of spawning an iframe. Falls through
			// to plain iframe-window opening when no remap matches
			// or the remap's gate refuses the current user.
			if ( tryNativeUrlRemap( url ) ) {
				return;
			}
			const id = deriveWindowId( url, this.adminUrl );
			this.manager.open( { id, baseId: id, url, title, icon } );
		};
	}

	/**
	 * Run an `action`-classified command by calling the callback the
	 * store handed us.
	 *
	 * Two things here are the command's own to decide, and neither is
	 * ours to invent:
	 *
	 * **The callback gets the palette's real `close`.** WordPress
	 * documents the handler as `callback( { close } )`, and every
	 * command written against that contract calls it — usually first,
	 * before the work, so the overlay is gone by the time anything
	 * happens. Handing it a no-op stub instead ran the command with
	 * the palette still sitting over the result.
	 *
	 * **A callback that throws is the command failing.** It reaches
	 * `_runCommand`, which renders "Command /x failed: …" and fires
	 * `HOOKS.COMMAND_ERROR`. Swallowing it produced the exact bug
	 * this method was reported for: a third-party command that
	 * listed, highlighted and picked, and then did nothing at all —
	 * no error, no console line, nothing to tell the author their
	 * handler had thrown on its first statement.
	 *
	 * Note what is deliberately NOT here: an attempt to sandbox
	 * `location` around the call. `location` is `[LegacyUnforgeable]`
	 * (see the classification note at the top of this file), so
	 * `Object.defineProperty( document | window, 'location', … )`
	 * throws `TypeError: Cannot redefine property: location` and the
	 * guard it was meant to install never existed. Classification is
	 * the only line of defence against a callback navigating the
	 * shell, which is what `docs/architecture.md` has said all along:
	 * callbacks are never executed to classify.
	 */
	private runInvoke( name: string ): DesktopCommand[ 'run' ] {
		return ( _args, ctx ) => {
			const cb = this.callbackCache[ name ];
			if ( typeof cb !== 'function' ) {
				// The cache is rebuilt from each harvest, so a name that
				// is registered but uncached means the two went out of
				// step. Say so — the alternative (close and return) is
				// indistinguishable from a command that ran fine.
				throw new Error(
					sprintf(
						/* translators: %s: the `core/commands` command name. */
						__( 'No live callback for command “%s” — the palette and the command registry are out of step. Reload the page.' ),
						name,
					),
				);
			}
			cb( { close: () => ctx.close() } );
			// The palette stays open unless the command closed it. A
			// pure JS action (e.g. "View site" → window.open in a new
			// tab) has its effect elsewhere, and closing on its behalf
			// means returning to this tab finds the overlay mid-close
			// (the fade was throttled while the tab was backgrounded)
			// and it vanishes.
		};
	}
}
