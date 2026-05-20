/**
 * Agents: send-to dispatch + shared cache + reusable menu helper.
 *
 * Single source of truth for the "Send to…" right-click affordance
 * across every bundle (My WordPress, Posts, Pages, Users, desktop-
 * files, future windows). The cache lives in a `createSharedStore`
 * slot so writes from any bundle (e.g. the Agents renderer in the
 * My WordPress bundle pushing a freshly-updated trigger list)
 * propagate to readers in the Posts bundle, the desktop-files layer,
 * etc., without a REST round-trip.
 *
 * Each surface that wants a "Send to…" entry on its context menu
 * calls `attachSendToOption(menu, ctx)` AFTER it has appended its
 * own built-in options. The helper is a no-op when no agent accepts
 * the given `ctx.kind`, so it never adds clutter on agentless sites.
 *
 *   right-click → menu → "Send to…" (chevron) → submenu of agents
 *
 * Cache lifecycle:
 *   - Each bundle calls `init({restRoot, restNonce, initialTargets?})`
 *     once on boot. The first call to provide `initialTargets` seeds
 *     the store; later callers without targets trigger a REST
 *     refresh in the background.
 *   - `pushAgentToCache(agent)` / `removeAgentFromCache(id)` keep the
 *     store in sync after Agents-section CRUD. Live across bundles.
 *   - `refresh(config)` explicitly re-fetches from the server.
 *
 * @public
 * @since 0.23.0
 */

import { __, sprintf } from './i18n';
import { doAction } from './hooks';
import { showToast } from './toast';
import { trackedFetch } from './tracked-fetch';
import { createSharedStore } from './shared-store';
import {
	beginAgentRun,
	failAgentRun,
	finishAgentRun,
	markAgentRunRunning,
} from './agent-run-window';

export interface SendToTarget {
	id: number;
	slug: string;
	name: string;
	/**
	 * Behaviour description (the agent's `wp_guideline.post_excerpt`).
	 * Used by the run window's subtitle so the user sees what this
	 * agent does while it works. Empty string when not provided —
	 * the run window falls back to the sent message in that case.
	 */
	description: string;
	avatarUrl: string;
	entityKinds: string[];
}

export interface SendToContext {
	/** Entity-section id (e.g. `'posts'`, `'media'`, `'users'`). */
	entityId: string;
	/** Entity kind for catalogue matching — `'post'`, `'page'`, etc. */
	kind: string;
	/** Raw entity row — title / id / mime / etc. carried verbatim. */
	item: Record< string, unknown >;
}

interface SendToState {
	cache: SendToTarget[];
	initialized: boolean;
	/**
	 * True while a REST refresh is in flight. The submenu shows a
	 * loading row instead of (possibly stale) cached entries during
	 * the first-page-load window where the user can right-click
	 * faster than the round-trip resolves.
	 */
	hydrating: boolean;
}

const store = createSharedStore< SendToState >(
	'desktop-mode/agents-send-to',
	() => ( { cache: [], initialized: false, hydrating: false } ),
);

export interface SendToInitConfig {
	/** REST root URL — e.g. `https://example.test/wp-json/`. */
	restRoot: string;
	/** REST nonce header value. */
	restNonce: string;
	/**
	 * Optional seed targets (the My WordPress window-config ships
	 * these inline so no REST round-trip is needed; other windows
	 * can pass undefined and `init` will REST-fetch).
	 */
	initialTargets?: SendToTarget[];
	/** Active bundle's window id — tags the refresh fetch in the activity bus. */
	windowId?: string;
}

/**
 * Seed the cache. Safe to call from multiple bundles — the shared
 * store collapses duplicates. The first caller with `initialTargets`
 * wins; later callers without targets trigger a background refresh
 * but never overwrite an already-seeded store.
 *
 * @public
 */
