/**
 * WooCommerce panels, bands, and badges for the site window.
 *
 * Subscribes to the extension points the site window fires — a preview
 * slot, a folder slot, a list-banding filter, and a per-tile
 * decoration action — and uses them to make a shop read like a shop:
 *
 *   - Orders band by status, needing-attention first.
 *   - Products band by stock (empty shelves first) then by category,
 *     and out-of-stock tiles carry a badge.
 *   - The right pane carries merchant facts, with everything that has
 *     an edit screen rendered as a link to it.
 *   - The Woo folder shows store headline numbers.
 *
 * Deliberately a separate bundle from `my-wordpress`: enqueued only
 * when WooCommerce is active, so every other site ships none of it.
 * It talks to the site window purely through the public hook contract
 * — the same one any third-party plugin would use.
 */
import { addAction, addFilter } from '../../hooks';
import { __, sprintf } from '../../i18n';
import { trackedFetch } from '../../tracked-fetch';
// Registers the `<os-ribbon>` tag this bundle stamps onto tiles. The
// main desktop bundle defines it too, but this bundle can load into a
// window whose shell bundle hasn't, so it owns its own import.
import '../../ui/components/os-ribbon/os-ribbon';
import '../../ui/components/os-badge/os-badge';
import type { OsBadgeTone } from '../../ui/components/os-badge/os-badge';

/** Tone vocabulary shared by the status pills and the tile ribbons. */
type BadgeTone = OsBadgeTone;

/* -------------------------------------------------------------------
 * Contracts
 * ---------------------------------------------------------------- */

interface OrderBand {
	id: string;
	label: string;
	order: number;
	/** WooCommerce status slugs, without the `wc-` prefix. */
	statuses?: string[];
}

/**
 * A band the server decided on. Rows carry their band id on
 * `open_station_woo.band`, and the collection is already ordered to
 * match, so the client only has to render.
 */
interface WooBand {
	id: string;
	label: string;
	order: number;
	tone?: 'warn' | 'danger';
	count?: number;
}

interface WooConfig {
	restRoot: string;
	restNonce: string;
	canOrders: boolean;
	orderBands?: OrderBand[];
	productBands?: WooBand[];
	couponBands?: WooBand[];
}

/** A name paired with the screen that edits it. */
interface LinkedRef {
	label: string;
	editUrl: string;
}

interface PreviewExtrasPayload {
	slot: string;
	container: HTMLElement;
	entityId: string;
	kind: string;
	item: Record< string, unknown >;
}

interface GroupExtrasPayload {
	container: HTMLElement;
	groupId: string;
	entityIds: string[];
}

interface ListTilePayload {
	tile: HTMLElement;
	entityId: string;
	kind: string;
	item: Record< string, unknown >;
}

interface ListBanding {
	bands: Array< { id: string; label: string; order?: number } >;
	assign: ( item: Record< string, unknown > ) => string | null;
}

/** The `open_station_woo` REST field on a product row. */
interface ProductRowFacts {
	stockStatus: string;
	stockLevel: number | null;
	onSale: boolean;
	categories: string[];
}

interface ProductSummary {
	type: 'product';
	sku: string;
	price: string;
	regular: string;
	onSale: boolean;
	stockStatus: string;
	stockLabel: string;
	stockLevel: number | null;
	sold: number;
	rating: number;
	reviews: number;
	productType: string;
	variations: number;
	categories: string[];
	permalink: string;
	editUrl: string;
}

interface OrderSummary {
	type: 'order';
	number: string;
	status: string;
	statusLabel: string;
	total: string;
	subtotal: string;
	shipping: string;
	discount: string;
	coupons: string[];
	paymentVia: string;
	placed: string;
	customer: string;
	customerUrl: string;
	email: string;
	itemCount: number;
	items: Array< {
		name: string;
		quantity: number;
		total: string;
		id: number;
		editUrl: string;
	} >;
	editUrl: string;
}

