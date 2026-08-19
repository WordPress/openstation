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
import {
	OS_PERSON_VIEW_PARAM,
	registerNativeUrlRemap,
} from '../../native-url-remap';
import { __, _n, sprintf } from '../../i18n';
import { trackedFetch } from '../../tracked-fetch';
import {
	openProductStudio,
	registerWooProductStudio,
} from './woocommerce-product-studio';
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
 * `openstation_woo.band`, and the collection is already ordered to
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
	canCreateProducts?: boolean;
	/** Whether the viewer may see customer money at all. */
	canCustomers?: boolean;
	orderBands?: OrderBand[];
	productBands?: WooBand[];
	couponBands?: WooBand[];
	customerBands?: WooBand[];
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

/** One button in the user preview pane's action row. */
interface UserPreviewAction {
	id: string;
	label: string;
	title?: string;
	variant?: 'primary' | 'secondary';
	onSelect: () => void;
}

/** The `openstation_woo` REST field on a product row. */
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

/**
 * The `openstation_woo_customer` field carried on every row of the
 * Customers section — and on `/wp/v2/users` rows, so the built-in
 * Users section knows about money too.
 */
interface CustomerFacts {
	band: string;
	orders: number;
	spend: string;
	spendRaw: number;
	aov: string;
	firstOrder: string;
	lastOrder: string;
	daysSince: number | null;
	ordersUrl: string;
}

/** One row of a customer's order history. */
interface CustomerOrderRow {
	id: number;
	number: string;
	status: string;
	statusLabel: string;
	date: string;
	total: string;
	items: number;
	editUrl: string;
}

interface CustomerSummary {
	type: 'customer';
	id: number;
	name: string;
	username: string;
	avatar: string;
	email: string;
	phone: string;
	billing: string;
	shipping: string;
	recentOrders: CustomerOrderRow[];
	spendRaw: number;
	band: string;
	bandLabel: string;
	orders: number;
	spend: string;
	aov: string;
	firstOrder: string;
	lastOrder: string;
	daysSince: number | null;
	lastOrderNo: string;
	lastOrderUrl: string;
	lastOrderTotal: string;
	favourite: { label: string; quantity: number; editUrl: string } | null;
	location: string;
	registered: string;
	ordersUrl: string;
	profileUrl: string;
}

interface StoreSummary {
	revenue: string;
	processing: number;
	outOfStock: number;
	customers?: number;
	vips?: number;
	lapsed?: number;
	/**
	 * True when the store is past the band-ordering cap, so `vips` and
	 * `lapsed` were never computed. Not the same as both being zero.
	 */
	bandsCapped?: boolean;
	guestSpend?: string;
	guestOrders?: number;
}

type Summary =
	| ProductSummary
	| OrderSummary
	| CouponSummary
	| CustomerSummary;

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
const SECTION_CUSTOMERS = 'wc-customers';

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
	a.rel = 'noopener noreferrer';

	// Open as a desktop window, which is the whole point: the product
	// opens BESIDE the order that sold it.
	//
	// This used to be `target="_blank"` and it was wrong twice over.
	// In a browser tab it threw the admin screen outside the shell
	// entirely; and once OpenStation is installed as a PWA, a
	// `_blank` navigation to a same-origin admin URL is handled by
	// the app's scope — so clicking a product name in the preview
	// pane LAUNCHED THE INSTALLED APP. Nothing about "open this in a
	// window" implies "start the operating system again".
	//
	// The `href` stays real so middle-click, ⌘-click and "copy link"
	// still behave; only the plain click is claimed.
	a.addEventListener( 'click', ( event ) => {
		if (
			event.defaultPrevented ||
			event.button !== 0 ||
			event.metaKey ||
			event.ctrlKey ||
			event.shiftKey ||
			event.altKey
		) {
			return;
		}
		event.preventDefault();
		openAdminWindow( href, label );
	} );

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
			// `openstation_my_wordpress_woo_summary`, so a plugin can
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

/**
 * Customer-band tint. VIP reads as good news, lapsed as something to
 * do; everything between them is context and stays neutral.
 */
