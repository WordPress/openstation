/**
 * Station Home — native OpenStation dashboard renderer.
 *
 * PHP provides a stable, accessible frame. This lazy bundle fetches the
 * current user's role-aware snapshot and enhances the declared mount points.
 */

import { __, sprintf } from '../i18n';
import { trackedFetch } from '../tracked-fetch';
import type { NativeRenderContext } from '../types';
import { stationHomeGreeting } from './model';
import '../ui/components/os-badge/os-badge';
import '../ui/components/os-button/os-button';
import '../ui/components/os-empty-state/os-empty-state';
import '../ui/components/os-relative-time/os-relative-time';
import '../ui/components/os-spinner/os-spinner';

const WINDOW_ID = 'desktop-mode-dashboard';

interface StationHomeConfig {
	endpoint: string;
}

interface WorkItem {
	id: number;
	title: string;
	typeLabel: string;
	icon: string;
	status: string;
	statusLabel: string;
	modifiedGmt: string;
	editUrl: string;
}

interface QuickAction {
	id: string;
	label: string;
	icon: string;
	kind: 'url' | 'external' | 'native' | 'classic';
	url?: string;
	windowId?: string;
}

interface Metric {
	id: string;
	label: string;
	icon: string;
	value: number;
}

interface AttentionItem {
	id: string;
	icon: string;
	count: number;
	label: string;
	description: string;
	url: string;
}

interface StationHomeSnapshot {
	userName: string;
	siteName: string;
	work: WorkItem[];
	quickActions: QuickAction[];
	metrics: Metric[];
	attention: AttentionItem[];
}

type RenderCallback = ( body: HTMLElement ) => void;

declare global {
	interface Window {
		openStationNativeWindows?: Record< string, RenderCallback | undefined >;
	}
}

function requiredElement< T extends HTMLElement >(
	body: HTMLElement,
	selector: string,
): T {
	const element = body.querySelector< T >( selector );
	if ( ! element ) {
		throw new Error( `[station-home] Missing template element: ${ selector }` );
	}
	return element;
}

function icon( className: string ): HTMLSpanElement {
	const span = document.createElement( 'span' );
	span.className = `dashicons ${ className }`;
	span.setAttribute( 'aria-hidden', 'true' );
	return span;
}

function statusTone( status: string ): string {
	switch ( status ) {
		case 'publish':
			return 'success';
		case 'pending':
		case 'future':
			return 'warning';
		case 'private':
			return 'info';
		default:
			return 'neutral';
	}
}

function renderActions( host: HTMLElement, actions: QuickAction[] ): void {
	host.replaceChildren();
	for ( const action of actions ) {
		let control: HTMLElement;
		if ( ( action.kind === 'url' || action.kind === 'external' ) && action.url ) {
			const link = document.createElement( 'a' );
			link.href = action.url;
			if ( action.kind === 'external' ) {
				link.target = '_blank';
				link.rel = 'noopener';
			}
			control = link;
		} else {
			control = document.createElement( 'os-button' );
			control.setAttribute( 'variant', 'ghost' );
			control.dataset.stationAction = action.id;
		}
		control.classList.add( 'os-station-home__action' );
		control.title = action.label;
		control.append( icon( action.icon ) );
		const label = document.createElement( 'span' );
		label.textContent = action.label;
		control.append( label );
		host.append( control );
	}
}