interface CouponSummary {
	type: 'coupon';
	code: string;
	active: boolean;
	inactiveWhy: string;
	discount: string;
	description: string;
	used: number;
	usageLimit: number;
	perUserLimit: number;
	limitToItems: number;
	granted: string;
	created: string;
	expires: string;
	minSpend: string;
	maxSpend: string;
	freeShipping: boolean;
	individualUse: boolean;
	excludeSale: boolean;
	products: LinkedRef[];
	excluded: LinkedRef[];
	categories: LinkedRef[];
	emails: string[];
	editUrl: string;
}

interface StoreSummary {
	revenue: string;
	processing: number;
	outOfStock: number;
}

type Summary = ProductSummary | OrderSummary | CouponSummary;

const PANEL_CLASS = 'os-woo-panel';

/**
 * Units at or below which a managed-stock product is tinted amber.
 * WooCommerce's own low-stock threshold is a store setting; this is
 * only a display tint, so a fixed shelf-is-nearly-empty number is
 * enough and costs no extra request.
 */
const LOW_STOCK_THRESHOLD = 5;

/** Section ids this integration knows how to decorate. */
const SECTION_ORDERS = 'wc-orders';
const SECTION_PRODUCTS = 'cpt-product';
const SECTION_COUPONS = 'cpt-shop_coupon';

function getConfig(): WooConfig | null {
	const cfg = ( window as unknown as { openStationWooConfig?: WooConfig } )
		.openStationWooConfig;
	return cfg && typeof cfg.restRoot === 'string' ? cfg : null;
}

/* -------------------------------------------------------------------
 * Transport
 * ---------------------------------------------------------------- */

/**
 * Fetch a payload, or an explanation of why it couldn't be fetched.
 *
 * Deliberately not "return null on failure": a panel that silently
 * declines to render is indistinguishable from a panel that decided it
 * had nothing to say, and that cost real debugging time. Failures come
 * back as a message the caller shows in the panel, and are logged with
 * the URL and status.
 */
async function fetchJson< T >(
	path: string,
): Promise< { data: T } | { error: string } > {
	const cfg = getConfig();
	if ( ! cfg ) {
		return {
			error: __( 'WooCommerce data is unavailable.', 'desktop-mode' ),
		};
	}
	const url = cfg.restRoot + path;
	try {
		const response = await trackedFetch(
			url,
			{
				method: 'GET',
				credentials: 'same-origin',
				headers: {
					'X-WP-Nonce': cfg.restNonce,
					Accept: 'application/json',
				},
			},
			{ source: 'desktop-mode/woocommerce' },
		);
		if ( ! response.ok ) {
			// eslint-disable-next-line no-console -- surfaces a failure the user would otherwise see as a blank panel.
			console.warn(
				`[openstation] WooCommerce request failed: ${ response.status } ${ url }`,
			);
			return {
				error: sprintf(
					/* translators: %d: HTTP status code. */
					__(
						'Could not load WooCommerce details (%d).',
						'desktop-mode',
					),
					response.status,
				),
			};
		}
		return { data: ( await response.json() ) as T };
	} catch ( err ) {
		// eslint-disable-next-line no-console -- ditto.
		console.warn(
			`[openstation] WooCommerce request errored: ${ url }`,
			err,
		);
		return {
			error: __( 'Could not load WooCommerce details.', 'desktop-mode' ),
		};
	}
}

/* -------------------------------------------------------------------
 * Panel primitives
 * ---------------------------------------------------------------- */

/** Format an ISO date as a short local date, or '' when absent. */
function shortDate( iso: string ): string {
	if ( ! iso ) {
		return '';
	}
	try {
		return new Date( iso ).toLocaleDateString( undefined, {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
		} );
	} catch {
		return iso;
	}
}

/** One `label: value` row. `value` may be a node for richer content. */
function row( label: string, value: string | Node | null ): HTMLElement | null {
	if ( value === null || value === '' ) {
		return null;
	}
	const dt = document.createElement( 'dt' );
	dt.className = `${ PANEL_CLASS }__label`;
	dt.textContent = label;

	const dd = document.createElement( 'dd' );
	dd.className = `${ PANEL_CLASS }__value`;
	if ( typeof value === 'string' ) {
		dd.textContent = value;
	} else {
		dd.appendChild( value );
	}

	const wrap = document.createElement( 'div' );
	wrap.className = `${ PANEL_CLASS }__row`;
	wrap.append( dt, dd );
	return wrap;
}

