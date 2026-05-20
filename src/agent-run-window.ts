/**
 * Desktop Mode — Agents: "Agent run" window UI.
 *
 * Always-available native window opened by `dispatchSendTo()` (and by
 * any future code path that wants to show an agent invocation in
 * progress). The window is a shell — this module registers the render
 * callback against `window.desktopModeNativeWindows[ 'desktop-mode-agent-run' ]`,
 * subscribes to the cross-bundle `desktop-mode/agent-run` shared
 * store, and paints whatever the dispatcher pushed into it.
 *
 * State machine for a single run:
 *
 *   pending  → window opens, header shows agent + message
 *   running  → indeterminate progress bar pulses, status reads
 *              "Running…" + a streamer of tool-call breadcrumbs as
 *              each one resolves
 *   done     → bar hides, final assistant text appears, tool-call
 *              expandable details remain in the scroll
 *   error    → bar hides, error message + retry button
 *
 * `dispatchSendTo()` updates the store after the (currently blocking)
 * REST round-trip resolves. Until streaming lands, "running" is a
 * single state — the bar pulses, the message reads "Running…", and
 * the backscroll is empty until the final result arrives. This
 * matches the UX shape the user asked for ("always showing
 * indeterminate loading") and gives a natural place to add per-turn
 * updates later.
 *
 * @internal
 * @since 0.23.0
 */

import { __, sprintf } from './i18n';
import { createSharedStore } from './shared-store';
import type { AgentToolCall } from './my-wordpress/agents-rest';
import './ui/components/wpd-progress-bar/wpd-progress-bar';
import './ui/components/wpd-spinner/wpd-spinner';

export interface AgentRunState {
	id: string;
	agentId: number;
	agentName: string;
	agentAvatar: string;
	/**
	 * Behaviour description (the agent's `wp_guideline.post_excerpt`).
	 * Shown as the run-window subtitle. Empty string when the agent
	 * has no description — the renderer falls back to the sent
	 * message in that case.
	 */
	agentDescription: string;
	message: string;
	startedAt: number;
	status: 'pending' | 'running' | 'done' | 'error';
	result?: {
		text: string;
		toolCalls: AgentToolCall[];
		turns: number;
	};
	error?: string;
}

/**
 * One entity touched by a tool call during the run — surfaced as a
 * tile at the bottom of the window once the run finishes so the user
 * can double-click to open it.
 *
 * @internal
 */
interface AgentRunEntity {
	kind: 'post';
	id: number;
	title: string;
	icon: string;
}

interface RunStore {
	current: AgentRunState | null;
	history: AgentRunState[];
}

const store = createSharedStore< RunStore >(
	'desktop-mode/agent-run',
	() => ( { current: null, history: [] } ),
);

const WINDOW_ID = 'desktop-mode-agent-run';
const HISTORY_CAP = 10;

/**
 * Start a new run — replaces `current` with a pending state and
 * caps `history` at `HISTORY_CAP`. The caller is responsible for
 * opening the window (we do not auto-open so the same primitive can
 * be reused from headless contexts).
 *
 * @public
 */
export function beginAgentRun(
	init: Omit< AgentRunState, 'status' | 'startedAt' >,
): AgentRunState {
	const state: AgentRunState = {
		...init,
		startedAt: Date.now(),
		status: 'pending',
	};
	const prev = store.state.current;
	store.state.current = state;
	if ( prev && prev.status !== 'pending' ) {
		store.state.history = [
			prev,
			...store.state.history.slice( 0, HISTORY_CAP - 1 ),
		];
	}
	store.notify();
	return state;
}

/**
 * Move the current run to `running`. Idempotent — callers can call
 * it repeatedly without churning the store.
 *
 * @public
 */
export function markAgentRunRunning( id: string ): void {
	const cur = store.state.current;
	if ( cur && cur.id === id && cur.status === 'pending' ) {
		store.state.current = { ...cur, status: 'running' };
		store.notify();
	}
}

/**
 * Resolve the current run with a success payload. Move it to
 * `history` and clear `current`.
 *
 * @public
 */
