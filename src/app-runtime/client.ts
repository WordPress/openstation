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
export {
	createListTableSync,
	type ListTableLike,
	type ListTableSync,
	type ListTableSyncOptions,
	type ListTableSyncResult,
} from './list-table';
export type { ConfirmSpec, RuntimeHost } from './types';

export type LocalAction< S, D > = (
	state: S,
	args: Record< string, unknown >,
	data: D,
) => S | void;

export interface MenuTab {
	id: string;
	label: string;
}

export interface ViewContext< S, D > {
	readonly state: S;
	readonly data: D;

	dispatch: (
		action: string,
		args?: Record< string, unknown >,
		options?: { confirm?: ConfirmSpec | null },
	) => Promise< boolean >;

	local: ( action: string, args?: Record< string, unknown > ) => void;

	root: HTMLElement;

	readonly windowId: string;

	readonly extra: Record< string, unknown >;

	ui: < T >( factory: () => T ) => T;

	repaint: () => void;

	fetch: ( path: string, init?: RequestInit, options?: { silent?: boolean } ) => Promise< Response >;

	host: RuntimeHost;

	readonly loading: boolean;
}

export interface ClientAppDef< S, D > {

	local?: Record< string, LocalAction< S, D > >;

	placeholder?: ( state: S ) => D;

	view: ( ctx: ViewContext< S, D > ) => TemplateResult;

	mounted?: ( ctx: ViewContext< S, D > ) => void | ( () => void );

	updated?: ( ctx: ViewContext< S, D > ) => void;
}

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

	placeholder?: ( state: Record< string, unknown > ) => unknown;
}

interface ClientGlobals {
	openStationApps?: Record< string, ClientApp | undefined >;
}

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
	const { placeholder } = def;
	if ( placeholder ) {
		app.placeholder = ( state ) => placeholder( state as S );
	}
	const globals = window as unknown as ClientGlobals;
	( globals.openStationApps ??= {} )[ id ] = app;
	return app;
}

export function clientAppFor( id: string ): ClientApp | undefined {
	return ( window as unknown as ClientGlobals ).openStationApps?.[ id ];
}