/**
 * A link to an admin screen, or plain text when there's nothing to
 * link to (a deleted product, a guest customer, a user the viewer
 * can't edit).
 */
function link( label: string, href: string ): Node {
	if ( ! href ) {
		return document.createTextNode( label );
	}
	const a = document.createElement( 'a' );
	a.className = `${ PANEL_CLASS }__link`;
	a.href = href;
	a.textContent = label;
	// Admin screens open as their own desktop window rather than
	// navigating the shell out from under the user.
	a.target = '_blank';
	a.rel = 'noopener noreferrer';
	return a;
}

/** A comma-separated run of links. */
function linkList( refs: LinkedRef[] | undefined ): Node | null {
	if ( ! refs || refs.length === 0 ) {
		return null;
	}
	const wrap = document.createElement( 'span' );
	refs.forEach( ( ref, i ) => {
		if ( i > 0 ) {
			wrap.appendChild( document.createTextNode( ', ' ) );
		}
		wrap.appendChild( link( ref.label, ref.editUrl ) );
	} );
	return wrap;
}

/** Build the panel shell. Null rows are dropped. */
function panel(
	title: string,
	rows: Array< HTMLElement | null >,
	modifier: string,
): HTMLElement {
	const host = document.createElement( 'section' );
	host.className = `${ PANEL_CLASS } ${ PANEL_CLASS }--${ modifier }`;

	const heading = document.createElement( 'h3' );
	heading.className = `${ PANEL_CLASS }__title`;
	heading.textContent = title;
	host.appendChild( heading );

	const list = document.createElement( 'dl' );
	list.className = `${ PANEL_CLASS }__rows`;
	rows.forEach( ( r ) => {
		if ( r ) {
			list.appendChild( r );
		}
	} );
	host.appendChild( list );

	return host;
}

/**
 * A status pill — active/inactive, order status, stock.
 *
 * `<os-badge>` owns the pill shape, the tone-coded dot and the
 * theming tokens; this is just the tone mapping.
 */
function pill( text: string, tone: BadgeTone ): HTMLElement {
	const badge = document.createElement( 'os-badge' );
	badge.setAttribute( 'tone', tone );
	badge.className = `${ PANEL_CLASS }__pill`;
	badge.textContent = text;
	return badge;
}

/** Price line — sale price with the regular price struck through. */
function priceNode( price: string, regular: string ): HTMLElement {
	const wrap = document.createElement( 'span' );
	if ( regular ) {
		const was = document.createElement( 's' );
		was.className = `${ PANEL_CLASS }__was`;
		was.textContent = regular;
		wrap.append( was, document.createTextNode( ' ' ) );
	}
	const now = document.createElement( 'strong' );
	now.textContent = price;
	wrap.appendChild( now );
	return wrap;
}

/** Yes/no facts read better as a single line of enabled flags. */
function flagList( flags: Array< [ boolean, string ] > ): string {
	const on = flags.filter( ( [ enabled ] ) => enabled ).map( ( [ , l ] ) => l );
	return on.join( ' · ' );
}

/**
 * Paint a panel that claims its final height immediately.
 *
 * The data needs a request, but appending the panel only once that
 * request lands shoves everything below it down mid-interaction. So the
 * shell goes in synchronously with one placeholder row per row the real
 * panel will have, and the fetch swaps the contents in place. Same box,
 * same height, no reflow.
 *
 * @param host     Slot container to append into.
 * @param title    Panel heading.
 * @param modifier BEM modifier for the panel.
 * @param rowCount How many rows the filled panel will have.
 * @param load     Resolves to the finished rows, or an error message.
 */
