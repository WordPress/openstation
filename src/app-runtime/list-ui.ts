/**
 * App Framework — the furniture every list window shares.
 *
 * Posts, Pages, Users and every list a plugin ships wear the same
 * three pieces: a status filter across the top that is a segmented
 * pill bar on a desk and a picker on a phone; a footer pager with
 * Previous / Next and a per-page select; and a "Show columns" section
 * in the window's ⋯ menu. The first native list built all three by
 * hand; the second copied them. They live here so an app declares
 * what its list IS (the segments, the page, the columns) and never
 * how those controls are wired.
 *
 * The templates dispatch through the attribute vocabulary, so they
 * work under a client view and a server view alike:
 *
 *   - {@link statusControl} writes `os-bind` (the status key) and
 *     `os-action` (the action that resets to page 1 and re-queries).
 *   - {@link pager} dispatches `os-action="<pageAction>"` with
 *     `os-arg-page` for Previous / Next, and binds the per-page
 *     `<os-select>` to a state key with the same re-query action.
 *   - {@link mountMenuCheckboxes} is imperative: the ⋯ menu belongs
 *     to the window chrome, outside the app's mount root.
 *
 * The matching layout classes (`.os-app-list__*`) are in
 * `assets/css/app-runtime.css`.
 *
 * @public
 */

import { isMobileStamped } from '../mode/stamp';
import { html, type TemplateResult } from '../ui/core/html';

/** One entry of the status filter. `value` is sent verbatim to the server. */
export interface StatusSegment {
	value: string;
	label: string;
}

export interface StatusControlOptions {
	/** The status list, already filtered. */
	segments: readonly StatusSegment[];
	/** The current status (`''` for All). */
	value: string;
	/** State key the control writes (`os-bind`). */
	bind: string;
	/** Action dispatched on pick — the app's "reset to page 1 and re-query". */
	action: string;
	/** Accessible name of the control. */
	label: string;
	/**
	 * Whether to render the phone picker. Defaults to the shell's mode
	 * stamp — a desktop window pulled narrow keeps the pills (they wrap,
	 * which is fine under a mouse), a phone gets the picker even in
	 * landscape.
	 */
	phone?: boolean;
}

/**
 * The status filter: `<os-segmented>` on a desk, `<os-select>` on a
 * phone, where six pills in 360px wrap into two ragged rows and push
 * the search field off the toolbar. The two components share their
 * contract (`value`, `os-pick`), so the binding is the same.
 */
export function statusControl( opts: StatusControlOptions ): TemplateResult {
	const phone = opts.phone ?? isMobileStamped();
	if ( phone ) {
		return html`<os-select
			class="os-app-list__status"
			os-bind=${ opts.bind }
			os-action=${ opts.action }
			value=${ opts.value }
			aria-label=${ opts.label }
		>${ opts.segments.map(
			( seg ) => html`<os-option value=${ seg.value }>${ seg.label }</os-option>`,
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
	/** 1-based current page. */
	page: number;
	/** Total pages the server reports. */
	pages: number;
	/** Rows per page. */
	perPage: number;
	/** The meta text — "Page 1 of 3 · 42 posts", or "No posts". The app owns the noun. */
	summary: string;
	/** Action for Previous / Next; receives `page` in `$args`. Default `page`. */
	pageAction?: string;
	/** State key the per-page select writes. Default `perPage`. */
	perPageBind?: string;
	/** Action dispatched when the per-page select changes. Default `filter`. */
	perPageAction?: string;
	/** Per-page choices. Default 10 / 20 / 50 / 100. */
	perPageOptions?: readonly number[];
	labels: {
		previous: string;
		next: string;
		perPage: string;
	};
}

/**
 * The footer pager: page indicator, Previous / Next, per-page select.
 * Previous / Next dispatch `pageAction` with `os-arg-page`; the select
 * binds `perPageBind` and dispatches `perPageAction` (which should
 * reset to page 1, since the page count just changed).
 */
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
	/** The section label above the items ("Show columns"). */
	section: string;
	/** The togglable items, in order. */
	items: ReadonlyArray< { key: string; label: string } >;
	/** Whether an item currently reads as checked. */
	isChecked: ( key: string ) => boolean;
	/** The user toggled an item. */
	onToggle: ( key: string ) => void;
	/**
	 * Keeps this app's item values distinct in the window's shared
	 * menu panel — the app id is the natural choice.
	 */
	prefix: string;
}

export interface MenuCheckboxes {
	/** Re-paint the items' checked state after an external change. */
	refresh: () => void;
	/** Remove the section — on teardown. */
	dispose: () => void;
}

/**
 * Append a checkbox section (a label plus one `menuitemcheckbox` row
 * per item) to the window's title-bar ⋯ menu. The menu is built by
 * the shell at window construction, outside the app's mount root, so
 * this is imperative by nature: call it from `mounted()`, keep the
 * handle, `dispose()` in the teardown.
 *
 * Idempotent per prefix — a previous injection under the same prefix
 * is dropped first, so a close-and-reopen without a chrome rebuild
 * never stacks two sections. Returns `null` when the window's menu
 * cannot be found (a chrome the shell rebuilt between renders) or
 * there is nothing to toggle; callers tolerate the null and skip the
 * feature.
 *
 * @param root The app's mount root (or anything inside the window).
 * @param opts What to render and how to answer.
 */
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
