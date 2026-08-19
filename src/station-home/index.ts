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
import '../ui/components/os-modal/os-modal';
import '../ui/components/os-relative-time/os-relative-time';
import '../ui/components/os-spinner/os-spinner';
import '../ui/components/os-switch/os-switch';

const WINDOW_ID = 'desktop-mode-dashboard';

interface StationHomeConfig {
	endpoint: string;
	cardsEndpoint: string;
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

export interface StationHomeCard {
	id: string;
	label: string;
	description: string;
	provider: string;
	icon: string;
	value: string;
	detail: string;
	url: string;
	actionLabel: string;
	external: boolean;
	tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger';
}

export interface StationHomeCardPreference {
	id: string;
	label: string;
	description: string;
	provider: string;
	icon: string;
	enabled: boolean;
	defaultEnabled: boolean;
}

interface StationHomeSnapshot {
	userName: string;
	siteName: string;
	work: WorkItem[];
	quickActions: QuickAction[];
	metrics: Metric[];
	attention: AttentionItem[];
	cards: StationHomeCard[];
	cardPreferences: StationHomeCardPreference[];
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

function cardIcon( value: string ): HTMLElement {
	if ( value.startsWith( 'dashicons-' ) ) {
		return icon( value );
	}
	const image = document.createElement( 'img' );
	image.src = value;
	image.alt = '';
	image.loading = 'lazy';
	return image;
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

export function renderCards( host: HTMLElement, cards: StationHomeCard[] ): void {
	host.replaceChildren();
	if ( cards.length === 0 ) {
		const empty = document.createElement( 'div' );
		empty.className = 'os-station-home__cards-empty';
		empty.append( icon( 'dashicons-admin-plugins' ) );
		const copy = document.createElement( 'span' );
		const title = document.createElement( 'strong' );
		title.textContent = __( 'Make this space yours' );
		const description = document.createElement( 'span' );
		description.textContent = __(
			'Use Customize to opt in to information from your plugins.',
		);
		copy.append( title, description );
		empty.append( copy );
		host.append( empty );
		return;
	}

	for ( const card of cards ) {
		const surface = card.url
			? document.createElement( 'a' )
			: document.createElement( 'article' );
		surface.className = 'os-station-home__card';
		surface.dataset.tone = card.tone;
		if ( surface instanceof HTMLAnchorElement ) {
			surface.href = card.url;
			if ( card.external ) {
				surface.target = '_blank';
				surface.rel = 'noopener';
			}
		}

		const head = document.createElement( 'span' );
		head.className = 'os-station-home__card-head';
		const glyph = document.createElement( 'span' );
		glyph.className = 'os-station-home__card-icon';
		glyph.append( cardIcon( card.icon ) );
		const identity = document.createElement( 'span' );
		const label = document.createElement( 'strong' );
		label.textContent = card.label;
		identity.append( label );
		if ( card.provider ) {
			const provider = document.createElement( 'span' );
			provider.textContent = card.provider;
			identity.append( provider );
		}
		head.append( glyph, identity );
		surface.append( head );

		if ( card.value ) {
			const value = document.createElement( 'strong' );
			value.className = 'os-station-home__card-value';
			value.textContent = card.value;
			surface.append( value );
		}

		const detailText = card.detail || card.description;
		if ( detailText ) {
			const detail = document.createElement( 'span' );
			detail.className = 'os-station-home__card-detail';
			detail.textContent = detailText;
			surface.append( detail );
		}

		if ( card.url ) {
			const action = document.createElement( 'span' );
			action.className = 'os-station-home__card-action';
			action.textContent = card.actionLabel || __( 'Open' );
			action.append( icon( 'dashicons-arrow-right-alt2' ) );
			surface.append( action );
		}

		host.append( surface );
	}
}

export function renderCardPreferences(
	host: HTMLElement,
	preferences: StationHomeCardPreference[],
): void {
	host.replaceChildren();
	for ( const preference of preferences ) {
		const control = document.createElement( 'os-switch' );
		control.setAttribute( 'value', preference.id );
		control.setAttribute( 'label', preference.label );
		control.setAttribute(
			'description',
			[ preference.provider, preference.description ].filter( Boolean ).join( ' — ' ),
		);
		control.setAttribute( 'block', '' );
		control.setAttribute( 'size', 'sm' );
		control.setAttribute( 'tone', 'accent' );
		if ( preference.enabled ) {
			control.setAttribute( 'checked', '' );
		}
		host.append( control );
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
	const cardsSection = requiredElement< HTMLElement >(
		body,
		'[data-os-station-home-cards-section]',
	);
	const cards = requiredElement< HTMLElement >( body, '[data-os-station-home-cards]' );
	const customize = requiredElement< HTMLElement >(
		body,
		'[data-os-station-home-customize]',
	);
	const cardModal = requiredElement< HTMLElement >(
		body,
		'[data-os-station-home-card-modal]',
	);
	const cardPreferences = requiredElement< HTMLElement >(
		body,
		'[data-os-station-home-card-preferences]',
	);
	const error = requiredElement< HTMLElement >( body, '[data-os-station-home-error]' );
	const loading = requiredElement< HTMLElement >( body, '[data-os-station-home-loading]' );
	const refresh = requiredElement< HTMLElement >( body, '[data-os-station-home-refresh]' );
	const config = window.wp?.os?.getWindowConfig< StationHomeConfig >( WINDOW_ID );
	if ( ! config?.endpoint || ! config.cardsEndpoint ) {
		throw new Error( '[station-home] Missing REST endpoint configuration.' );
	}

	let snapshot: StationHomeSnapshot | null = null;
	let generation = 0;
	let disposed = false;
	let savingPreference = false;

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
		cardsSection.hidden = next.cardPreferences.length === 0;
		renderCards( cards, next.cards );
		renderCardPreferences( cardPreferences, next.cardPreferences );
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
	const onCustomize = (): void => {
		cardModal.setAttribute( 'open', '' );
	};
	const onCardPreference = ( event: Event ): void => {
		if ( savingPreference || ! snapshot ) {
			return;
		}
		const target = event.target;
		const detail = ( event as CustomEvent< { checked?: boolean } > ).detail;
		if ( ! ( target instanceof HTMLElement ) || ! target.matches( 'os-switch' ) ) {
			return;
		}
		const id = target.getAttribute( 'value' ) || '';
		if ( ! id || typeof detail?.checked !== 'boolean' ) {
			return;
		}

		savingPreference = true;
		for ( const control of Array.from( cardPreferences.querySelectorAll( 'os-switch' ) ) ) {
			control.setAttribute( 'disabled', '' );
		}
		error.hidden = true;

		void trackedFetch(
			config.cardsEndpoint,
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify( { id, enabled: detail.checked } ),
				signal: ctx?.signal,
			},
			{ windowId: WINDOW_ID, source: 'station-home/preferences' },
		)
			.then( async ( response ) => {
				if ( ! response.ok ) {
					throw new Error( `HTTP ${ response.status }` );
				}
				const next = ( await response.json() ) as StationHomeSnapshot;
				if ( ! disposed ) {
					paint( next );
				}
			} )
			.catch( ( caught ) => {
				if ( ctx?.signal.aborted || disposed ) {
					return;
				}
				renderCardPreferences( cardPreferences, snapshot?.cardPreferences ?? [] );
				error.textContent = __(
					'Station Home could not save that card preference. Try again.',
				);
				error.hidden = false;
				// eslint-disable-next-line no-console
				console.error( '[station-home] card preference failed:', caught );
			} )
			.finally( () => {
				savingPreference = false;
				for ( const control of Array.from(
					cardPreferences.querySelectorAll( 'os-switch' ),
				) ) {
					control.removeAttribute( 'disabled' );
				}
			} );
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
	customize.addEventListener( 'click', onCustomize );
	cardPreferences.addEventListener( 'os-switch-change', onCardPreference );
	actions.addEventListener( 'click', onAction );
	const stopShow = ctx?.onShow( () => {
		void load();
	} );

	await load();
	return () => {
		disposed = true;
		generation++;
		refresh.removeEventListener( 'click', onRefresh );
		customize.removeEventListener( 'click', onCustomize );
		cardPreferences.removeEventListener( 'os-switch-change', onCardPreference );
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