function paintPanel(
	host: HTMLElement,
	title: string,
	modifier: string,
	rowCount: number,
	load: () => Promise<
		{ rows: Array< HTMLElement | null > } | { error: string }
	>,
): void {
	const placeholders = Array.from( { length: rowCount }, () => {
		const el = document.createElement( 'div' );
		el.className = `${ PANEL_CLASS }__row ${ PANEL_CLASS }__row--placeholder`;
		el.setAttribute( 'aria-hidden', 'true' );
		// Two cells so the placeholder occupies both grid columns and
		// measures exactly like a real row.
		el.append(
			document.createElement( 'span' ),
			document.createElement( 'span' ),
		);
		return el;
	} );

	const shell = panel( title, placeholders, modifier );
	shell.setAttribute( 'aria-busy', 'true' );
	host.appendChild( shell );

	/** Swap the placeholders for a message. */
	const fail = ( message: string ): void => {
		const list = shell.querySelector( `.${ PANEL_CLASS }__rows` );
		if ( ! list ) {
			return;
		}
		list.replaceChildren();
		const note = document.createElement( 'p' );
		note.className = `${ PANEL_CLASS }__error`;
		note.textContent = message;
		list.appendChild( note );
	};

	void load()
		.then( ( result ) => {
			if ( ! shell.isConnected ) {
				return;
			}
			shell.removeAttribute( 'aria-busy' );
			if ( 'error' in result ) {
				fail( result.error );
				return;
			}
			const list = shell.querySelector( `.${ PANEL_CLASS }__rows` );
			if ( ! list ) {
				return;
			}
			list.replaceChildren();
			result.rows.forEach( ( r ) => {
				if ( r ) {
					list.appendChild( r );
				}
			} );
		} )
		.catch( ( err ) => {
			// The payload passes through
			// `open_station_my_wordpress_woo_summary`, so a plugin can
			// rename or drop a field the row builders read. Without
			// this the panel sat on its placeholders forever, looking
			// like a request that never came back.
			if ( ! shell.isConnected ) {
				return;
			}
			shell.removeAttribute( 'aria-busy' );
			// eslint-disable-next-line no-console -- the panel shows a summary; the console carries the cause.
			console.warn( '[openstation] WooCommerce panel failed to render', err );
			fail( __( 'Could not show WooCommerce details.', 'desktop-mode' ) );
		} );
}

/* -------------------------------------------------------------------
 * Tone helpers
 * ---------------------------------------------------------------- */

/**
 * Stock tint: red when the shelf is empty, amber when it's nearly
 * empty or on backorder, green otherwise. Keyed off the raw
 * WooCommerce slug so no translation can break it.
 */
function stockToneFor(
	stockStatus: string,
	stockLevel: number | null,
): BadgeTone {
	if ( stockStatus === 'outofstock' ) {
		return 'danger';
	}
	if ( stockStatus === 'onbackorder' ) {
		return 'warning';
	}
	if ( stockLevel !== null && stockLevel <= LOW_STOCK_THRESHOLD ) {
		return 'warning';
	}
	return 'success';
}

/** Order-status tint, keyed off WooCommerce's status slugs. */
function orderToneFor( status: string ): BadgeTone {
	if ( status === 'completed' ) {
		return 'success';
	}
	if (
		status === 'processing' ||
		status === 'on-hold' ||
		status === 'pending'
	) {
		return 'warning';
	}
	if (
		status === 'cancelled' ||
		status === 'failed' ||
		status === 'refunded'
	) {
		return 'danger';
	}
	return 'neutral';
}

/* -------------------------------------------------------------------
 * Panels
 * ---------------------------------------------------------------- */