export function finishAgentRun(
	id: string,
	result: AgentRunState[ 'result' ],
): void {
	const cur = store.state.current;
	if ( ! cur || cur.id !== id ) {
		return;
	}
	const done: AgentRunState = { ...cur, status: 'done', result };
	store.state.current = done;
	store.notify();
}

/**
 * Resolve the current run with an error.
 *
 * @public
 */
export function failAgentRun( id: string, error: string ): void {
	const cur = store.state.current;
	if ( ! cur || cur.id !== id ) {
		return;
	}
	const failed: AgentRunState = { ...cur, status: 'error', error };
	store.state.current = failed;
	store.notify();
}

// We deliberately don't `declare global` for `desktopModeNativeWindows`
// here — every per-window bundle in the repo already does, and TS
// rejects overlapping declarations of the same global property
// from different modules. The assignment in `registerAgentRunWindow`
// goes through a typed cast instead.

/**
 * Render callback the native-window sync loads on first open. Mounts
 * the structure into the template's `[data-desktop-mode-agent-run-root]`
 * host and subscribes to the store so subsequent state changes
 * re-paint without unmount.
 *
 * @internal
 */
const renderCallback = ( body: HTMLElement ): void => {
	const root = body.querySelector< HTMLElement >(
		'[data-desktop-mode-agent-run-root]',
	);
	if ( ! root ) {
		return;
	}

	root.replaceChildren();

	const wrap = document.createElement( 'div' );
	wrap.className = 'desktop-mode-agent-run';

	const header = document.createElement( 'header' );
	header.className = 'desktop-mode-agent-run__header';
	wrap.appendChild( header );

	const bar = document.createElement( 'wpd-progress-bar' );
	bar.setAttribute( 'indeterminate', '' );
	bar.setAttribute( 'label', __( 'Running…', 'desktop-mode' ) );
	bar.classList.add( 'desktop-mode-agent-run__progress' );
	wrap.appendChild( bar );

	const status = document.createElement( 'p' );
	status.className = 'desktop-mode-agent-run__status';
	wrap.appendChild( status );

	const transcript = document.createElement( 'div' );
	transcript.className = 'desktop-mode-agent-run__transcript';
	wrap.appendChild( transcript );

	// "Entities touched" section — populated after the run resolves
	// to `done`. Each entity becomes a tile the user can double-click
	// to open. Held outside the transcript so it stays visible even
	// when the user scrolls the backscroll.
	const entitiesBlock = document.createElement( 'div' );
	entitiesBlock.className = 'desktop-mode-agent-run__entities';
	entitiesBlock.hidden = true;
	wrap.appendChild( entitiesBlock );

	root.appendChild( wrap );

	const repaint = (): void => {
		const cur = store.state.current;
		header.replaceChildren();
		transcript.replaceChildren();
		entitiesBlock.replaceChildren();
		entitiesBlock.hidden = true;

		if ( ! cur ) {
			bar.style.visibility = 'hidden';
			status.textContent = __(
				'No agent is currently running. Right-click any tile and pick "Send to…" to invoke one.',
				'desktop-mode',
			);
			return;
		}

		// Header — avatar + agent name + description.
		const avatar = document.createElement( 'img' );
		avatar.src = cur.agentAvatar;
		avatar.alt = '';
		avatar.className = 'desktop-mode-agent-run__avatar';
		header.appendChild( avatar );

		const titleBlock = document.createElement( 'div' );
		titleBlock.className = 'desktop-mode-agent-run__title-block';
		const h2 = document.createElement( 'h2' );
		h2.textContent = cur.agentName;
		titleBlock.appendChild( h2 );
		const sub = document.createElement( 'p' );
		sub.className = 'desktop-mode-agent-run__subtitle';
		// Prefer the agent's description (its raison d'être) over an
		// echo of the user's send-to message — the user already saw
		// the message they sent in the transcript below.
		sub.textContent = cur.agentDescription || cur.message;
		titleBlock.appendChild( sub );
		header.appendChild( titleBlock );

		// Progress bar — visible while pending/running, hidden when
		// the run resolves to done/error.
		const isActive = cur.status === 'pending' || cur.status === 'running';
		bar.style.visibility = isActive ? 'visible' : 'hidden';

		// Status line — always present, copy changes per state.
		status.classList.remove(
			'desktop-mode-agent-run__status--done',
			'desktop-mode-agent-run__status--error',
		);
		if ( cur.status === 'pending' ) {
			status.textContent = __(
				'Queued — sending to OpenAI…',
				'desktop-mode',
			);
		} else if ( cur.status === 'running' ) {
			status.textContent = __(
				'Running. Watch the backscroll below for each tool call.',
				'desktop-mode',
			);
		} else if ( cur.status === 'done' ) {
			status.classList.add(
				'desktop-mode-agent-run__status--done',
			);
			status.textContent = sprintf(
				// translators: 1: turn count, 2: tool-call count.
				__(
					'Finished in %1$d turn(s) with %2$d tool call(s).',
					'desktop-mode',
				),
				cur.result?.turns ?? 0,
				cur.result?.toolCalls.length ?? 0,
			);
		} else if ( cur.status === 'error' ) {
			status.classList.add(
				'desktop-mode-agent-run__status--error',
			);
			status.textContent = sprintf(
				// translators: %s is the error message.
				__( 'Failed — %s', 'desktop-mode' ),
				cur.error ?? __( 'unknown error', 'desktop-mode' ),
			);
		}

		// Transcript — user message + each tool call + final agent
		// reply. Always shown so the user can scroll back through what
		// the agent saw and did.
		transcript.appendChild(
			buildLine(
				__( 'You', 'desktop-mode' ),
				cur.message,
				'user',
			),
		);
		if ( cur.result ) {
			for ( const tc of cur.result.toolCalls ) {
				transcript.appendChild( buildToolEntry( tc ) );
			}
			if ( cur.result.text ) {
				transcript.appendChild(
					buildLine( cur.agentName, cur.result.text, 'agent' ),
				);
			}
		}
		if ( cur.status === 'error' && cur.error ) {
			transcript.appendChild(
				buildLine(
					__( 'Error', 'desktop-mode' ),
					cur.error,
					'error',
				),
			);
		}

		// Once the run resolves, surface every entity the agent
		// actually touched as a double-clickable tile. Lets the user
		// inspect what changed without scanning JSON tool-call
		// payloads in the transcript above.
		if ( cur.status === 'done' && cur.result ) {
			const entities = collectEntitiesFromToolCalls(
				cur.result.toolCalls,
			);
			if ( entities.length > 0 ) {
				entitiesBlock.hidden = false;
				const heading = document.createElement( 'h3' );
				heading.className = 'desktop-mode-agent-run__entities-heading';
				heading.textContent = __( 'Entities used', 'desktop-mode' );
				entitiesBlock.appendChild( heading );
				const grid = document.createElement( 'div' );
				grid.className = 'desktop-mode-agent-run__entities-grid';
				for ( const ent of entities ) {
					grid.appendChild( buildEntityTile( ent ) );
				}
				entitiesBlock.appendChild( grid );
			}
		}

		// Keep the scroll pinned to the bottom — the most recent
		// breadcrumb is what the user wants to see.
		transcript.scrollTop = transcript.scrollHeight;
	};

	repaint();
	const off = store.subscribe( repaint );

	// Tear down on disconnect.
	const observer = new MutationObserver( () => {
		if ( ! body.isConnected ) {
			off();
			observer.disconnect();
		}
	} );
	if ( body.parentNode ) {
		observer.observe( body.parentNode, { childList: true } );
	}
};