export function init( config: SendToInitConfig ): void {
	if ( Array.isArray( config.initialTargets ) ) {
		store.state.cache = config.initialTargets.filter( isValidTarget );
		store.state.initialized = true;
		store.notify();
		return;
	}
	if ( store.state.initialized ) {
		return;
	}
	// No inline seed — REST-refresh in the background.
	void refresh( config );
}

/**
 * Last-resort init for surfaces that don't carry their own config
 * (e.g. the desktop-files tile menu firing on a fresh page load
 * before the user has opened any window). Pulls the REST nonce
 * from `window.desktopModeConfig` and falls back to a relative
 * `/wp-json/` REST root.
 *
 * No-op when the store is already initialized.
 */
function ensureInitFromGlobalConfig(): void {
	if ( store.state.initialized || store.state.hydrating ) {
		return;
	}
	const cfg = ( window as unknown as {
		desktopModeConfig?: { restNonce?: string };
	} ).desktopModeConfig;
	if ( ! cfg || typeof cfg.restNonce !== 'string' ) {
		return;
	}
	const base =
		typeof window !== 'undefined' && window.location
			? `${ window.location.origin }/wp-json/`
			: '/wp-json/';
	void refresh( { restRoot: base, restNonce: cfg.restNonce } );
}

/**
 * Eager boot-time seed used by the main desktop bundle. Kicks off
 * the REST refresh as soon as the shell config is available so the
 * cache is hot by the time the user right-clicks anything. Safe to
 * call multiple times — the `initialized` / `hydrating` flags
 * collapse concurrent calls into one round-trip.
 *
 * @public
 */
export function bootSeed(): void {
	ensureInitFromGlobalConfig();
}

function isValidTarget( raw: unknown ): raw is SendToTarget {
	if ( ! raw || typeof raw !== 'object' ) {
		return false;
	}
	const t = raw as Partial< SendToTarget >;
	if (
		typeof t.id !== 'number' ||
		typeof t.name !== 'string' ||
		typeof t.slug !== 'string' ||
		! Array.isArray( t.entityKinds )
	) {
		return false;
	}
	// `description` was added in 0.23.0 — older payloads / plugin-
	// supplied targets may omit it. Mutate to a guaranteed string so
	// every downstream reader (run window subtitle, debug logs) can
	// treat it as non-null.
	if ( typeof t.description !== 'string' ) {
		( raw as { description: string } ).description = '';
	}
	return true;
}

/**
 * Return the send-to targets that accept the given entity kind.
 *
 * @public
 */
export function getTargetsForKind( kind: string ): SendToTarget[] {
	if ( ! kind ) {
		return [];
	}
	return store.state.cache.filter( ( t ) => t.entityKinds.includes( kind ) );
}

interface AgentLike {
	id: number;
	slug: string;
	name: string;
	description?: string;
	avatarUrl: string;
	triggers: Array< {
		kind: string;
		config: Record< string, unknown >;
	} >;
}

/**
 * Replace the cache entry for the given agent — called by the
 * Agents renderer on every CRUD success.
 *
 * @public
 */
export function pushAgentToCache( agent: AgentLike ): void {
	const entityKinds = collectEntityKinds( agent.triggers );
	const next = store.state.cache.filter( ( t ) => t.id !== agent.id );
	if ( entityKinds.length > 0 ) {
		next.push( {
			id: agent.id,
			slug: agent.slug,
			name: agent.name,
			description:
				typeof agent.description === 'string' ? agent.description : '',
			avatarUrl: agent.avatarUrl,
			entityKinds,
		} );
	}
	next.sort( ( a, b ) => a.name.localeCompare( b.name ) );
	store.state.cache = next;
	store.state.initialized = true;
	store.notify();
}

/**
 * Remove an agent from the cache — call after a delete.
 *
 * @public
 */
export function removeAgentFromCache( id: number ): void {
	store.state.cache = store.state.cache.filter( ( t ) => t.id !== id );
	store.notify();
}