function renderProduct( data: ProductSummary ): Array< HTMLElement | null > {
	const stock =
		data.stockLevel === null
			? data.stockLabel
			: sprintf(
				/* translators: 1: stock status, 2: units in stock. */
				__( '%1$s (%2$d)', 'desktop-mode' ),
				data.stockLabel,
				data.stockLevel,
			);

	// Fields are read defensively throughout: the payload passes
	// through `open_station_my_wordpress_woo_summary`, so a plugin can
	// legitimately drop or rename any of them and a bare dereference
	// would take the whole panel down.
	const reviews = Number( data.reviews ) || 0;
	const rating =
		reviews > 0
			? sprintf(
				/* translators: 1: average rating, 2: number of reviews. */
				__( '%1$s ★ (%2$d)', 'desktop-mode' ),
				( Number( data.rating ) || 0 ).toFixed( 1 ),
				reviews,
			)
			: '';

	const type =
		data.variations > 0
			? sprintf(
				/* translators: 1: product type, 2: number of variations. */
				__( '%1$s · %2$d variations', 'desktop-mode' ),
				data.productType,
				data.variations,
			)
			: data.productType;

	return [
		row( __( 'SKU', 'desktop-mode' ), data.sku ),
		row(
			data.onSale
				? __( 'Price (on sale)', 'desktop-mode' )
				: __( 'Price', 'desktop-mode' ),
			priceNode( data.price, data.regular ),
		),
		row(
			__( 'Stock', 'desktop-mode' ),
			pill( stock, stockToneFor( data.stockStatus, data.stockLevel ) ),
		),
		row(
			__( 'Sold', 'desktop-mode' ),
			data.sold > 0
				? sprintf(
					/* translators: %d: units sold. */
					__( '%d units', 'desktop-mode' ),
					data.sold,
				)
				: '',
		),
		row( __( 'Rating', 'desktop-mode' ), rating ),
		row( __( 'Type', 'desktop-mode' ), type ),
		row(
			__( 'Categories', 'desktop-mode' ),
			( data.categories ?? [] ).join( ', ' ),
		),
		row(
			__( 'Open', 'desktop-mode' ),
			data.editUrl || data.permalink
				? ( () => {
					const wrap = document.createElement( 'span' );
					if ( data.editUrl ) {
						wrap.appendChild(
							link( __( 'Edit', 'desktop-mode' ), data.editUrl ),
						);
					}
					if ( data.editUrl && data.permalink ) {
						wrap.appendChild( document.createTextNode( ' · ' ) );
					}
					if ( data.permalink ) {
						wrap.appendChild(
							link(
								__( 'View in shop', 'desktop-mode' ),
								data.permalink,
							),
						);
					}
					return wrap;
				} )()
				: null,
		),
	];
}

function renderOrder( data: OrderSummary ): Array< HTMLElement | null > {
	const items = document.createElement( 'ul' );
	items.className = `${ PANEL_CLASS }__items`;
	const lineItems = data.items ?? [];
	lineItems.forEach( ( item ) => {
		const li = document.createElement( 'li' );
		li.className = `${ PANEL_CLASS }__item`;

		const name = document.createElement( 'span' );
		const qty = document.createElement( 'span' );
		qty.className = `${ PANEL_CLASS }__item-qty`;
		qty.textContent = sprintf(
			/* translators: %d: quantity ordered. */
			__( '%d×', 'desktop-mode' ),
			item.quantity,
		);
		name.append( qty, link( item.name, item.editUrl ) );

		const total = document.createElement( 'span' );
		total.className = `${ PANEL_CLASS }__item-total`;
		total.textContent = item.total;

		li.append( name, total );
		items.appendChild( li );
	} );

	const customer = document.createElement( 'span' );
	customer.appendChild( link( data.customer, data.customerUrl ) );
	if ( data.email ) {
		const mail = document.createElement( 'a' );
		mail.className = `${ PANEL_CLASS }__email`;
		mail.href = `mailto:${ data.email }`;
		mail.textContent = data.email;
		customer.append( document.createElement( 'br' ), mail );
	}

	return [
		row(
			__( 'Status', 'desktop-mode' ),
			pill( data.statusLabel, orderToneFor( data.status ) ),
		),
		row( __( 'Total', 'desktop-mode' ), data.total ),
		row( __( 'Subtotal', 'desktop-mode' ), data.subtotal ),
		row( __( 'Shipping', 'desktop-mode' ), data.shipping ),
		row( __( 'Discount', 'desktop-mode' ), data.discount ),
		row(
			__( 'Coupons', 'desktop-mode' ),
			( data.coupons ?? [] ).join( ', ' ),
		),
		row( __( 'Paid via', 'desktop-mode' ), data.paymentVia ),
		row( __( 'Customer', 'desktop-mode' ), customer ),
		row( __( 'Placed', 'desktop-mode' ), shortDate( data.placed ) ),
		row(
			sprintf(
				/* translators: %d: number of line items. */
				__( 'Items (%d)', 'desktop-mode' ),
				data.itemCount,
			),
			lineItems.length > 0 ? items : null,
		),
		row(
			__( 'Open', 'desktop-mode' ),
			data.editUrl
				? link( __( 'Edit in WooCommerce', 'desktop-mode' ), data.editUrl )
				: null,
		),
	];
}