function buildLine(
	who: string,
	body: string,
	kind: 'user' | 'agent' | 'error',
): HTMLElement {
	const div = document.createElement( 'div' );
	div.className =
		'desktop-mode-agent-run__message ' +
		`desktop-mode-agent-run__message--${ kind }`;
	const strong = document.createElement( 'strong' );
	strong.textContent = who;
	div.appendChild( strong );
	const p = document.createElement( 'p' );
	p.textContent = body;
	div.appendChild( p );
	return div;
}

/**
 * Walk every tool call from a finished run and project the unique
 * entities the agent actually touched. Inputs that name a post
 * (`post_id`) and tool outputs that return a post-shape (`id` +
 * `title`) both count — whichever has the best title wins per id.
 *
 * Today only `dm/get-post-by-id` and `dm/update-post` are wired, both
 * post-shaped. Other kinds (media, user, comment) drop in here when
 * we ship their abilities — extend the `kind` union on
 * {@link AgentRunEntity} and add a recognizer below.
 *
 * @internal
 */
function collectEntitiesFromToolCalls(
	toolCalls: AgentToolCall[],
): AgentRunEntity[] {
	const byKey = new Map< string, AgentRunEntity >();

	const remember = ( ent: AgentRunEntity ): void => {
		if ( ent.id <= 0 ) {
			return;
		}
		const key = `${ ent.kind }:${ ent.id }`;
		const existing = byKey.get( key );
		// Prefer the entry with a non-empty title — output-shaped
		// results carry the actual post_title; input-only references
		// only know the id.
		if ( ! existing || ( ! existing.title && ent.title ) ) {
			byKey.set( key, ent );
		}
	};

	for ( const tc of toolCalls ) {
		// Errored calls didn't touch anything — skip so we don't
		// surface an "open" affordance for an entity the agent never
		// actually fetched.
		if ( tc.error ) {
			continue;
		}
		const args = ( tc.args ?? {} ) as Record< string, unknown >;
		const out = ( tc.output ?? {} ) as Record< string, unknown >;

		// Output-shaped: tool returned a full post record (the canonical
		// shape from `dm/get-post-by-id` and `dm/update-post`).
		const outId = pickPositiveInt( out.id );
		if ( outId > 0 ) {
			remember( {
				kind: 'post',
				id: outId,
				title:
					typeof out.title === 'string' ? out.title : '',
				icon: 'dashicons-admin-post',
			} );
			continue;
		}

		// Input-shaped fallback: tool only carries `post_id` in args
		// (e.g. an abilities that returns `{ updated: true }`). Use
		// it so the user still sees the post they targeted.
		const argId = pickPositiveInt( args.post_id );
		if ( argId > 0 ) {
			remember( {
				kind: 'post',
				id: argId,
				title: '',
				icon: 'dashicons-admin-post',
			} );
		}
	}

	return Array.from( byKey.values() );
}