function collectEntityKinds(
	triggers: AgentLike[ 'triggers' ],
): string[] {
	const out = new Set< string >();
	for ( const trigger of triggers ) {
		if ( trigger.kind !== 'send-to' ) {
			continue;
		}
		const list = ( trigger.config as { entityKinds?: unknown } )?.entityKinds;
		if ( ! Array.isArray( list ) ) {
			continue;
		}
		for ( const kind of list ) {
			if ( typeof kind === 'string' && kind ) {
				out.add( kind );
			}
		}
	}
	return Array.from( out );
}

/**
 * Re-fetch send-to targets from the server. Safe to call any time
 * — the response replaces the cache. Returns the fresh list (or
 * the unchanged cache on failure).
 *
 * @public
 */
export async function refresh(
	config: SendToInitConfig,
): Promise< SendToTarget[] > {
	store.state.hydrating = true;
	store.notify();
	try {
		const response = await trackedFetch(
			joinRest( config.restRoot, 'desktop-mode/v1/agents/send-to-targets' ),
			{
				method: 'GET',
				credentials: 'same-origin',
				headers: {
					'X-WP-Nonce': config.restNonce,
					Accept: 'application/json',
				},
			},
			{
				windowId: config.windowId,
				source: 'desktop-mode/agents-send-to',
				silent: true,
			},
		);
		if ( response.ok ) {
			const body = ( await response.json() ) as unknown[];
			if ( Array.isArray( body ) ) {
				store.state.cache = body.filter( isValidTarget );
			}
		}
		store.state.initialized = true;
	} catch ( _err ) {
		// Silent — leave cache as-is but flip `initialized` so the
		// submenu stops looping the "loading" state forever.
		store.state.initialized = true;
	} finally {
		store.state.hydrating = false;
		store.notify();
	}
	return store.state.cache.slice();
}

function joinRest( base: string, path: string ): string {
	if ( base.endsWith( '/' ) ) {
		return base + path;
	}
	return base + '/' + path;
}

/**
 * Dispatch the send-to action.
 *
 * Opens the "Agent run" native window, builds a message from the
 * dropped entity, and invokes the agent via the OpenAI-backed
 * runtime. Progress + final result write to the cross-bundle store
 * the run window subscribes to; subscribers also see the run flow
 * through `desktop-mode.agent.send-to` so plugins can audit / react.
 *
 * @public
 */
export function dispatchSendTo(
	target: SendToTarget,
	ctx: SendToContext,
): void {
	// eslint-disable-next-line no-console
	console.info(
		'[desktop-mode/agents] dispatchSendTo →',
		target.name,
		'kind=' + ctx.kind,
		'item.id=' + ( ctx.item.id ?? '?' ),
	);
	const payload = {
		target,
		entityId: ctx.entityId,
		entityKind: ctx.kind,
		item: ctx.item,
	};
	doAction( 'desktop-mode.agent.send-to', payload );

	const title = extractTitle( ctx.item ) || `#${ ctx.item.id ?? '?' }`;
	const message = buildSendToMessage( target, ctx, title );

	const runId =
		typeof globalThis.crypto?.randomUUID === 'function'
			? globalThis.crypto.randomUUID()
			: `run-${ Date.now() }-${ Math.random().toString( 36 ).slice( 2, 8 ) }`;

	beginAgentRun( {
		id: runId,
		agentId: target.id,
		agentName: target.name,
		agentAvatar: target.avatarUrl,
		agentDescription: target.description ?? '',
		message,
	} );

	const open = (
		window as unknown as {
			wp?: {
				desktop?: {
					openWindow?: ( id: string, opts?: { source?: string } ) => boolean;
				};
			};
		}
	).wp?.desktop?.openWindow;
	let opened = false;
	if ( typeof open === 'function' ) {
		try {
			opened = open( 'desktop-mode-agent-run', {
				source: 'desktop-mode/agent-send-to',
			} ) === true;
		} catch ( err ) {
			// eslint-disable-next-line no-console
			console.error(
				'[desktop-mode/agents] openWindow threw:',
				err,
			);
		}
	}
	if ( ! opened ) {
		// The window registry didn't know about `desktop-mode-agent-run`,
		// or `openWindow` isn't on `wp.desktop` yet — surface why so
		// the user isn't left wondering why their Send-To did nothing
		// visible.
		showToast( {
			message: __(
				'Send-To could not open the run window. Reload the desktop and try again.',
				'desktop-mode',
			),
		} );
		// eslint-disable-next-line no-console
		console.warn(
			'[desktop-mode/agents] openWindow returned false for desktop-mode-agent-run. wp.desktop.openWindow:',
			typeof open,
			'\nKnown native-window ids:',
			Object.keys(
				( window as unknown as {
					desktopModeNativeWindows?: Record< string, unknown >;
				} ).desktopModeNativeWindows ?? {},
			),
		);
	} else {
		// eslint-disable-next-line no-console
		console.info(
			'[desktop-mode/agents] Opened desktop-mode-agent-run for',
			target.name,
		);
	}

	void runInvocation( runId, target, message );

	showToast( {
		message: sprintf(
			// translators: 1: agent name, 2: entity title or id.
			__( 'Sent to %1$s — %2$s', 'desktop-mode' ),
			target.name,
			title,
		),
	} );
}