function renderCoupon( data: CouponSummary ): Array< HTMLElement | null > {
	const usage =
		data.usageLimit > 0
			? sprintf(
				/* translators: 1: times used, 2: usage limit. */
				__( '%1$d of %2$d', 'desktop-mode' ),
				data.used,
				data.usageLimit,
			)
			: sprintf(
				/* translators: %d: times used. */
				__( '%d (no limit)', 'desktop-mode' ),
				data.used,
			);

	const restrictions = flagList( [
		[ data.individualUse, __( 'Individual use only', 'desktop-mode' ) ],
		[ data.excludeSale, __( 'Excludes sale items', 'desktop-mode' ) ],
		[ data.freeShipping, __( 'Grants free shipping', 'desktop-mode' ) ],
	] );

	return [
		row(
			__( 'Status', 'desktop-mode' ),
			data.active
				? pill( __( 'Active', 'desktop-mode' ), 'success' )
				: pill(
					data.inactiveWhy || __( 'Inactive', 'desktop-mode' ),
					'danger',
				),
		),
		row( __( 'Discount', 'desktop-mode' ), data.discount ),
		row( __( 'Description', 'desktop-mode' ), data.description ),
		row( __( 'Used', 'desktop-mode' ), usage ),
		row(
			__( 'Per customer', 'desktop-mode' ),
			data.perUserLimit > 0
				? sprintf(
					/* translators: %d: per-customer usage limit. */
					__( '%d uses', 'desktop-mode' ),
					data.perUserLimit,
				)
				: '',
		),
		row(
			__( 'Limit to items', 'desktop-mode' ),
			data.limitToItems > 0 ? String( data.limitToItems ) : '',
		),
		// The number WooCommerce never puts in front of a merchant:
		// what this coupon has actually cost the store.
		row( __( 'Discount given', 'desktop-mode' ), data.granted ),
		row( __( 'Created', 'desktop-mode' ), shortDate( data.created ) ),
		row(
			__( 'Expires', 'desktop-mode' ),
			data.expires
				? shortDate( data.expires )
				: __( 'Never', 'desktop-mode' ),
		),
		row( __( 'Minimum spend', 'desktop-mode' ), data.minSpend ),
		row( __( 'Maximum spend', 'desktop-mode' ), data.maxSpend ),
		row( __( 'Restrictions', 'desktop-mode' ), restrictions ),
		row( __( 'Products', 'desktop-mode' ), linkList( data.products ) ),
		row( __( 'Excludes', 'desktop-mode' ), linkList( data.excluded ) ),
		row( __( 'Categories', 'desktop-mode' ), linkList( data.categories ) ),
		row(
			__( 'Allowed emails', 'desktop-mode' ),
			( data.emails ?? [] ).join( ', ' ),
		),
		row(
			__( 'Open', 'desktop-mode' ),
			data.editUrl
				? link( __( 'Edit coupon', 'desktop-mode' ), data.editUrl )
				: null,
		),
	];
}

/* -------------------------------------------------------------------
 * Wiring
 * ---------------------------------------------------------------- */

/**
 * Panel headings and how many rows each fills. The row count only
 * sizes the placeholder shell — a panel whose data omits an optional
 * fact ends up shorter, which is a shrink rather than a shove, so it
 * doesn't push content around under the pointer.
 */
const PANEL_TITLES: Record< Summary[ 'type' ], string > = {
	product: __( 'Product', 'desktop-mode' ),
	order: __( 'Order', 'desktop-mode' ),
	coupon: __( 'Coupon', 'desktop-mode' ),
};