function pickPositiveInt( raw: unknown ): number {
	if ( typeof raw === 'number' && raw > 0 && Number.isFinite( raw ) ) {
		return raw;
	}
	if ( typeof raw === 'string' && raw !== '' ) {
		const n = Number( raw );
		if ( Number.isFinite( n ) && n > 0 ) {
			return n;
		}
	}
	return 0;
}

/**
 * Render one entity as a small tile — icon + title — that opens the
 * entity on double-click. Single-click leaves selection alone so the
 * standard browser "double-click to open" muscle memory applies.
 *
 * @internal
 */
function buildEntityTile( entity: AgentRunEntity ): HTMLElement {
	const tile = document.createElement( 'div' );
	tile.className = 'desktop-mode-agent-run__entity';
	tile.setAttribute( 'role', 'button' );
	tile.setAttribute( 'tabindex', '0' );
	tile.dataset.entityKind = entity.kind;
	tile.dataset.entityId = String( entity.id );

	const icon = document.createElement( 'span' );
	icon.className = `dashicons ${ entity.icon }`;
	icon.setAttribute( 'aria-hidden', 'true' );
	tile.appendChild( icon );

	const label = document.createElement( 'span' );
	label.className = 'desktop-mode-agent-run__entity-label';
	const displayTitle =
		entity.title || sprintf(
			// translators: %d is the entity numeric id (fallback when title is unknown).
			__( '#%d', 'desktop-mode' ),
			entity.id,
		);
	label.textContent = displayTitle;
	tile.appendChild( label );

	tile.setAttribute(
		'aria-label',
		sprintf(
			// translators: 1: entity kind (post / page / …), 2: title or id.
			__( 'Open %1$s "%2$s"', 'desktop-mode' ),
			entity.kind,
			displayTitle,
		),
	);

	const open = (): void => {
		openEntity( entity );
	};
	// Click + dblclick + keyboard activation — the tile is small and
	// disposable, so we don't want the user to guess between single
	// and double click. Wallpaper desktop icons open on dblclick,
	// but everything else in the desktop shell that *looks like a
	// button* opens on a single click; these tiles are buttons.
	tile.addEventListener( 'click', open );
	tile.addEventListener( 'dblclick', open );
	tile.addEventListener( 'keydown', ( ev: KeyboardEvent ) => {
		if ( ev.key === 'Enter' || ev.key === ' ' ) {
			ev.preventDefault();
			open();
		}
	} );
	return tile;
}