function renderWork( host: HTMLElement, work: WorkItem[] ): void {
	host.replaceChildren();
	if ( work.length === 0 ) {
		const empty = document.createElement( 'os-empty-state' );
		empty.setAttribute( 'icon', 'welcome-write-blog' );
		empty.setAttribute( 'heading', __( 'Your desk is clear' ) );
		empty.setAttribute(
			'description',
			__( 'Start something new and it will be waiting here when you return.' ),
		);
		host.append( empty );
		return;
	}

	for ( const item of work ) {
		const row = document.createElement( 'a' );
		row.className = 'os-station-home__work-row';
		row.href = item.editUrl;

		const glyph = document.createElement( 'span' );
		glyph.className = 'os-station-home__row-icon';
		glyph.append( icon( item.icon ) );
		row.append( glyph );

		const copy = document.createElement( 'span' );
		copy.className = 'os-station-home__row-copy';
		const title = document.createElement( 'span' );
		title.className = 'os-station-home__row-title';
		title.textContent = item.title;
		const meta = document.createElement( 'span' );
		meta.className = 'os-station-home__row-meta';
		meta.textContent = item.typeLabel;
		copy.append( title, meta );
		row.append( copy );

		const badge = document.createElement( 'os-badge' );
		badge.setAttribute( 'tone', statusTone( item.status ) );
		badge.textContent = item.statusLabel;
		row.append( badge );

		if ( item.modifiedGmt ) {
			const time = document.createElement( 'os-relative-time' );
			time.setAttribute( 'datetime', item.modifiedGmt );
			time.setAttribute( 'compact', '' );
			row.append( time );
		}
		row.append( icon( 'dashicons-arrow-right-alt2' ) );
		host.append( row );
	}
}

function renderMetrics( host: HTMLElement, metrics: Metric[] ): void {
	host.replaceChildren();
	for ( const metric of metrics ) {
		const instrument = document.createElement( 'article' );
		instrument.className = 'os-station-home__metric';
		const head = document.createElement( 'div' );
		head.className = 'os-station-home__metric-label';
		head.append( icon( metric.icon ) );
		const label = document.createElement( 'span' );
		label.textContent = metric.label;
		head.append( label );
		const value = document.createElement( 'strong' );
		value.textContent = metric.value.toLocaleString();
		instrument.append( head, value );
		host.append( instrument );
	}
}

function renderAttention( host: HTMLElement, attention: AttentionItem[] ): void {
	host.replaceChildren();
	if ( attention.length === 0 ) {
		const clear = document.createElement( 'div' );
		clear.className = 'os-station-home__all-clear';
		clear.append( icon( 'dashicons-yes-alt' ) );
		const copy = document.createElement( 'span' );
		const title = document.createElement( 'strong' );
		title.textContent = __( 'All clear' );
		const description = document.createElement( 'span' );
		description.textContent = __( 'Nothing needs your attention right now.' );
		copy.append( title, description );
		clear.append( copy );
		host.append( clear );
		return;
	}

	for ( const item of attention ) {
		const row = document.createElement( 'a' );
		row.className = 'os-station-home__attention-row';
		row.href = item.url;
		const count = document.createElement( 'span' );
		count.className = 'os-station-home__attention-count';
		count.append( icon( item.icon ) );
		const number = document.createElement( 'strong' );
		number.textContent = item.count.toLocaleString();
		count.append( number );
		const copy = document.createElement( 'span' );
		copy.className = 'os-station-home__attention-copy';
		const title = document.createElement( 'strong' );
		title.textContent = item.label;
		const description = document.createElement( 'span' );
		description.textContent = item.description;
		copy.append( title, description );
		row.append( count, copy, icon( 'dashicons-arrow-right-alt2' ) );
		host.append( row );
	}
}