const PANEL_ROW_COUNTS: Record< Summary[ 'type' ], number > = {
	product: 8,
	order: 10,
	coupon: 12,
};

/** Which summary type — if any — a section maps to. */
function summaryTypeFor( entityId: string ): Summary[ 'type' ] | null {
	if ( entityId === SECTION_ORDERS ) {
		return 'order';
	}
	if ( entityId === SECTION_PRODUCTS ) {
		return 'product';
	}
	if ( entityId === SECTION_COUPONS ) {
		return 'coupon';
	}
	return null;
}

/** Read the `open_station_woo` REST field off a product list row. */
function productFacts( item: Record< string, unknown > ): ProductRowFacts | null {
	const facts = item.open_station_woo as ProductRowFacts | null | undefined;
	return facts && typeof facts.stockStatus === 'string' ? facts : null;
}

/** The server-decided band id on any WooCommerce list row. */
function wooBand( item: Record< string, unknown > ): string | null {
	const facts = item.open_station_woo as { band?: string } | null | undefined;
	return facts && typeof facts.band === 'string' ? facts.band : null;
}

addFilter(
	'os.my-wordpress.list-bands',
	'desktop-mode/woocommerce',
	(
		banding: ListBanding | null,
		entity: { id: string },
	): ListBanding | null => {
		const cfg = getConfig();
		if ( ! cfg ) {
			return banding;
		}

		if ( entity.id === SECTION_ORDERS && cfg.orderBands?.length ) {
			const bands = cfg.orderBands;
			// Slug → band id, resolved once rather than per row.
			const byStatus = new Map< string, string >();
			bands.forEach( ( band ) => {
				( band.statuses ?? [] ).forEach( ( status ) =>
					byStatus.set( status, band.id ),
				);
			} );
			return {
				bands,
				assign: ( item ) =>
					byStatus.get( String( item.wcStatus ?? '' ) ) ?? null,
			};
		}

		// Products and coupons carry their band on the row itself,
		// decided by the same server-side rules that ordered the
		// collection — so the tiles can't disagree with the order they
		// arrive in.
		if ( entity.id === SECTION_PRODUCTS && cfg.productBands?.length ) {
			return {
				bands: cfg.productBands,
				assign: ( item ) => wooBand( item ),
			};
		}

		if ( entity.id === SECTION_COUPONS && cfg.couponBands?.length ) {
			return {
				bands: cfg.couponBands,
				assign: ( item ) => wooBand( item ),
			};
		}

		return banding;
	},
);

addAction(
	'os.my-wordpress.list-tile',
	'desktop-mode/woocommerce',
	( payload: ListTilePayload ) => {
		if ( payload.entityId !== SECTION_PRODUCTS ) {
			return;
		}
		const facts = productFacts( payload.item );
		if ( ! facts ) {
			return;
		}

		// An out-of-stock product is the one thing a merchant must not
		// miss while scanning the grid, so it gets a badge on the tile
		// rather than only a band heading.
		// Labels stay short: `<os-ribbon>` crops its corner slice to
		// roughly 80px, so "Out of stock" would clip.
		let label = '';
		let tone: 'danger' | 'warning' | 'success' = 'warning';
		if ( facts.stockStatus === 'outofstock' ) {
			label = __( 'Sold out', 'desktop-mode' );
			tone = 'danger';
		} else if ( facts.stockStatus === 'onbackorder' ) {
			label = __( 'Backorder', 'desktop-mode' );
			tone = 'warning';
		} else if (
			facts.stockLevel !== null &&
			facts.stockLevel <= LOW_STOCK_THRESHOLD
		) {
			label = sprintf(
				/* translators: %d: units left in stock. */
				__( '%d left', 'desktop-mode' ),
				facts.stockLevel,
			);
			tone = 'warning';
		} else if ( facts.onSale ) {
			label = __( 'Sale', 'desktop-mode' );
			tone = 'success';
		}

		if ( ! label ) {
			return;
		}
		// Remembered on the element so the ribbon can be restored
		// after a repaint — `<os-tile>` clears every `<os-ribbon>`
		// it finds each time it paints, and it repaints on selection.
		payload.tile.dataset.wooRibbon = `${ tone }|${ label }`;
		stampRibbon( payload.tile );
	},
);