/**
 * Build the message string the agent receives. Carries enough
 * context that an agent can act on the entity (id, kind, title)
 * without an extra REST round-trip. Plugins can override the entire
 * shape via the `desktop-mode.agent.send-to.message` filter — see
 * the action hook above for the payload shape that fires alongside.
 *
 * @internal
 */
function buildSendToMessage(
	target: SendToTarget,
	ctx: SendToContext,
	title: string,
): string {
	const id = extractEntityId( ctx.item );
	const header = sprintf(
		// translators: %s is the entity kind (post / page / media / user / comment).
		__(
			'You have been sent the following %s. Use your enabled abilities to act on it.',
			'desktop-mode',
		),
		ctx.kind,
	);
	// Body is intentionally NOT translated — these are field labels
	// the LLM consumes verbatim. Keeping them stable across locales
	// helps the agent's prompt-engineering be consistent.
	const body = [
		'',
		'Entity:',
		`- kind: ${ ctx.kind }`,
		`- id: ${ id }`,
		`- title: ${ title }`,
		`- targeted-by: ${ target.name }`,
	].join( '\n' );
	return header + body;
}

/**
 * Pull a positive integer id out of an entity item using every
 * shape this codebase + adjacent plugins are known to use:
 *
 *   - `item.id`        — canonical (`EntityListItem`, `MediaListItem`,
 *                        `UserListItem`).
 *   - `item.ID`        — raw `WP_Post` shape (post_meta queries, some
 *                        legacy plugin lists).
 *   - `item.postId` /
 *     `item.post_id`   — query-by-ref shapes (REST search responses,
 *                        a few of the Alcazaba content widgets).
 *
 * Falls back to `0` only when nothing resolves to a positive integer.
 * The agent's `dm/get-post-by-id` permission callback rejects
 * `post_id <= 0` early — landing here is what produced the
 * "Agent does not have permission to run …" loop the user hit.
 *
 * @internal
 */
function extractEntityId( item: Record< string, unknown > ): number {
	const candidates: unknown[] = [
		item.id,
		( item as { ID?: unknown } ).ID,
		( item as { postId?: unknown } ).postId,
		( item as { post_id?: unknown } ).post_id,
	];
	for ( const c of candidates ) {
		if ( typeof c === 'number' && c > 0 && Number.isFinite( c ) ) {
			return c;
		}
		if ( typeof c === 'string' && c !== '' ) {
			const n = Number( c );
			if ( Number.isFinite( n ) && n > 0 ) {
				return n;
			}
		}
	}
	return 0;
}

