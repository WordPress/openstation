/**
 * App Framework — the `.os.ts` half of an app.
 *
 * An `.os.php` file owns the window, the state schema, the server
 * actions and the DATA. When an app also needs instant, in-browser
 * interaction — a filter that must not wait for a WordPress request
 * — it adds a `.os.ts` beside it:
 *
 *   // apps/hello/hello.os.ts
 *   import { defineApp, html } from '@openstation/app';
 *
 *   export default defineApp< State, Data >( 'hello', {
 *       local: {
 *           // Runs in the browser, re-renders instantly, no request.
 *           range: ( state, args ) => ( { ...state, range: String( args.value ) } ),
 *       },
 *       view: ( { state, data } ) => html`
 *           <os-segmented os-action="range" value=${ state.range }>…</os-segmented>
 *           <ul>${ data.rows.filter( … ).map( ( r ) => html`<li>${ r.label }</li>` ) }</ul>
 *       `,
 *   } );
 *
 * The contract with the server stays exactly the same: `state` is the
 * typed bag the PHP side declared, `data` is what `App::data()`
 * returned on the last server round trip, and any `os-action` that is
 * NOT in `local` is a normal dispatch — the server runs it, returns
 * fresh `state` + `data`, and the client view re-renders. `os-bind`
 * writes are local when a client view exists. Effects, polling,
 * confirmations, title-bar buttons and ⋯ rows are unchanged.
 *
 * The view is a function of `( state, data )`, rendered with the same
 * tagged template the component kit uses — the framework diffs it in
 * place, so nodes survive re-renders. Triggers keep the attribute
 * vocabulary (`os-action`, `os-bind`, `os-arg-*`, …); `@click=${ fn }`
 * bindings also work for anything purely local.
 *
 * Built by `npm run build:apps` into `assets/js/apps/<name>[.min].js`
 * (every `apps/*\/*.os.ts` is discovered) and loaded by the shell with
 * the window, before the runtime mounts it.
 *
 * @public
 */

import { __, _n, _x, sprintf } from '../i18n';
import { html, render, type TemplateResult } from '../ui/core/html';
import type { ConfirmSpec, RuntimeHost } from './types';

export { html, __, _n, _x, sprintf };
export type { TemplateResult };
export { formatBytes, formatDate, type DateStyle } from './format';
export { createPagedList, type PagedList, type PageEnvelope } from './paged-list';
export { applySelection, createMarquee } from './selection';
export { copyText } from './clipboard';
export {
	statusControl,
	pager,
	mountMenuCheckboxes,
	type StatusSegment,
	type StatusControlOptions,
	type PagerOptions,
	type MenuCheckboxesOptions,
	type MenuCheckboxes,
} from './list-ui';
export type { ConfirmSpec, RuntimeHost } from './types';

/** A reducer run in the browser. Return the next state, or mutate and return nothing. */
export type LocalAction< S, D > = (
	state: S,
	args: Record< string, unknown >,
	data: D,
) => S | void;

/**
 * What the view (and lifecycle hooks) receive.
 *
 * `state` and `data` are LIVE: reading them always answers with the
 * current values, never a snapshot — so a listener installed in
 * `mounted()` can safely read `ctx.state` months of renders later.
 */
export interface ViewContext< S, D > {
	readonly state: S;
	readonly data: D;
	/**
	 * Run a server action (a round trip). `options.confirm` asks the
	 * shell's confirm dialog first — the same dialog the declarative
	 * `os-confirm` attribute uses, so an action reached imperatively
	 * (a context-menu row) confirms exactly like its button twin.
	 */
	dispatch: (
		action: string,
		args?: Record< string, unknown >,
		options?: { confirm?: ConfirmSpec | null },
	) => Promise< boolean >;
	/** Run a local action (no request). */
	local: ( action: string, args?: Record< string, unknown > ) => void;
	/** The mount root — for a ResizeObserver, a canvas, a focus() call. */
	root: HTMLElement;
	/**
	 * What the app declared with `App::config()` — static values that
	 * ship once with the window config instead of riding `data` on
	 * every response (asset URLs, feature flags, the Trash app's
	 * empty/full icon pair).
	 */
	readonly extra: Record< string, unknown >;
	/**
	 * Client-only state that must never travel to the server — an open
	 * menu, a fetch cache, an IntersectionObserver. One bag per mounted
	 * view, created by `factory` on first call and returned as-is after
	 * that; two windows of the same app never share it.
	 */
	ui: < T >( factory: () => T ) => T;
	/** Re-render the view from the current state + data, no action, no request. */
	repaint: () => void;
	/**
	 * REST fetch, the framework way: a path is resolved against the
	 * site's REST root, the nonce and JSON Accept header ride along,
	 * and the request is attributed to the window (its spinner shows).
	 */
	fetch: ( path: string, init?: RequestInit ) => Promise< Response >;
	/** The shell surface the runtime itself runs on — toast, confirm, menu, open. */
	host: RuntimeHost;
}

export interface ClientAppDef< S, D > {
	/** Actions that run in the browser. Anything else dispatches to PHP. */
	local?: Record< string, LocalAction< S, D > >;
	/** The body, as a function of state + data. */
	view: ( ctx: ViewContext< S, D > ) => TemplateResult;
	/** After the first render. Return a teardown for close. */
	mounted?: ( ctx: ViewContext< S, D > ) => void | ( () => void );
	/** After every re-render (a chart to repaint, a scroll to keep). */
	updated?: ( ctx: ViewContext< S, D > ) => void;
}

/** The runtime-facing shape `defineApp()` publishes. */
export interface ClientApp {
	id: string;
	hasLocal: ( action: string ) => boolean;
	runLocal: (
		action: string,
		state: Record< string, unknown >,
		args: Record< string, unknown >,
		data: unknown,
	) => Record< string, unknown >;
	render: ( ctx: ViewContext< Record< string, unknown >, unknown > ) => void;
	mounted: ( ctx: ViewContext< Record< string, unknown >, unknown > ) => void | ( () => void );
}

interface ClientGlobals {
	openStationApps?: Record< string, ClientApp | undefined >;
}

/**
 * Declare the client half of an app and publish it for the runtime.
 * `id` must match the `App::define( $id )` on the PHP side.
 */
export function defineApp< S extends Record< string, unknown >, D >(
	id: string,
	def: ClientAppDef< S, D >,
): ClientApp {
	const local = def.local ?? {};
	const app: ClientApp = {
		id,
		hasLocal: ( action ) => Object.prototype.hasOwnProperty.call( local, action ),
		runLocal: ( action, state, args, data ) => {
			const reducer = local[ action ];
			if ( ! reducer ) {
				return state;
			}
			const draft = { ...state } as S;
			const next = reducer( draft, args, data as D );
			return ( next === undefined ? draft : next ) as Record< string, unknown >;
		},
		render: ( ctx ) => {
			render( def.view( ctx as unknown as ViewContext< S, D > ), ctx.root );
			def.updated?.( ctx as unknown as ViewContext< S, D > );
		},
		mounted: ( ctx ) => def.mounted?.( ctx as unknown as ViewContext< S, D > ),
	};
	const globals = window as unknown as ClientGlobals;
	( globals.openStationApps ??= {} )[ id ] = app;
	return app;
}

/** The client half of an app, if its bundle has loaded. */
export function clientAppFor( id: string ): ClientApp | undefined {
	return ( window as unknown as ClientGlobals ).openStationApps?.[ id ];
}