/**
 * Open a touched entity in an iframe window. For posts this is the
 * Block Editor at `post.php?post=<id>&action=edit`, routed through
 * `wp.desktop.windowManager.open(…)` — the same path the My
 * WordPress tile menu uses for "Open" so the window lands with the
 * standard chrome and lifecycle. Falls back to a top-level navigate
 * if the window manager isn't attached yet (unlikely after init).
 *
 * @internal
 */
function openEntity( entity: AgentRunEntity ): void {
	if ( entity.kind !== 'post' ) {
		return;
	}
	const desktop = (
		window as unknown as {
			wp?: {
				desktop?: {
					config?: { adminUrl?: string };
					windowManager?: {
						open: ( args: {
							id?: string;
							url: string;
							title: string;
							icon?: string;
						} ) => unknown;
					};
				};
			};
		}
	).wp?.desktop;
	const base = desktop?.config?.adminUrl ?? '/wp-admin/';
	const url = `${ base.replace( /\/$/, '' ) }/post.php?post=${ entity.id }&action=edit`;
	const title = entity.title || `#${ entity.id }`;
	// eslint-disable-next-line no-console
	console.info(
		'[desktop-mode/agents] openEntity →',
		entity.kind,
		entity.id,
		url,
	);
	const manager = desktop?.windowManager;
	if ( manager && typeof manager.open === 'function' ) {
		// Call as `manager.open(...)` — NOT a destructured `open(...)` —
		// because `WindowManager.open` uses `this` internally (focus
		// bookkeeping, per-desktop lookup). Calling it bare throws on
		// the first `this.` access and the editor never opens.
		manager.open( {
			id: `agent-run-entity-post-${ entity.id }`,
			url,
			title,
			icon: entity.icon,
		} );
		return;
	}
	// Final fallback — let the browser navigate. The desktop shell's
	// admin-link interceptor catches it on the next page load.
	// eslint-disable-next-line no-console
	console.warn(
		'[desktop-mode/agents] wp.desktop.windowManager.open missing — falling back to navigate.',
	);
	window.location.href = url;
}

function buildToolEntry( tc: AgentToolCall ): HTMLElement {
	const det = document.createElement( 'details' );
	det.className = 'desktop-mode-agent-run__toolcall';
	if ( tc.error ) {
		det.classList.add( 'desktop-mode-agent-run__toolcall--error' );
	}
	const summary = document.createElement( 'summary' );
	summary.textContent = tc.error
		? sprintf(
			// translators: 1: ability slug, 2: error message.
			__( '🛠 %1$s — %2$s', 'desktop-mode' ),
			tc.name,
			tc.error,
		)
		: sprintf(
			// translators: %s is the ability slug.
			__( '🛠 %s', 'desktop-mode' ),
			tc.name,
		);
	det.appendChild( summary );
	const pre = document.createElement( 'pre' );
	pre.textContent =
		'args:\n' +
		JSON.stringify( tc.args, null, 2 ) +
		'\n\nresult:\n' +
		JSON.stringify( tc.output, null, 2 );
	det.appendChild( pre );
	return det;
}

/**
 * Register the render callback on module load. The main desktop
 * bundle imports this module so the window is wired before the
 * first send-to invocation.
 *
 * @internal
 */
export function registerAgentRunWindow(): void {
	const registry = ( window as unknown as {
		desktopModeNativeWindows?: Record<
			string,
			( ( body: HTMLElement ) => unknown ) | undefined
		>;
	} ).desktopModeNativeWindows ?? {};
	( window as unknown as {
		desktopModeNativeWindows?: Record<
			string,
			( ( body: HTMLElement ) => unknown ) | undefined
		>;
	} ).desktopModeNativeWindows = registry;
	if ( ! registry[ WINDOW_ID ] ) {
		registry[ WINDOW_ID ] = renderCallback;
	}
}

/**
 * Programmatic accessor for tests + future producer-side callers
 * (the dossier chat panel may move here too).
 *
 * @public
 */
export function getAgentRunStore() {
	return store;
}