interface InvokeResponse {
	text: string;
	toolCalls: Array< {
		callId: string;
		name: string;
		args: Record< string, unknown >;
		output: unknown;
		error: string | null;
	} >;
	turns: number;
}

/**
 * Drive the REST invocation in the background. The run window
 * subscribes to the shared store, so updates land in the UI as soon
 * as we call `markAgentRunRunning` / `finishAgentRun` / `failAgentRun`.
 *
 * @internal
 */
async function runInvocation(
	runId: string,
	target: SendToTarget,
	message: string,
): Promise< void > {
	markAgentRunRunning( runId );
	let restRoot = '';
	let restNonce = '';
	try {
		const cfg = (
			window as unknown as {
				desktopModeConfig?: { restNonce?: string };
			}
		).desktopModeConfig;
		if ( cfg?.restNonce ) {
			restNonce = cfg.restNonce;
		}
		restRoot =
			typeof window !== 'undefined' && window.location
				? `${ window.location.origin }/wp-json/`
				: '/wp-json/';
	} catch {
		// Defaults already set.
	}

	if ( ! restNonce ) {
		failAgentRun( runId, __( 'No REST nonce available.', 'desktop-mode' ) );
		return;
	}

	try {
		const response = await trackedFetch(
			`${ restRoot }desktop-mode/v1/agents/${ target.id }/invoke`,
			{
				method: 'POST',
				credentials: 'same-origin',
				headers: {
					'X-WP-Nonce': restNonce,
					'Content-Type': 'application/json',
					Accept: 'application/json',
				},
				body: JSON.stringify( { message } ),
			},
			{
				source: 'desktop-mode/agent-send-to',
			},
		);
		if ( ! response.ok ) {
			let detail = `Status ${ response.status }`;
			try {
				const body = ( await response.json() ) as { message?: string };
				if ( body?.message ) {
					detail = body.message;
				}
			} catch {
				// Ignore JSON parse errors.
			}
			failAgentRun( runId, detail );
			return;
		}
		const result = ( await response.json() ) as InvokeResponse;
		finishAgentRun( runId, {
			text: result.text,
			toolCalls: result.toolCalls,
			turns: result.turns,
		} );
	} catch ( error ) {
		failAgentRun(
			runId,
			error instanceof Error
				? error.message
				: __( 'Invocation failed.', 'desktop-mode' ),
		);
	}
}

function extractTitle( item: Record< string, unknown > ): string {
	const title = item.title;
	if ( title && typeof title === 'object' ) {
		const rendered = ( title as { rendered?: unknown } ).rendered;
		if ( typeof rendered === 'string' ) {
			return rendered;
		}
	}
	if ( typeof item.name === 'string' ) {
		return item.name as string;
	}
	if ( typeof title === 'string' ) {
		return title;
	}
	return '';
}

interface AttachOptions {
	/**
	 * Called when the user picks any agent inside the submenu —
	 * usually `closeAnyTileMenu` / equivalent so the parent menu
	 * dismisses too. Runs BEFORE `dispatchSendTo()`.
	 */
	onPick?: () => void;
}

/**
 * Append a single "Send to…" option to a `<wpd-context-menu>` AND
 * wire its submenu flyout. Call this AFTER appending the menu's
 * built-in options — the entry lands at the bottom of the list.
 * No-op when no agent matches the kind.
 *
 * The submenu opens on hover OR click of the parent option and
 * dismisses on outside click, Escape, or parent-menu teardown.
 *
 * @public
 */
