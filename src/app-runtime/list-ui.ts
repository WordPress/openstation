import { isMobileStamped } from '../mode/stamp';
import { html, type TemplateResult } from '../ui/core/html';

export interface StatusSegment {
	value: string;
	label: string;
}

export interface StatusControlOptions {

	segments: readonly StatusSegment[];

	value: string;

	bind: string;

	action: string;

	label: string;

	phone?: boolean;
}

export function statusControl( opts: StatusControlOptions ): TemplateResult {
	const phone = opts.phone ?? isMobileStamped();
	if ( phone ) {
		return html`<os-select
			class="os-app-list__status"
			os-bind=${ opts.bind }
			os-action=${ opts.action }
			.value=${ opts.value }
			aria-label=${ opts.label }
		>${ opts.segments.map(
			( seg ) => html`<os-option .value=${ seg.value }>${ seg.label }</os-option>`,
		) }</os-select>`;
	}
	return html`<os-segmented
		class="os-app-list__status"
		os-bind=${ opts.bind }
		os-action=${ opts.action }
		value=${ opts.value }
		label=${ opts.label }
	>${ opts.segments.map(
		( seg ) => html`<os-segment value=${ seg.value }>${ seg.label }</os-segment>`,
	) }</os-segmented>`;
}

export interface PagerOptions {

	page: number;

	pages: number;

	perPage: number;

	summary: string;

	pageAction?: string;

	perPageBind?: string;

	perPageAction?: string;

	perPageOptions?: readonly number[];
	labels: {
		previous: string;
		next: string;
		perPage: string;
	};
}

export function pager( opts: PagerOptions ): TemplateResult {
	const page = Math.max( 1, opts.page );
	const pages = Math.max( 0, opts.pages );
	const perPage = Number( opts.perPage ) || 20;
	const pageAction = opts.pageAction ?? 'page';
	const options = opts.perPageOptions ?? [ 10, 20, 50, 100 ];
	return html`<footer class="os-app-list__pager">
		<div class="os-app-list__pager-meta">
			<span>${ opts.summary }</span>
		</div>
		<div class="os-app-list__pager-nav">
			<os-button
				variant="ghost"
				os-action=${ pageAction }
				os-arg-page=${ page - 1 }
				?disabled=${ page <= 1 }
			>
				<span class="dashicons dashicons-arrow-left-alt2" aria-hidden="true"></span>
				${ opts.labels.previous }
			</os-button>
			<os-button
				variant="ghost"
				os-action=${ pageAction }
				os-arg-page=${ page + 1 }
				?disabled=${ page >= pages }
			>
				${ opts.labels.next }
				<span class="dashicons dashicons-arrow-right-alt2" aria-hidden="true"></span>
			</os-button>
			<label class="os-app-list__pager-perpage">
				${ opts.labels.perPage }
				<os-select
					os-bind=${ opts.perPageBind ?? 'perPage' }
					os-action=${ opts.perPageAction ?? 'filter' }
					value=${ String( perPage ) }
					aria-label=${ opts.labels.perPage }
				>${ options.map(
					( n ) => html`<os-option value=${ n }>${ n }</os-option>`,
				) }</os-select>
			</label>
		</div>
	</footer>`;
}

export interface MenuCheckboxesOptions {

	section: string;

	items: ReadonlyArray< { key: string; label: string } >;

	isChecked: ( key: string ) => boolean;

	onToggle: ( key: string ) => void;

	prefix: string;
}

export interface MenuCheckboxes {

	refresh: () => void;

	dispose: () => void;
}

export function mountMenuCheckboxes(
	root: HTMLElement,
	opts: MenuCheckboxesOptions,
): MenuCheckboxes | null {
	const win = root.closest< HTMLElement >( '.os-window' );
	const panel = win?.querySelector< HTMLElement >( '.os-window__menu-panel' ) ?? null;
	if ( ! panel || opts.items.length === 0 ) {
		return null;
	}
	const prefix = `${ opts.prefix }:`;
	const marker = `data-os-app-menu-section`;
	panel
		.querySelectorAll( `[${ marker }="${ opts.prefix }"]` )
		.forEach( ( node ) => node.remove() );

	const sectionLabel = document.createElement( 'div' );
	sectionLabel.className = 'os-app__menu-section';
	sectionLabel.setAttribute( 'role', 'presentation' );
	sectionLabel.setAttribute( marker, opts.prefix );
	sectionLabel.textContent = opts.section;
	panel.appendChild( sectionLabel );

	const itemEls = new Map< string, HTMLElement >();
	for ( const item of opts.items ) {
		const el = document.createElement( 'os-menu-item' );
		el.setAttribute( 'role', 'menuitemcheckbox' );
		el.setAttribute( 'value', prefix + item.key );
		el.setAttribute( marker, opts.prefix );
		el.classList.add( 'os-window__menu-item', 'os-app__menu-item' );
		el.textContent = item.label || item.key;
		panel.appendChild( el );
		itemEls.set( item.key, el );
	}

	const refresh = (): void => {
		for ( const [ key, el ] of itemEls ) {
			if ( opts.isChecked( key ) ) {
				el.setAttribute( 'checked', '' );
			} else {
				el.removeAttribute( 'checked' );
			}
		}
	};
	refresh();

	const onClick = ( ev: Event ): void => {
		const value = ( ev as CustomEvent< { value?: string | null } > ).detail?.value;
		if ( typeof value !== 'string' || ! value.startsWith( prefix ) ) {
			return;
		}
		const key = value.slice( prefix.length );
		if ( ! itemEls.has( key ) ) {
			return;
		}
		opts.onToggle( key );
		refresh();
	};
	panel.addEventListener( 'os-menu-item-click', onClick );

	return {
		refresh,
		dispose: () => {
			panel.removeEventListener( 'os-menu-item-click', onClick );
			sectionLabel.remove();
			for ( const el of itemEls.values() ) {
				el.remove();
			}
			itemEls.clear();
		},
	};
}