function customerToneFor( band: string ): BadgeTone {
	if ( band === 'vip' ) {
		return 'success';
	}
	if ( band === 'lapsed' ) {
		return 'warning';
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
	// through `openstation_my_wordpress_woo_summary`, so a plugin can
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
	const snapshot = document.createElement( 'div' );
	snapshot.className = `${ PANEL_CLASS }__row ${ PANEL_CLASS }__row--product-snapshot`;
	const snapshotLabel = document.createElement( 'dt' );
	snapshotLabel.className = 'screen-reader-text';
	snapshotLabel.textContent = __( 'Storefront snapshot', 'desktop-mode' );
	const snapshotValue = document.createElement( 'dd' );
	snapshotValue.className = `${ PANEL_CLASS }__product-snapshot`;

	const price = document.createElement( 'span' );
	price.className = `${ PANEL_CLASS }__product-metric`;
	const priceLabel = document.createElement( 'small' );
	priceLabel.textContent = data.onSale
		? __( 'Sale price', 'desktop-mode' )
		: __( 'Price', 'desktop-mode' );
	const priceValue = priceNode( data.price, data.regular );
	price.append( priceLabel, priceValue );

	const availability = document.createElement( 'span' );
	availability.className = `${ PANEL_CLASS }__product-metric`;
	const availabilityLabel = document.createElement( 'small' );
	availabilityLabel.textContent = __( 'Availability', 'desktop-mode' );
	availability.append(
		availabilityLabel,
		pill( stock, stockToneFor( data.stockStatus, data.stockLevel ) ),
	);

	const sold = document.createElement( 'span' );
	sold.className = `${ PANEL_CLASS }__product-metric`;
	const soldLabel = document.createElement( 'small' );
	soldLabel.textContent = __( 'Sold', 'desktop-mode' );
	const soldValue = document.createElement( 'strong' );
	soldValue.textContent = sprintf(
		/* translators: %d: units sold. */
		__( '%d units', 'desktop-mode' ),
		Number( data.sold ) || 0,
	);
	sold.append( soldLabel, soldValue );
	snapshotValue.append( price, availability, sold );
	snapshot.append( snapshotLabel, snapshotValue );

	return [
		snapshot,
		row( __( 'SKU', 'desktop-mode' ), data.sku ),
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

/**
 * "3 months ago", "today" — the sentence a merchant actually thinks
 * in. An ISO date alone makes you do the arithmetic.
 */
function sinceLabel( days: number | null ): string {
	if ( days === null || ! Number.isFinite( days ) ) {
		return '';
	}
	if ( days <= 0 ) {
		return __( 'Today', 'desktop-mode' );
	}
	if ( days < 60 ) {
		return sprintf(
			/* translators: %d: number of days. */
			_n( '%d day ago', '%d days ago', days ),
			days,
		);
	}
	const months = Math.round( days / 30 );
	if ( months < 24 ) {
		return sprintf(
			/* translators: %d: number of months. */
			_n( '%d month ago', '%d months ago', months ),
			months,
		);
	}
	const years = Math.round( days / 365 );
	return sprintf(
		/* translators: %d: number of years. */
		_n( '%d year ago', '%d years ago', years ),
		years,
	);
}

function renderCustomer( data: CustomerSummary ): Array< HTMLElement | null > {
	const orders = Number( data.orders ) || 0;
	const since = sinceLabel( data.daysSince ?? null );

	// Lifetime spend leads. It is the one number that ranks two
	// customers against each other, and every other row on this panel
	// is an explanation of it.
	return [
		row(
			__( 'Lifetime spend', 'desktop-mode' ),
			data.spend
				? ( () => {
					const wrap = document.createElement( 'span' );
					const strong = document.createElement( 'strong' );
					strong.textContent = data.spend;
					wrap.appendChild( strong );
					if ( data.bandLabel ) {
						wrap.appendChild( document.createTextNode( ' ' ) );
						wrap.appendChild(
							pill(
								data.bandLabel,
								customerToneFor( data.band ),
							),
						);
					}
					return wrap;
				} )()
				: null,
		),
		row(
			__( 'Orders', 'desktop-mode' ),
			orders > 0
				? sprintf(
					/* translators: %d: number of orders. */
					_n( '%d order', '%d orders', orders ),
					orders,
				)
				: __( 'None yet', 'desktop-mode' ),
		),
		row( __( 'Average order', 'desktop-mode' ), data.aov ),
		row(
			__( 'Last order', 'desktop-mode' ),
			data.lastOrderNo
				? ( () => {
					const wrap = document.createElement( 'span' );
					wrap.appendChild(
						link(
							sprintf(
								/* translators: %s: order number. */
								__( '#%s', 'desktop-mode' ),
								data.lastOrderNo,
							),
							data.lastOrderUrl,
						),
					);
					const tail = [ data.lastOrderTotal, since ].filter(
						Boolean,
					);
					if ( tail.length ) {
						wrap.appendChild(
							document.createTextNode(
								` · ${ tail.join( ' · ' ) }`,
							),
						);
					}
					return wrap;
				} )()
				: null,
		),
		row( __( 'First order', 'desktop-mode' ), shortDate( data.firstOrder ) ),
		row(
			__( 'Buys most', 'desktop-mode' ),
			data.favourite
				? ( () => {
					const wrap = document.createElement( 'span' );
					wrap.appendChild(
						link( data.favourite.label, data.favourite.editUrl ),
					);
					if ( data.favourite.quantity > 1 ) {
						wrap.appendChild(
							document.createTextNode(
								` · ${ sprintf(
									/* translators: %d: units bought. */
									__( '×%d', 'desktop-mode' ),
									data.favourite.quantity,
								) }`,
							),
						);
					}
					return wrap;
				} )()
				: null,
		),
		row( __( 'Location', 'desktop-mode' ), data.location ),
		row( __( 'Email', 'desktop-mode' ), data.email ),
		row( __( 'Customer since', 'desktop-mode' ), shortDate( data.registered ) ),
		row(
			__( 'Open', 'desktop-mode' ),
			orders > 0 && data.ordersUrl
				? link( __( 'All their orders', 'desktop-mode' ), data.ordersUrl )
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
	product: __( 'Product overview', 'desktop-mode' ),
	order: __( 'Order', 'desktop-mode' ),
	coupon: __( 'Coupon', 'desktop-mode' ),
	customer: __( 'Customer', 'desktop-mode' ),
};

const PANEL_ROW_COUNTS: Record< Summary[ 'type' ], number > = {
	product: 6,
	order: 10,
	coupon: 12,
	customer: 9,
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

/**
 * Which summary a preview pane should show.
 *
 * Section id decides it for post-shaped sections, but a *person* is
 * decided by kind rather than by section: the same customer panel
 * belongs on the Customers list and on the built-in Users list, and
 * on any section a plugin adds that renders people. Gated on
 * `canCustomers` so a viewer without order access never fires a
 * request that would 403.
 */
function previewSummaryTypeFor(
	payload: PreviewExtrasPayload,
): Summary[ 'type' ] | null {
	if ( payload.kind === 'user' || payload.entityId === SECTION_CUSTOMERS ) {
		return getConfig()?.canCustomers ? 'customer' : null;
	}
	return summaryTypeFor( payload.entityId );
}

/** Read the `openstation_woo` REST field off a product list row. */
function productFacts( item: Record< string, unknown > ): ProductRowFacts | null {
	const facts = item.openstation_woo as ProductRowFacts | null | undefined;
	return facts && typeof facts.stockStatus === 'string' ? facts : null;
}

/** The server-decided band id on any WooCommerce list row. */
function wooBand( item: Record< string, unknown > ): string | null {
	const facts = item.openstation_woo as { band?: string } | null | undefined;
	return facts && typeof facts.band === 'string' ? facts.band : null;
}

/**
 * Read the `openstation_woo_customer` REST field off a user row.
 *
 * Present on the Customers section AND on `/wp/v2/users`, so the
 * built-in Users section gets the same decoration for free — which is
 * the point: on a store, "who is this person" and "what have they
 * spent" are the same question.
 */
function customerFacts(
	item: Record< string, unknown >,
): CustomerFacts | null {
	const facts = item.openstation_woo_customer as
		| CustomerFacts
		| null
		| undefined;
	return facts && typeof facts.band === 'string' ? facts : null;
}

/** The translated label for a customer band, from the server's list. */
function customerBandLabel( band: string ): string {
	const found = getConfig()?.customerBands?.find( ( b ) => b.id === band );
	return found?.label ?? '';
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

/**
 * Turn a user tile into a customer tile.
 *
 * An icon is an icon: a face, a name, and at most one mark. Anything
 * else belongs one click away in the pane, where there is room to say
 * it properly. So this does exactly two things — it takes the stock
 * "Customer · 0 posts" sub-line off the Customers grid (in a folder
 * where every row is a customer, the word says nothing), and it puts
 * a small badge on the bottom edge of the avatar for the two bands a
 * merchant scans the grid to find.
 *
 * Deliberately NOT the corner ribbon the Products grid uses. A ribbon
 * is a 45° banner across the artwork: right on a product photo, wrong
 * on a face — at 88px it covers a third of the avatar and turns a
 * roster of people into a wall of diagonal shouting. And deliberately
 * NOT a line of text under the name: spend and order counts stacked
 * above a 48px avatar crowd the tile into unreadability, and they are
 * in the pane already.
 *
 * Runs for the Customers section AND the built-in Users section: the
 * facts ride `/wp/v2/users` too, and a user who has spent money is a
 * customer wherever you happen to be looking at them. The sub-line is
 * only stripped in the Customers section — in the Users folder
 * "Editor · 12 posts" is still the truest thing about someone.
 *
 * @param payload The `os.my-wordpress.list-tile` payload.
 * @return true when the tile was a customer tile and was handled.
 */
function decorateCustomerTile( payload: ListTilePayload ): boolean {
	if ( payload.kind !== 'user' ) {
		return false;
	}
	const facts = customerFacts( payload.item );
	if ( ! facts ) {
		return false;
	}

	if ( payload.entityId === SECTION_CUSTOMERS ) {
		payload.tile
			.querySelector( '.os-my-wordpress__user-tile-sub' )
			?.remove();
	}

	// Only the two actionable bands get a badge. Marking every band
	// would put one on every tile, which is the same as putting one
	// on none.
	if ( facts.band === 'vip' || facts.band === 'lapsed' ) {
		payload.tile.dataset.wooCustomerBand = facts.band;
		stampCustomerBand( payload.tile );
	}

	return true;
}

function productTileStatus(
	facts: ProductRowFacts,
): { label: string; tone: BadgeTone } {
	if ( facts.stockStatus === 'outofstock' ) {
		return { label: __( 'Out of stock', 'desktop-mode' ), tone: 'danger' };
	}
	if ( facts.stockStatus === 'onbackorder' ) {
		return { label: __( 'On backorder', 'desktop-mode' ), tone: 'warning' };
	}
	if ( facts.stockLevel !== null ) {
		return {
			label: sprintf(
				/* translators: %d: units available. */
				__( '%d in stock', 'desktop-mode' ),
				facts.stockLevel,
			),
			tone: facts.stockLevel <= LOW_STOCK_THRESHOLD ? 'warning' : 'success',
		};
	}
	return { label: __( 'In stock', 'desktop-mode' ), tone: 'success' };
}

/** Paint a compact commerce readout over a product thumbnail. */
function stampProductMeta( tile: HTMLElement ): void {
	if ( tile.dataset.wooProduct !== 'true' ) {
		return;
	}
	const host = tile.querySelector< HTMLElement >( '.os-file-tile__visual' );
	if ( ! host || host.querySelector( '.os-woo-product-tile__meta' ) ) {
		return;
	}
	const stockStatus = tile.dataset.wooStockStatus ?? 'instock';
	const rawLevel = tile.dataset.wooStockLevel ?? '';
	const stockLevel = rawLevel === '' ? null : Number( rawLevel );
	let categories: string[] = [];
	try {
		const parsed = JSON.parse( tile.dataset.wooCategories ?? '[]' );
		categories = Array.isArray( parsed ) ? parsed.map( String ) : [];
	} catch {
		categories = [];
	}
	const status = productTileStatus( {
		stockStatus,
		stockLevel: Number.isFinite( stockLevel ) ? stockLevel : null,
		onSale: tile.dataset.wooOnSale === 'true',
		categories,
	} );

	tile.classList.add( 'os-woo-product-tile' );
	const meta = document.createElement( 'span' );
	meta.className = 'os-woo-product-tile__meta';
	const badge = pill( status.label, status.tone );
	badge.setAttribute( 'aria-hidden', 'true' );
	meta.appendChild( badge );
	if ( categories[ 0 ] ) {
		const category = document.createElement( 'span' );
		category.className = 'os-woo-product-tile__category';
		category.textContent = categories[ 0 ];
		meta.appendChild( category );
	}
	host.appendChild( meta );
	const productName = tile.getAttribute( 'label' ) ?? '';
	tile.setAttribute(
		'aria-label',
		sprintf(
			/* translators: 1: product name, 2: inventory status. */
			__( '%1$s — %2$s', 'desktop-mode' ),
			productName,
			status.label,
		),
	);
}

/**
 * Put the band badge back on a tile that remembers it.
 *
 * `<os-tile>._paint()` rebuilds its children on every paint, and
 * selection triggers a paint — same reason the product ribbon is
 * re-stamped from `os.tile.rendered` rather than added once.
 *
 * The badge goes INSIDE `.os-file-tile__visual`, straddling the
 * avatar's bottom edge, rather than into the tile's text column. Two
 * reasons: it costs the tile no vertical space at all, and it sits
 * where the eye already is — on the face — instead of adding a line
 * the reader has to scan past to reach the name.
 *
 * @param tile The tile element.
 */
function stampCustomerBand( tile: HTMLElement ): void {
	const band = tile.dataset.wooCustomerBand;
	if ( ! band ) {
		return;
	}

	// One badge per tile, wherever it currently sits. Scoped to the
	// tile rather than to the avatar because the avatar is not stable:
	// `<os-tile>._paint()` destroys and recreates
	// `.os-file-tile__visual`, so a check scoped to the new visual
	// says "no badge here" while the old one is still on screen.
	if ( tile.querySelector( '.os-woo-customer-band' ) ) {
		return;
	}

	// No visual yet — nothing to pin a badge to.
	//
	// This is the normal state on the first call: the decoration
	// action fires from the tile builder while the element is still
	// detached and `<os-tile>` has not painted, so there is no avatar
	// box to reach. Falling back to the tile itself (which this used
	// to do) put a second badge under the name that the later,
	// correct stamp never noticed. Doing nothing is right — the
	// `os.tile.rendered` pass runs at the end of every paint and
	// stamps it then.
	const host = tile.querySelector< HTMLElement >( '.os-file-tile__visual' );
	if ( ! host ) {
		return;
	}
	host.classList.add( 'os-woo-customer-avatar' );

	const label =
		customerBandLabel( band ) ||
		( band === 'vip'
			? __( 'VIP', 'desktop-mode' )
			: __( 'Lapsed', 'desktop-mode' ) );

	const chip = document.createElement( 'span' );
	chip.className = `os-woo-customer-band os-woo-customer-band--${ band }`;
	chip.textContent = label;
	// The badge is decoration over a face; the name is the accessible
	// label, and the band is stated in full in the preview pane.
	chip.setAttribute( 'aria-hidden', 'true' );
	host.appendChild( chip );
}

addAction(
	'os.my-wordpress.list-tile',
	'desktop-mode/woocommerce',
	( payload: ListTilePayload ) => {
		if ( decorateCustomerTile( payload ) ) {
			return;
		}
		if ( payload.entityId !== SECTION_PRODUCTS ) {
			return;
		}
		const facts = productFacts( payload.item );
		if ( ! facts ) {
			return;
		}
		payload.tile.dataset.wooProduct = 'true';
		payload.tile.dataset.wooStockStatus = facts.stockStatus;
		payload.tile.dataset.wooStockLevel = facts.stockLevel === null
			? ''
			: String( facts.stockLevel );
		payload.tile.dataset.wooOnSale = String( facts.onSale );
		payload.tile.dataset.wooCategories = JSON.stringify( facts.categories ?? [] );
		stampProductMeta( payload.tile );

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
		stampCustomerBand( payload.tile );
		stampProductMeta( payload.tile );
	},
);

addAction(
	'os.my-wordpress.preview-extras',
	'desktop-mode/woocommerce',
	( payload: PreviewExtrasPayload ) => {
		const type = previewSummaryTypeFor( payload );
		if ( ! type ) {
			return;
		}
		if (
			type === 'product' &&
			payload.slot === 'footer' &&
			getConfig()?.canCreateProducts
		) {
			const action = document.createElement( 'div' );
			action.className = 'os-woo-product-create-action';
			const copy = document.createElement( 'span' );
			const title = document.createElement( 'strong' );
			title.textContent = __( 'Ready to add another product?', 'desktop-mode' );
			const body = document.createElement( 'small' );
			body.textContent = __( 'Product Studio keeps the essentials focused.', 'desktop-mode' );
			copy.append( title, body );
			const create = document.createElement( 'os-button' );
			create.setAttribute( 'variant', 'holo' );
			create.textContent = __( 'Add new product', 'desktop-mode' );
			create.addEventListener( 'click', () => {
				openProductStudio();
			} );
			action.append( copy, create );
			payload.container.appendChild( action );
			return;
		}
		// One panel per preview. A thing goes above its content
		// (`header`); a *person* goes below their name and face
		// (`meta`) — putting money above someone's avatar reads as a
		// price tag on them, and you can't tell whose figure it is
		// until you've scrolled past it to the name.
		if ( payload.slot !== ( type === 'customer' ? 'meta' : 'header' ) ) {
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
				if ( data.type === 'customer' ) {
					return { rows: renderCustomer( data ) };
				}
				return { rows: [] };
			},
		);
	},
);

/**
 * A customer's dossier is not an author's.
 *
 * The built-in dossier answers "what has this person written" — post
 * and page counts, a publishing sparkline, recent posts, top
 * categories. For someone who came to the site to buy a hat, every
 * one of those is a zero, and four zeroes above the lifetime-spend
 * figure is worse than nothing: it reads as the answer.
 *
 * Only in the Customers section. In the built-in Users folder an
 * author is still an author, and their spend is an extra fact rather
 * than a replacement for the rest of them.
 */
addFilter(
	'os.my-wordpress.user-dossier-sections',
	'desktop-mode/woocommerce',
	( sections: string[], ctx: { entityId: string } ): string[] => {
		if ( ctx.entityId !== SECTION_CUSTOMERS ) {
			return sections;
		}
		return Array.isArray( sections )
			? sections.filter( ( id ) => id === 'bio' )
			: sections;
	},
);

/**
 * Swap the preview pane's action row for one a merchant can use.
 *
 * "View activity footprint" opens a publishing-history surface, which
 * for a customer is an empty screen. Their order history is the
 * equivalent question, and it is one window away.
 */
addFilter(
	'os.my-wordpress.user-preview-actions',
	'desktop-mode/woocommerce',
	(
		actions: UserPreviewAction[],
		ctx: { entityId: string; item: Record< string, unknown > },
	): UserPreviewAction[] => {
		if ( ctx.entityId !== SECTION_CUSTOMERS || ! Array.isArray( actions ) ) {
			return actions;
		}

		const kept = actions.filter( ( a ) => a?.id !== 'footprint' );
		const facts = customerFacts( ctx.item );
		if ( ! facts?.ordersUrl ) {
			// No orders, no list to open — and a button onto an empty
			// filtered screen is a dead end.
			return kept.map( ( a ) =>
				a.id === 'open-profile' ? { ...a, variant: 'primary' } : a,
			);
		}

		return [
			{
				id: 'wc-orders',
				label: __( 'View their orders', 'desktop-mode' ),
				title: __(
					'Open the orders screen filtered to this customer, in its own window.',
					'desktop-mode',
				),
				variant: 'primary',
				onSelect: () => openAdminWindow( facts.ordersUrl, __( 'Orders', 'desktop-mode' ) ),
			},
			...kept,
		];
	},
);

/**
 * Open an admin URL as its own desktop window.
 *
 * The whole point of the section: the orders screen opens *beside*
 * the customer rather than replacing them, so you can read one while
 * looking at the other.
 *
 * The fallback is `window.open`, and it is a genuine last resort —
 * with the shell missing there is nowhere to put a window. Note it
 * behaves badly inside an installed PWA (a same-origin admin URL is
 * in scope, so the app relaunches), which is exactly why the panel's
 * links route here instead of carrying `target="_blank"`.
 *
 * @param url   Admin URL.
 * @param title Window title.
 */
function openAdminWindow( url: string, title: string ): void {
	const os = (
		window.wp as
			| {
					os?: {
						deriveWindowId?: ( target: string ) => string;
						windowManager?: {
							open: ( args: {
								id: string;
								url: string;
								title: string;
								icon?: string;
							} ) => unknown;
						};
					};
			}
			| undefined
	)?.os;
	const manager = os?.windowManager;
	if ( ! manager || typeof manager.open !== 'function' ) {
		window.open( url, '_blank', 'noopener,noreferrer' );
		return;
	}

	// `manager.open()` REQUIRES a non-empty id and throws a TypeError
	// without one — a deliberately loud boundary, since a window
	// without an id can never be focused, deduped or restored.
	//
	// `wp.os.deriveWindowId` is the shell's own slug derivation, the
	// same one the dock and the admin-link dispatcher use, so a
	// product opened from here lands on the SAME window the dock
	// would open rather than a private duplicate. The fallback slug
	// only matters if the API is missing.
	const id =
		typeof os?.deriveWindowId === 'function'
			? os.deriveWindowId( url )
			: `os-woo-${ url.replace( /[^a-z0-9]+/gi, '-' ).slice( -60 ) }`;

	manager.open( { id, url, title, icon: 'dashicons-cart' } );
}

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
			cfg.canCustomers ? 6 : 3,
			async () => {
				const result = await fetchJson< StoreSummary >( 'store' );
				if ( 'error' in result ) {
					return result;
				}
				const { data } = result;
				const customers = Number( data.customers ) || 0;
				const vips = Number( data.vips ) || 0;
				const lapsed = Number( data.lapsed ) || 0;
				const guestOrders = Number( data.guestOrders ) || 0;

				// Past the ordering cap the server never computed the
				// bands, so they are unknown rather than zero. Saying
				// so is the point: printing "0 · 0" would claim a
				// large store has no VIPs at all.
				let bands: string | null = null;
				if ( data.bandsCapped ) {
					bands = __(
						'Not counted on a store this large',
						'desktop-mode',
					);
				} else if ( vips > 0 || lapsed > 0 ) {
					bands = sprintf(
						/* translators: 1: VIP customer count, 2: lapsed customer count. */
						__( '%1$d · %2$d', 'desktop-mode' ),
						vips,
						lapsed,
					);
				}

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
						row(
							__( 'Customers', 'desktop-mode' ),
							customers > 0
								? sprintf(
									/* translators: %d: number of customers. */
									_n( '%d person', '%d people', customers ),
									customers,
								)
								: null,
						),
						row( __( 'VIP · lapsed', 'desktop-mode' ), bands ),
						// Guests can't appear in the Customers list —
						// there is no account to render — so their
						// money is reported here or nowhere.
						row(
							__( 'Guest checkout', 'desktop-mode' ),
							data.guestSpend
								? sprintf(
									/* translators: 1: formatted revenue, 2: number of orders. */
									__( '%1$s over %2$d orders', 'desktop-mode' ),
									data.guestSpend,
									guestOrders,
								)
								: null,
						),
					],
				};
			},
		);
	},
);

/* -------------------------------------------------------------------
 * The Customer window
 *
 * A native window on one person: who they are, what they are worth,
 * what they bought, where it ships. Double-clicking a customer tile
 * lands here.
 *
 * It exists because the two screens WordPress offers instead are both
 * the wrong one. The activity footprint answers "what has this person
 * published", which for someone who came to buy a hat is an empty
 * page. `user-edit.php` is a settings form — where you go to change
 * someone's role, not to understand them.
 *
 * Singleton and retargeting: the window id is "the customer window",
 * and WHICH customer is an open-time param. Params ride the session,
 * so a reload brings it back on the same person.
 * ---------------------------------------------------------------- */

const CUSTOMER_WINDOW_ID = 'desktop-mode-woo-customer';

/**
 * Announce what the Customer window is showing, so the relations
 * layer can tie it to everything else about that person.
 *
 * An iframe window gets this for free: the chromeless bridge builds
 * an identity from the real admin screen and posts it up. A NATIVE
 * window has no such screen — nothing announces on its behalf, and
 * without this call it is invisible to the engine. That is why the
 * window opened beside the order it came from and drew no line while
 * every iframe window in the same desktop did.
 *
 * The type is `user`, matching what `user-edit.php` announces, so the
 * Customer window and a profile window on the same person join one
 * group — and an order, whose identity links `user:<id>`, ties to
 * either.
 *
 * @param body       The window body, for resolving the window id.
 * @param customerId The person.
 * @param name       Their name, for tooltips.
 */
function announceCustomerIdentity(
	body: HTMLElement,
	customerId: number,
	name: string,
): void {
	// `wp-window-<id>` is the id-of-record for anything holding a DOM
	// node but not a `Window` reference — the same walk the file-drop
	// manager and the drag targets use.
	const root = body.closest< HTMLElement >( '[id^="wp-window-"]' );
	const windowId = root?.id.slice( 'wp-window-'.length );
	if ( ! windowId ) {
		return;
	}

	const set = (
		window.wp as
			| {
					os?: {
						relations?: {
							set?: (
								id: string,
								ref: {
									type: string;
									id: number | string;
									label?: string;
								} | null,
							) => void;
						};
					};
			}
			| undefined
	)?.os?.relations?.set;
	if ( typeof set !== 'function' ) {
		return;
	}

	set(
		windowId,
		customerId > 0
			? { type: 'user', id: customerId, label: name || undefined }
			: null,
	);
}

/**
 * Open (or retarget) the Customer window.
 *
 * @param customerId The person.
 * @param name       Their name, for the window title.
 * @return true when the shell took it.
 */
function openCustomerWindow( customerId: number, name: string ): boolean {
	if ( ! Number.isFinite( customerId ) || customerId <= 0 ) {
		return false;
	}
	const open = (
		window.wp as
			| {
					os?: {
						openWindow?: (
							id: string,
							opts?: {
								source?: string;
								params?: Record<
									string,
									string | number | boolean
								>;
							},
						) => boolean;
					};
			}
			| undefined
	)?.os?.openWindow;
	if ( typeof open !== 'function' ) {
		return false;
	}
	return (
		open( CUSTOMER_WINDOW_ID, {
			source: 'woocommerce/customer-tile',
			// `name` travels too so a restored window can title itself
			// before its first request comes back — otherwise every
			// reload flashes a generic "Customer" title bar.
			params: { customerId, customerName: name },
		} ) === true
	);
}

/**
 * Claim the "Customer" entry in an order's Related menu.
 *
 * The menu can only express a destination as a URL, and the only URL
 * WordPress has for a person is their profile editor — so following
 * the customer from an order landed on a settings form. Which is the
 * wrong answer to the question being asked: from an order, "customer"
 * means *this is who bought it*, not *change their role*.
 *
 * The server marks that item's URL with `os_person_view=wc-customer`;
 * the built-in profile remap stands down on any URL carrying the
 * marker, so this claim doesn't depend on winning a registration-
 * order race with it. The profile editor is still one item away in
 * the same menu, unmarked.
 */
registerNativeUrlRemap( {
	id: 'desktop-mode/woo-customer',
	nativeWindowId: CUSTOMER_WINDOW_ID,
	matches: ( _url, parsed ) =>
		parsed.searchParams.get( OS_PERSON_VIEW_PARAM ) === 'wc-customer' &&
		Number( parsed.searchParams.get( 'user_id' ) ) > 0,
	// Params rather than a shared store: they ride the session, so
	// the window reopens on the same person after a reload.
	params: ( _url, parsed ) => ( {
		customerId: Number( parsed.searchParams.get( 'user_id' ) ) || 0,
	} ),
} );

/**
 * Claim the double-click on a customer tile.
 *
 * Only in the Customers section. In the Users folder a person is
 * someone who writes, and the activity footprint is the right answer
 * there — the point of the seam is that each section gets to say what
 * "open this person" means.
 */
addFilter(
	'os.my-wordpress.user-activate',
	'desktop-mode/woocommerce',
	(
		handled: boolean,
		ctx: { entityId: string; item: Record< string, unknown > },
	): boolean => {
		if ( handled || ctx.entityId !== SECTION_CUSTOMERS ) {
			return handled;
		}
		const id = Number( ctx.item?.id );
		const name = String( ctx.item?.name ?? '' );
		return openCustomerWindow( id, name );
	},
);

/**
 * Fix up the customer tile's context menu.
 *
 * "View activity footprint" is the publishing-history screen and
 * "View author archive" is a front-end blog page for someone who has
 * never written a post — both are dead ends for a customer. They are
 * replaced by the two things a merchant actually wants from a
 * right-click: the customer window and their orders.
 */
addFilter(
	'os.my-wordpress.tile-context-menu',
	'desktop-mode/woocommerce',
	(
		options: Array< {
			id: string;
			label: string;
			icon: string;
			onSelect?: ( () => void ) | null;
		} >,
		ctx: { entityId: string; kind: string; item: Record< string, unknown > },
	) => {
		if (
			ctx.kind !== 'user' ||
			ctx.entityId !== SECTION_CUSTOMERS ||
			! Array.isArray( options )
		) {
			return options;
		}

		const id = Number( ctx.item?.id );
		const name = String( ctx.item?.name ?? '' );
		const facts = customerFacts( ctx.item );

		const kept = options.filter(
			( o ) => o?.id !== 'footprint' && o?.id !== 'author-archive',
		);

		const added: typeof options = [
			{
				id: 'wc-customer-window',
				label: __( 'Open customer', 'desktop-mode' ),
				icon: 'dashicons-businessperson',
				onSelect: () => {
					openCustomerWindow( id, name );
				},
			},
		];
		if ( facts?.ordersUrl ) {
			added.push( {
				id: 'wc-customer-orders',
				label: __( 'View their orders', 'desktop-mode' ),
				icon: 'dashicons-cart',
				onSelect: () => {
					openAdminWindow(
						facts.ordersUrl,
						__( 'Orders', 'desktop-mode' ),
					);
				},
			} );
		}

		return [ ...added, ...kept ];
	},
);

/* ----- Window rendering primitives ----- */

const CW = 'os-woo-customer-window';

/** A big number with a caption under it. */
function statCard( value: string, label: string, hint = '' ): HTMLElement {
	const card = document.createElement( 'div' );
	card.className = `${ CW }__stat`;

	const v = document.createElement( 'div' );
	v.className = `${ CW }__stat-value`;
	v.textContent = value;
	card.appendChild( v );

	const l = document.createElement( 'div' );
	l.className = `${ CW }__stat-label`;
	l.textContent = label;
	card.appendChild( l );

	if ( hint ) {
		const h = document.createElement( 'div' );
		h.className = `${ CW }__stat-hint`;
		h.textContent = hint;
		card.appendChild( h );
	}

	return card;
}

/** A titled block. Returns null when it would be empty. */
function section( title: string, body: Node | null ): HTMLElement | null {
	if ( ! body ) {
		return null;
	}
	const host = document.createElement( 'section' );
	host.className = `${ CW }__section`;

	const h = document.createElement( 'h3' );
	h.className = `${ CW }__section-title`;
	h.textContent = title;
	host.append( h, body );

	return host;
}

/** The identity strip: avatar, name, contact, band. */
function customerHeader( data: CustomerSummary ): HTMLElement {
	const header = document.createElement( 'header' );
	header.className = `${ CW }__header`;

	if ( data.avatar ) {
		const img = document.createElement( 'img' );
		img.className = `${ CW }__avatar`;
		img.src = data.avatar;
		img.alt = '';
		img.width = 64;
		img.height = 64;
		header.appendChild( img );
	}

	const meta = document.createElement( 'div' );
	meta.className = `${ CW }__identity`;

	const name = document.createElement( 'h2' );
	name.className = `${ CW }__name`;
	name.textContent = data.name || data.username || `#${ data.id }`;
	meta.appendChild( name );

	const contact = [ data.email, data.phone ].filter( Boolean ).join( ' · ' );
	if ( contact ) {
		const line = document.createElement( 'p' );
		line.className = `${ CW }__contact`;
		line.textContent = contact;
		meta.appendChild( line );
	}

	if ( data.bandLabel ) {
		const badge = document.createElement( 'os-badge' );
		badge.setAttribute( 'tone', customerToneFor( data.band ) );
		badge.className = `${ CW }__band`;
		badge.textContent = data.bandLabel;
		meta.appendChild( badge );
	}

	header.appendChild( meta );
	return header;
}

/** The four numbers a merchant reads first. */
function customerStats( data: CustomerSummary ): HTMLElement {
	const grid = document.createElement( 'div' );
	grid.className = `${ CW }__stats`;

	const orders = Number( data.orders ) || 0;
	grid.append(
		statCard(
			data.spend || '—',
			__( 'Lifetime spend', 'desktop-mode' ),
			data.aov
				? sprintf(
					/* translators: %s: formatted average order value. */
					__( '%s average', 'desktop-mode' ),
					data.aov,
				)
				: '',
		),
		statCard(
			String( orders ),
			_n( 'Order', 'Orders', orders ),
			data.firstOrder
				? sprintf(
					/* translators: %s: date of the first order. */
					__( 'since %s', 'desktop-mode' ),
					shortDate( data.firstOrder ),
				)
				: '',
		),
		statCard(
			sinceLabel( data.daysSince ?? null ) || '—',
			__( 'Last order', 'desktop-mode' ),
			data.lastOrderTotal,
		),
		statCard(
			data.location || '—',
			__( 'Location', 'desktop-mode' ),
			data.registered
				? sprintf(
					/* translators: %s: registration date. */
					__( 'joined %s', 'desktop-mode' ),
					shortDate( data.registered ),
				)
				: '',
		),
	);

	return grid;
}

/** The order history, as rows that open the order in a window. */
function customerOrders( data: CustomerSummary ): Node | null {
	const rows = Array.isArray( data.recentOrders ) ? data.recentOrders : [];
	if ( rows.length === 0 ) {
		return null;
	}

	const list = document.createElement( 'ul' );
	list.className = `${ CW }__orders`;

	for ( const order of rows ) {
		const li = document.createElement( 'li' );
		li.className = `${ CW }__order`;

		const head = document.createElement( 'div' );
		head.className = `${ CW }__order-head`;
		head.appendChild(
			link(
				sprintf(
					/* translators: %s: order number. */
					__( '#%s', 'desktop-mode' ),
					order.number,
				),
				order.editUrl,
			),
		);
		const badge = document.createElement( 'os-badge' );
		badge.setAttribute( 'tone', orderToneFor( order.status ) );
		badge.textContent = order.statusLabel;
		head.appendChild( badge );
		li.appendChild( head );

		const meta = document.createElement( 'div' );
		meta.className = `${ CW }__order-meta`;
		meta.textContent = [
			shortDate( order.date ),
			sprintf(
				/* translators: %d: number of line items. */
				_n( '%d item', '%d items', order.items ),
				order.items,
			),
		]
			.filter( Boolean )
			.join( ' · ' );
		li.appendChild( meta );

		const total = document.createElement( 'div' );
		total.className = `${ CW }__order-total`;
		total.textContent = order.total;
		li.appendChild( total );

		list.appendChild( li );
	}

	return list;
}

/** Billing / shipping, side by side when they differ. */
function customerAddresses( data: CustomerSummary ): Node | null {
	const entries: Array< [ string, string ] > = [];
	if ( data.billing ) {
		entries.push( [ __( 'Billing', 'desktop-mode' ), data.billing ] );
	}
	// Only when it says something the billing address doesn't — two
	// identical blocks are a waste of the reader's attention.
	if ( data.shipping && data.shipping !== data.billing ) {
		entries.push( [ __( 'Shipping', 'desktop-mode' ), data.shipping ] );
	}
	if ( entries.length === 0 ) {
		return null;
	}

	const grid = document.createElement( 'div' );
	grid.className = `${ CW }__addresses`;
	for ( const [ label, value ] of entries ) {
		const block = document.createElement( 'div' );
		block.className = `${ CW }__address`;

		const l = document.createElement( 'div' );
		l.className = `${ CW }__address-label`;
		l.textContent = label;

		const v = document.createElement( 'div' );
		v.className = `${ CW }__address-value`;
		v.textContent = value;

		block.append( l, v );
		grid.appendChild( block );
	}

	return grid;
}

/** The action row — every one of these opens its own window. */
function customerActions( data: CustomerSummary ): HTMLElement {
	const footer = document.createElement( 'footer' );
	footer.className = `${ CW }__actions`;

	const button = (
		label: string,
		variant: 'primary' | 'secondary',
		onClick: () => void,
	): void => {
		const btn = document.createElement( 'os-button' );
		btn.setAttribute( 'variant', variant );
		btn.textContent = label;
		btn.addEventListener( 'click', onClick );
		footer.appendChild( btn );
	};

	if ( data.ordersUrl && Number( data.orders ) > 0 ) {
		button( __( 'All orders', 'desktop-mode' ), 'primary', () =>
			openAdminWindow( data.ordersUrl, __( 'Orders', 'desktop-mode' ) ),
		);
	}
	if ( data.profileUrl ) {
		button( __( 'Edit profile', 'desktop-mode' ), 'secondary', () =>
			openAdminWindow( data.profileUrl, data.name ),
		);
	}
	if ( data.email ) {
		button( __( 'Send email', 'desktop-mode' ), 'secondary', () => {
			// `location.href` rather than `window.open`: a `mailto:`
			// is handed to the OS handler, and opening it in a new
			// browsing context leaves a blank tab behind — or, in the
			// installed PWA, relaunches the app.
			window.location.href = `mailto:${ encodeURIComponent(
				data.email,
			) }`;
		} );
	}

	return footer;
}

/**
 * Monotonic ticket for Customer-window paints.
 *
 * The window is a retargetable singleton: clicking a second customer
 * repaints the same root while the first customer's summary may still
 * be in flight. `root.isConnected` can't see that — the node is the
 * same one and stays connected — so each paint claims a ticket and
 * drops its response if a later paint has since claimed one.
 */
let customerPaintTicket = 0;

/**
 * Paint the whole window for one customer.
 *
 * @param root       The window's mount point.
 * @param customerId Who to show.
 * @param fallback   Name to title the window with before data lands.
 */
async function renderCustomerWindow(
	root: HTMLElement,
	customerId: number,
	fallback: string,
): Promise< void > {
	const ticket = ++customerPaintTicket;
	const stale = (): boolean =>
		! root.isConnected || ticket !== customerPaintTicket;

	const loading = document.createElement( 'div' );
	loading.className = `${ CW }__loading`;
	loading.appendChild( document.createElement( 'os-spinner' ) );
	root.replaceChildren( loading );

	if ( ! Number.isFinite( customerId ) || customerId <= 0 ) {
		const empty = document.createElement( 'p' );
		empty.className = `${ CW }__empty`;
		empty.textContent = __(
			'No customer selected. Open one from the Customers folder.',
			'desktop-mode',
		);
		root.replaceChildren( empty );
		return;
	}

	const result = await fetchJson< CustomerSummary >(
		`summary/customer/${ customerId }`,
	);

	// The window may have been retargeted (or closed) while the
	// request was in flight. Landing here late would overwrite the
	// customer the user is now looking at with the one they left.
	if ( stale() ) {
		return;
	}
	if ( 'error' in result ) {
		const err = document.createElement( 'p' );
		err.className = `${ CW }__empty`;
		err.textContent = result.error;
		root.replaceChildren( err );
		return;
	}

	const data = result.data;
	const frag = document.createDocumentFragment();
	frag.append( customerHeader( data ), customerStats( data ) );

	const favourite = data.favourite
		? ( () => {
			const wrap = document.createElement( 'p' );
			wrap.className = `${ CW }__favourite`;
			wrap.appendChild(
				link( data.favourite.label, data.favourite.editUrl ),
			);
			if ( data.favourite.quantity > 1 ) {
				wrap.appendChild(
					document.createTextNode(
						` · ${ sprintf(
							/* translators: %d: units bought. */
							__( '×%d bought', 'desktop-mode' ),
							data.favourite.quantity,
						) }`,
					),
				);
			}
			return wrap;
		} )()
		: null;

	for ( const block of [
		section( __( 'Buys most', 'desktop-mode' ), favourite ),
		section( __( 'Recent orders', 'desktop-mode' ), customerOrders( data ) ),
		section( __( 'Addresses', 'desktop-mode' ), customerAddresses( data ) ),
	] ) {
		if ( block ) {
			frag.appendChild( block );
		}
	}

	frag.appendChild( customerActions( data ) );

	root.replaceChildren( frag );
	// Not used for display — the fallback title is only the pre-paint
	// placeholder — but a stable marker makes "which customer is this
	// window on" answerable from the DOM.
	root.dataset.customerId = String( customerId );
	root.dataset.customerName = data.name || fallback;
}

/**
 * The native-window render callback. Registered on the global the
 * shell reads rather than through an import, because the shell owns
 * the window lifecycle and calls in.
 */
type NativeWindowRenderer = (
	body: HTMLElement,
	ctx?: { params?: Record< string, string | number | boolean > },
) => unknown;

const nativeWindowRegistry = window as unknown as {
	openStationNativeWindows?: Record< string, NativeWindowRenderer >;
};
nativeWindowRegistry.openStationNativeWindows =
	nativeWindowRegistry.openStationNativeWindows ?? {};

nativeWindowRegistry.openStationNativeWindows[ CUSTOMER_WINDOW_ID ] = (
	body,
	ctx,
) => {
	const root =
		body.querySelector< HTMLElement >( '[data-os-woo-customer-root]' ) ??
		body;

	const paint = ( params: Record< string, string | number | boolean > ) => {
		const customerId = Number( params.customerId ?? 0 );
		const name = String( params.customerName ?? '' );
		// Announced before the fetch, not after: the identity is
		// already known from the params, and waiting for the summary
		// would leave the window unconnected for a round trip —
		// exactly when the user is looking at it next to the order
		// they came from.
		announceCustomerIdentity( body, customerId, name );
		void renderCustomerWindow( root, customerId, name );
	};

	paint( ctx?.params ?? {} );

	// Retarget while open: reopening the window with a different
	// customer fires `os-window-reopened` carrying the live params,
	// which the manager has already updated. Without this the window
	// would focus and keep showing the previous person — the failure
	// mode that reads as "clicking a second customer does nothing".
	const onReopen = ( event: Event ): void => {
		const detail = ( event as CustomEvent ).detail as {
			windowId?: string;
			params?: Record< string, string | number | boolean >;
		};
		if ( detail?.windowId !== CUSTOMER_WINDOW_ID || ! root.isConnected ) {
			return;
		}
		paint( detail.params ?? {} );
	};
	document.addEventListener( 'os-window-reopened', onReopen );

	return () => {
		document.removeEventListener( 'os-window-reopened', onReopen );
	};
};

registerWooProductStudio();