export function attachSendToOption(
	menu: HTMLElement,
	ctx: SendToContext,
	opts: AttachOptions = {},
): void {
	// First-time fallback init for callers that don't manage their
	// own boot (desktop-files in the main bundle, third-party
	// integrations). Kicks off a REST refresh when the cache is
	// cold AND the desktop-mode config global is available.
	ensureInitFromGlobalConfig();

	const cacheReady = store.state.initialized && ! store.state.hydrating;
	const targets = getTargetsForKind( ctx.kind );

	// Short-circuits, ordered by certainty:
	//   1. Cache is hot AND nothing matches → don't append clutter.
	//   2. Cache is unresolvable (no init happened AND nothing's in
	//      flight) → there's no path to a populated submenu, so
	//      skip. This is also what makes the helper a no-op in unit
	//      tests / non-shell contexts where `wp.desktop` isn't wired.
	//   3. Otherwise (hydrating, or already populated) we append the
	//      parent and resolve the body lazily so the user doesn't
	//      lose the affordance on a first right-click after boot.
	if ( cacheReady && targets.length === 0 ) {
		return;
	}
	if (
		! store.state.initialized &&
		! store.state.hydrating &&
		targets.length === 0
	) {
		return;
	}

	const parent = document.createElement( 'wpd-context-menu-option' );
	parent.dataset.menuItemId = 'desktop-mode-agent-send-to';
	parent.setAttribute( 'value', 'desktop-mode-agent-send-to' );
	parent.setAttribute( 'icon', 'dashicons-share-alt' );
	parent.setAttribute( 'has-children', '' );
	parent.textContent = __( 'Send to…', 'desktop-mode' );
	menu.appendChild( parent );

	let flyout: HTMLElement | null = null;
	let unsubscribeFlyout: ( () => void ) | null = null;

	const closeFlyout = (): void => {
		if ( flyout ) {
			flyout.remove();
			flyout = null;
		}
	};

	// Subscribe to store updates while the parent is mounted —
	// when the REST refresh resolves, we may need to either populate
	// the open submenu with real targets OR yank the parent from
	// the menu if the cache is now hot but holds nothing for this
	// kind. Unsubscribed in the MutationObserver below.
	let unsubscribeStore: ( () => void ) | null = null;

	// Always wire the parent-yank subscription: covers the case
	// where the user right-clicked while the cache was cold but
	// never hovered the submenu. The refresh resolves, no targets
	// match, the parent quietly removes itself.
	unsubscribeStore = store.subscribe( () => {
		if ( ! parent.isConnected ) {
			return;
		}
		const ready = store.state.initialized && ! store.state.hydrating;
		if ( ready && getTargetsForKind( ctx.kind ).length === 0 ) {
			parent.remove();
		}
	} );

	const paintFlyoutBody = ( fly: HTMLElement ): void => {
		fly.replaceChildren();
		const ready = store.state.initialized && ! store.state.hydrating;

		if ( ! ready ) {
			// Loading state — placeholder row while the REST refresh
			// is in flight. `<wpd-context-menu-option>` with no
			// `data-menu-item-id` is non-interactive (pick events
			// won't dispatch onto it).
			const loading = document.createElement(
				'wpd-context-menu-option',
			);
			loading.setAttribute( 'disabled', '' );
			loading.setAttribute( 'icon', 'dashicons-update' );
			loading.textContent = __( 'Loading agents…', 'desktop-mode' );
			fly.appendChild( loading );
			return;
		}

		const currentTargets = getTargetsForKind( ctx.kind );
		if ( currentTargets.length === 0 ) {
			const empty = document.createElement(
				'wpd-context-menu-option',
			);
			empty.setAttribute( 'disabled', '' );
			empty.textContent = __(
				'No agents accept this kind yet.',
				'desktop-mode',
			);
			fly.appendChild( empty );
			return;
		}

		for ( const target of currentTargets ) {
			const opt = document.createElement(
				'wpd-context-menu-option',
			);
			opt.dataset.menuItemId = `desktop-mode-agent-send-to:${ target.id }`;
			opt.setAttribute(
				'value',
				`desktop-mode-agent-send-to:${ target.id }`,
			);
			opt.setAttribute( 'icon', 'dashicons-superhero' );
			opt.textContent = target.name;
			opt.addEventListener( 'wpd-context-menu-pick', ( ev: Event ) => {
				ev.stopPropagation();
				closeFlyout();
				try {
					opts.onPick?.();
				} catch ( err ) {
					// eslint-disable-next-line no-console
					console.error(
						'[desktop-mode/agents] send-to onPick threw:',
						err,
					);
				}
				dispatchSendTo( target, ctx );
			} );
			fly.appendChild( opt );
		}
	};

	const openFlyoutAt = (): void => {
		closeFlyout();
		const fly = document.createElement( 'wpd-context-menu' );
		fly.setAttribute( 'open', '' );
		fly.classList.add( 'desktop-mode-agent-send-to-flyout' );

		paintFlyoutBody( fly );

		// Nest the flyout INSIDE the parent option (its slot accepts a
		// nested <wpd-context-menu> per the component doc). This is
		// load-bearing for the outside-click race: every host context
		// menu (`my-wordpress`, `desktop-files`, `posts-window`) listens
		// for pointerdown on document in capture phase and tears itself
		// down whenever `host.contains(target) === false`. If the
		// flyout lived under `document.body` instead, a click on an
		// agent row would fail that containment check, the parent menu
		// would close FIRST, our MutationObserver would tear down the
		// flyout, and the agent option would be detached before its
		// click could fire `wpd-context-menu-pick`. Putting the flyout
		// under the parent option keeps `menu.contains(target) === true`
		// so the host menu stays open through the pick.
		parent.appendChild( fly );
		flyout = fly;

		const anchorRect = parent.getBoundingClientRect();
		fly.style.position = 'fixed';
		fly.style.left = `${ anchorRect.right }px`;
		fly.style.top = `${ anchorRect.top }px`;
		const flyRect = fly.getBoundingClientRect();
		if ( flyRect.right > window.innerWidth ) {
			fly.style.left = `${ Math.max(
				0,
				anchorRect.left - flyRect.width,
			) }px`;
		}
		if ( flyRect.bottom > window.innerHeight ) {
			fly.style.top = `${ Math.max(
				0,
				window.innerHeight - flyRect.height - 8,
			) }px`;
		}

		// Live-update the open flyout body whenever the store fires.
		// The parent-yank subscription (above) handles the "nothing
		// matched after refresh" case; here we only repaint the open
		// submenu so the user sees fresh targets without closing and
		// re-opening.
		if ( ! unsubscribeFlyout ) {
			unsubscribeFlyout = store.subscribe( () => {
				if ( flyout ) {
					paintFlyoutBody( flyout );
				}
			} );
		}
	};

	// Open on hover (the standard right-click submenu UX) and on
	// click / keyboard activation. Clicking the parent option keeps
	// the flyout open instead of dismissing the menu.
	parent.addEventListener( 'mouseenter', () => {
		openFlyoutAt();
	} );
	parent.addEventListener( 'wpd-context-menu-pick', ( ev: Event ) => {
		ev.stopPropagation();
		openFlyoutAt();
	} );

	// Cleanup — when the parent menu is yanked from the DOM (by its
	// own outside-click handler, by Escape, by a pick on another
	// option), kill the flyout too. A MutationObserver on the menu's
	// parent does the trick without coupling us to each surface's
	// dismiss bookkeeping.
	queueMicrotask( () => {
		const watch = menu.parentNode;
		if ( ! watch ) {
			return;
		}
		const observer = new MutationObserver( () => {
			if ( ! menu.isConnected ) {
				closeFlyout();
				observer.disconnect();
				document.removeEventListener( 'pointerdown', onPointerDown );
				document.removeEventListener( 'keydown', onKey );
				if ( unsubscribeStore ) {
					unsubscribeStore();
					unsubscribeStore = null;
				}
				if ( unsubscribeFlyout ) {
					unsubscribeFlyout();
					unsubscribeFlyout = null;
				}
			}
		} );
		observer.observe( watch, { childList: true } );

		const onPointerDown = ( ev: PointerEvent ): void => {
			if (
				flyout &&
				ev.target instanceof Node &&
				! flyout.contains( ev.target ) &&
				! parent.contains( ev.target )
			) {
				closeFlyout();
			}
		};
		const onKey = ( ev: KeyboardEvent ): void => {
			if ( ev.key === 'Escape' ) {
				closeFlyout();
			}
		};
		document.addEventListener( 'pointerdown', onPointerDown );
		document.addEventListener( 'keydown', onKey );
	} );
}