/**
 * Put the stock ribbon back on a tile that remembers it.
 *
 * `<os-tile>._paint()` drops every direct `<os-ribbon>` child before
 * rebuilding, so a decoration added from outside survives exactly
 * until the next repaint — which selection triggers. Re-stamping on
 * `os.tile.rendered` (fired at the end of every paint) is
 * how a decoration stays put.
 *
 * @param tile The tile element.
 */
function stampRibbon( tile: HTMLElement ): void {
	const remembered = tile.dataset.wooRibbon;
	if ( ! remembered ) {
		return;
	}
	if ( tile.querySelector( ':scope > os-ribbon.os-woo-ribbon' ) ) {
		return;
	}
	const sep = remembered.indexOf( '|' );
	const tone = remembered.slice( 0, sep );
	const label = remembered.slice( sep + 1 );

	// `<os-ribbon>` owns the 45° corner slice, its clipping and
	// rotation, and the tone colours. Placed top-start so it can't
	// collide with the tile's own post-status ribbon, which takes the
	// top-end corner.
	const ribbon = document.createElement( 'os-ribbon' );
	ribbon.setAttribute( 'placement', 'top-start' );
	ribbon.setAttribute( 'tone', tone );
	ribbon.className = 'os-woo-ribbon';
	ribbon.textContent = label;
	tile.appendChild( ribbon );
}

addAction(
	'os.tile.rendered',
	'desktop-mode/woocommerce',
	( payload: { tile: HTMLElement } ) => {
		stampRibbon( payload.tile );
	},
);

addAction(
	'os.my-wordpress.preview-extras',
	'desktop-mode/woocommerce',
	( payload: PreviewExtrasPayload ) => {
		// One panel per preview, above the content.
		if ( payload.slot !== 'header' ) {
			return;
		}
		const type = summaryTypeFor( payload.entityId );
		if ( ! type ) {
			return;
		}
		const id = Number( payload.item?.id );
		if ( ! Number.isFinite( id ) || id <= 0 ) {
			return;
		}

		paintPanel(
			payload.container,
			PANEL_TITLES[ type ],
			type,
			PANEL_ROW_COUNTS[ type ],
			async () => {
				const result = await fetchJson< Summary >(
					`summary/${ type }/${ id }`,
				);
				if ( 'error' in result ) {
					return result;
				}
				const { data } = result;
				if ( data.type === 'product' ) {
					return { rows: renderProduct( data ) };
				}
				if ( data.type === 'order' ) {
					return { rows: renderOrder( data ) };
				}
				if ( data.type === 'coupon' ) {
					return { rows: renderCoupon( data ) };
				}
				return { rows: [] };
			},
		);
	},
);

addAction(
	'os.my-wordpress.group-extras',
	'desktop-mode/woocommerce',
	( payload: GroupExtrasPayload ) => {
		if ( payload.groupId !== 'plugin:woocommerce' ) {
			return;
		}
		const cfg = getConfig();
		if ( ! cfg?.canOrders ) {
			return;
		}

		paintPanel(
			payload.container,
			__( 'Store', 'desktop-mode' ),
			'store',
			3,
			async () => {
				const result = await fetchJson< StoreSummary >( 'store' );
				if ( 'error' in result ) {
					return result;
				}
				const { data } = result;
				return {
					rows: [
						row(
							__( 'Revenue this month', 'desktop-mode' ),
							data.revenue,
						),
						row(
							__( 'Awaiting action', 'desktop-mode' ),
							sprintf(
								/* translators: %d: number of orders. */
								__( '%d orders', 'desktop-mode' ),
								data.processing,
							),
						),
						row(
							__( 'Out of stock', 'desktop-mode' ),
							data.outOfStock > 0
								? sprintf(
									/* translators: %d: number of products. */
									__( '%d products', 'desktop-mode' ),
									data.outOfStock,
								)
								: __( 'None', 'desktop-mode' ),
						),
					],
				};
			},
		);
	},
);