async function renderStationHome(
	body: HTMLElement,
	ctx?: NativeRenderContext,
): Promise< () => void > {
	const root = requiredElement< HTMLElement >( body, '[data-os-station-home-root]' );
	const actions = requiredElement< HTMLElement >( body, '[data-os-station-home-actions]' );
	const greeting = requiredElement< HTMLElement >( body, '[data-os-station-home-greeting]' );
	const summary = requiredElement< HTMLElement >( body, '[data-os-station-home-summary]' );
	const work = requiredElement< HTMLElement >( body, '[data-os-station-home-work]' );
	const pulse = requiredElement< HTMLElement >( body, '[data-os-station-home-pulse]' );
	const attention = requiredElement< HTMLElement >( body, '[data-os-station-home-attention]' );
	const error = requiredElement< HTMLElement >( body, '[data-os-station-home-error]' );
	const loading = requiredElement< HTMLElement >( body, '[data-os-station-home-loading]' );
	const refresh = requiredElement< HTMLElement >( body, '[data-os-station-home-refresh]' );
	const config = window.wp?.os?.getWindowConfig< StationHomeConfig >( WINDOW_ID );
	if ( ! config?.endpoint ) {
		throw new Error( '[station-home] Missing REST endpoint configuration.' );
	}

	let snapshot: StationHomeSnapshot | null = null;
	let generation = 0;
	let disposed = false;

	const paint = ( next: StationHomeSnapshot ): void => {
		snapshot = next;
		greeting.textContent = stationHomeGreeting(
			new Date().getHours(),
			next.userName,
		);
		summary.textContent = next.siteName
			? sprintf(
				/* translators: %s: site name. */
				__( 'Pick up where you left off on %s.' ),
				next.siteName,
			)
			: __( 'Pick up where you left off.' );
		renderActions( actions, next.quickActions );
		renderWork( work, next.work );
		renderMetrics( pulse, next.metrics );
		renderAttention( attention, next.attention );
	};

	const load = async ( manual = false ): Promise< void > => {
		const requestGeneration = ++generation;
		if ( manual ) {
			ctx?.markLoading();
		}
		root.dataset.state = snapshot ? 'refreshing' : 'loading';
		loading.hidden = snapshot !== null;
		refresh.setAttribute( 'busy', '' );
		error.hidden = true;
		try {
			const response = await trackedFetch(
				config.endpoint,
				{ signal: ctx?.signal },
				{ windowId: WINDOW_ID, source: 'station-home' },
			);
			if ( ! response.ok ) {
				throw new Error( `HTTP ${ response.status }` );
			}
			const next = ( await response.json() ) as StationHomeSnapshot;
			if ( disposed || requestGeneration !== generation ) {
				return;
			}
			paint( next );
			root.dataset.state = 'ready';
		} catch ( caught ) {
			if ( ctx?.signal.aborted || disposed || requestGeneration !== generation ) {
				return;
			}
			root.dataset.state = snapshot ? 'ready' : 'error';
			error.textContent = snapshot
				? __( 'Station Home could not refresh. Your last snapshot is still here.' )
				: __( 'Station Home could not load. Try refreshing the window.' );
			error.hidden = false;
			// eslint-disable-next-line no-console
			console.error( '[station-home] snapshot failed:', caught );
		} finally {
			if ( ! disposed && requestGeneration === generation ) {
				loading.hidden = true;
				refresh.removeAttribute( 'busy' );
				if ( manual ) {
					ctx?.markReady();
				}
			}
		}
	};

	const onRefresh = (): void => {
		void load( true );
	};
	const onAction = ( event: Event ): void => {
		const target = event.target;
		if ( ! ( target instanceof Element ) ) {
			return;
		}
		const control = target.closest< HTMLElement >( '[data-station-action]' );
		if ( ! control || ! snapshot ) {
			return;
		}
		const action = snapshot.quickActions.find(
			( item ) => item.id === control.dataset.stationAction,
		);
		if ( ! action ) {
			return;
		}
		if ( action.kind === 'native' && action.windowId ) {
			window.wp?.os?.openWindow( action.windowId, { source: 'station-home' } );
			return;
		}
		if ( action.kind === 'classic' && action.url ) {
			window.wp?.os?.windowManager.open( {
				id: 'classic-dashboard',
				baseId: 'classic-dashboard',
				url: action.url,
				title: __( 'Classic Dashboard' ),
				icon: 'dashicons-dashboard',
			} );
		}
	};

	refresh.addEventListener( 'click', onRefresh );
	actions.addEventListener( 'click', onAction );
	const stopShow = ctx?.onShow( () => {
		void load();
	} );

	await load();
	return () => {
		disposed = true;
		generation++;
		refresh.removeEventListener( 'click', onRefresh );
		actions.removeEventListener( 'click', onAction );
		stopShow?.();
	};
}

const registry = ( window.openStationNativeWindows ??=
	{} ) as Record< string, RenderCallback | undefined >;
registry[ WINDOW_ID ] = ( ( body: HTMLElement, ctx?: NativeRenderContext ) =>
	renderStationHome( body, ctx ).catch( ( caught ) => {
		// eslint-disable-next-line no-console
		console.error( '[station-home] render failed:', caught );
	} ) ) as unknown as RenderCallback;