/**
 * Convenience helper for surfaces that don't already have a context
 * menu — opens a `<wpd-context-menu>` at the given coordinates with
 * ONLY the Send-To entry. No-op when no agent accepts the kind.
 *
 * Useful from `wpd-table` `wpd-table-row-contextmenu` listeners and
 * any other place where we'd otherwise have to invent a whole menu
 * just for send-to.
 *
 * @public
 */
export function openSendToOnlyMenu(
	ctx: SendToContext,
	pos: { x: number; y: number },
): boolean {
	ensureInitFromGlobalConfig();
	const cacheReady = store.state.initialized && ! store.state.hydrating;
	// Only short-circuit when the cache is hot and there's truly
	// nothing for this kind. While the cache is still hydrating we
	// still open the menu so the user sees feedback; the
	// subscription inside `attachSendToOption` yanks the parent
	// option (and we then close the host menu below) if the
	// resolved cache ends up empty for this kind.
	if ( cacheReady && getTargetsForKind( ctx.kind ).length === 0 ) {
		return false;
	}

	const menu = document.createElement( 'wpd-context-menu' );
	menu.setAttribute( 'open', '' );
	menu.classList.add( 'desktop-mode-agent-send-to-host' );
	menu.style.position = 'fixed';
	menu.style.left = `${ pos.x }px`;
	menu.style.top = `${ pos.y }px`;

	let unsubscribeEmpty: ( () => void ) | null = null;
	const dismiss = (): void => {
		menu.remove();
		document.removeEventListener( 'pointerdown', onPointerDown );
		document.removeEventListener( 'keydown', onKey );
		if ( unsubscribeEmpty ) {
			unsubscribeEmpty();
			unsubscribeEmpty = null;
		}
	};
	const onPointerDown = ( ev: PointerEvent ): void => {
		if ( ev.target instanceof Node && ! menu.contains( ev.target ) ) {
			const fly = document.querySelector(
				'.desktop-mode-agent-send-to-flyout',
			);
			if ( fly && fly.contains( ev.target ) ) {
				return;
			}
			dismiss();
		}
	};
	const onKey = ( ev: KeyboardEvent ): void => {
		if ( ev.key === 'Escape' ) {
			dismiss();
		}
	};

	attachSendToOption( menu, ctx, { onPick: dismiss } );

	document.body.appendChild( menu );

	// Clamp into viewport.
	const rect = menu.getBoundingClientRect();
	if ( rect.right > window.innerWidth ) {
		menu.style.left = `${ Math.max( 0, window.innerWidth - rect.width - 8 ) }px`;
	}
	if ( rect.bottom > window.innerHeight ) {
		menu.style.top = `${ Math.max(
			0,
			window.innerHeight - rect.height - 8,
		) }px`;
	}

	queueMicrotask( () => {
		document.addEventListener( 'pointerdown', onPointerDown );
		document.addEventListener( 'keydown', onKey );
	} );

	// If the cache hydrates and confirms no targets for this kind,
	// `attachSendToOption` quietly removes its parent option — leaving
	// our wrapper menu empty. Close it to avoid an awkward floating
	// frame with nothing inside.
	unsubscribeEmpty = store.subscribe( () => {
		const ready = store.state.initialized && ! store.state.hydrating;
		if ( ready && getTargetsForKind( ctx.kind ).length === 0 ) {
			dismiss();
		}
	} );

	return true;
}
