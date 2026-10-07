import { addAction, addFilter } from '../../hooks';
import {
	OS_PERSON_VIEW_PARAM,
	registerNativeUrlRemap,
} from '../../native-url-remap';
import { __, _n, sprintf } from '../../i18n';
import { trackedFetch } from '../../tracked-fetch';
import { restErrorFromResponse } from '../../core/api-client';
import { describeRestFailure } from '../../core/rest-failure';

import '../../ui/components/os-ribbon/os-ribbon';
import '../../ui/components/os-badge/os-badge';
import type { OsBadgeTone } from '../../ui/components/os-badge/os-badge';

type BadgeTone = OsBadgeTone;

interface OrderBand {
	id: string;
	label: string;
	order: number;

	statuses?: string[];
}

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

	canCustomers?: boolean;
	orderBands?: OrderBand[];

	orderStatuses?: Record< string, string >;
	productBands?: WooBand[];
	couponBands?: WooBand[];
	customerBands?: WooBand[];
}

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

interface ListColumn {
	id: string;
	label: string;
	render: ( item: Record< string, unknown > ) => unknown;
}

interface UserPreviewAction {
	id: string;
	label: string;
	title?: string;
	variant?: 'primary' | 'secondary';
	onSelect: () => void;
}

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

const LOW_STOCK_THRESHOLD = 5;

const SECTION_ORDERS = 'wc-orders';
const SECTION_PRODUCTS = 'cpt-product';
const SECTION_COUPONS = 'cpt-shop_coupon';
const SECTION_CUSTOMERS = 'wc-customers';

function getConfig(): WooConfig | null {
	const cfg = ( window as unknown as { openStationWooConfig?: WooConfig } )
		.openStationWooConfig;
	return cfg && typeof cfg.restRoot === 'string' ? cfg : null;
}

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
			console.warn(
				`[openstation] WooCommerce request failed: ${ response.status } ${ url }`,
			);
			return {
				error: describeRestFailure( await restErrorFromResponse( response ), {
					fallback: __( 'Could not load WooCommerce details.', 'desktop-mode' ),
				} ).message,
			};
		}
		return { data: ( await response.json() ) as T };
	} catch ( err ) {
		console.warn(
			`[openstation] WooCommerce request errored: ${ url }`,
			err,
		);
		return {
			error: describeRestFailure( err, {
				fallback: __( 'Could not load WooCommerce details.', 'desktop-mode' ),
			} ).message,
		};
	}
}

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

function link( label: string, href: string ): Node {
	if ( ! href ) {
		return document.createTextNode( label );
	}
	const a = document.createElement( 'a' );
	a.className = `${ PANEL_CLASS }__link`;
	a.href = href;
	a.textContent = label;
	a.rel = 'noopener noreferrer';

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

function pill( text: string, tone: BadgeTone ): HTMLElement {
	const badge = document.createElement( 'os-badge' );
	badge.setAttribute( 'tone', tone );
	badge.className = `${ PANEL_CLASS }__pill`;
	badge.textContent = text;
	return badge;
}

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

function flagList( flags: Array< [ boolean, string ] > ): string {
	const on = flags.filter( ( [ enabled ] ) => enabled ).map( ( [ , l ] ) => l );
	return on.join( ' · ' );
}

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

		el.append(
			document.createElement( 'span' ),
			document.createElement( 'span' ),
		);
		return el;
	} );

	const shell = panel( title, placeholders, modifier );
	shell.setAttribute( 'aria-busy', 'true' );
	host.appendChild( shell );

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
			if ( ! shell.isConnected ) {
				return;
			}
			shell.removeAttribute( 'aria-busy' );

			console.warn( '[openstation] WooCommerce panel failed to render', err );
			fail( __( 'Could not show WooCommerce details.', 'desktop-mode' ) );
		} );
}

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

function customerToneFor( band: string ): BadgeTone {
	if ( band === 'vip' ) {
		return 'success';
	}
	if ( band === 'lapsed' ) {
		return 'warning';
	}
	return 'neutral';
}

function renderProduct( data: ProductSummary ): Array< HTMLElement | null > {
	const stock =
		data.stockLevel === null
			? data.stockLabel
			: sprintf(

				__( '%1$s (%2$d)', 'desktop-mode' ),
				data.stockLabel,
				data.stockLevel,
			);

	const reviews = Number( data.reviews ) || 0;
	const rating =
		reviews > 0
			? sprintf(

				__( '%1$s ★ (%2$d)', 'desktop-mode' ),
				( Number( data.rating ) || 0 ).toFixed( 1 ),
				reviews,
			)
			: '';

	const type =
		data.variations > 0
			? sprintf(

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

				__( '%1$d of %2$d', 'desktop-mode' ),
				data.used,
				data.usageLimit,
			)
			: sprintf(

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

					__( '%d uses', 'desktop-mode' ),
					data.perUserLimit,
				)
				: '',
		),
		row(
			__( 'Limit to items', 'desktop-mode' ),
			data.limitToItems > 0 ? String( data.limitToItems ) : '',
		),

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

function sinceLabel( days: number | null ): string {
	if ( days === null || ! Number.isFinite( days ) ) {
		return '';
	}
	if ( days <= 0 ) {
		return __( 'Today', 'desktop-mode' );
	}
	if ( days < 60 ) {
		return sprintf(

			_n( '%d day ago', '%d days ago', days ),
			days,
		);
	}
	const months = Math.round( days / 30 );
	if ( months < 24 ) {
		return sprintf(

			_n( '%d month ago', '%d months ago', months ),
			months,
		);
	}
	const years = Math.round( days / 365 );
	return sprintf(

		_n( '%d year ago', '%d years ago', years ),
		years,
	);
}

function renderCustomer( data: CustomerSummary ): Array< HTMLElement | null > {
	const orders = Number( data.orders ) || 0;
	const since = sinceLabel( data.daysSince ?? null );

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

const PANEL_TITLES: Record< Summary[ 'type' ], string > = {
	product: __( 'Product', 'desktop-mode' ),
	order: __( 'Order', 'desktop-mode' ),
	coupon: __( 'Coupon', 'desktop-mode' ),
	customer: __( 'Customer', 'desktop-mode' ),
};

const PANEL_ROW_COUNTS: Record< Summary[ 'type' ], number > = {
	product: 8,
	order: 10,
	coupon: 12,
	customer: 9,
};

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

function previewSummaryTypeFor(
	payload: PreviewExtrasPayload,
): Summary[ 'type' ] | null {
	if ( payload.entityId === SECTION_CUSTOMERS ) {
		return getConfig()?.canCustomers ? 'customer' : null;
	}
	if ( payload.kind === 'user' ) {
		if ( ! getConfig()?.canCustomers ) {
			return null;
		}
		return customerFacts( payload.item ) ? 'customer' : null;
	}
	return summaryTypeFor( payload.entityId );
}

function productFacts( item: Record< string, unknown > ): ProductRowFacts | null {
	const facts = item.openstation_woo as ProductRowFacts | null | undefined;
	return facts && typeof facts.stockStatus === 'string' ? facts : null;
}

function wooBand( item: Record< string, unknown > ): string | null {
	const facts = item.openstation_woo as { band?: string } | null | undefined;
	return facts && typeof facts.band === 'string' ? facts.band : null;
}

function customerFacts(
	item: Record< string, unknown >,
): CustomerFacts | null {
	const facts = item.openstation_woo_customer as
		| CustomerFacts
		| null
		| undefined;
	return facts && typeof facts.band === 'string' ? facts : null;
}

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

const NOT_ORDER_COLUMNS = new Set( [ 'slug', 'comments', 'words' ] );

addFilter(
	'os.my-wordpress.list-columns',
	'desktop-mode/woocommerce',
	( columns: ListColumn[], entity: { id: string } ): ListColumn[] => {
		if ( entity.id !== SECTION_ORDERS || ! Array.isArray( columns ) ) {
			return columns;
		}
		const labels = getConfig()?.orderStatuses ?? {};
		return columns
			.filter( ( column ) => ! NOT_ORDER_COLUMNS.has( column.id ) )
			.map( ( column ) => {
				if ( column.id === 'author' ) {
					return {
						id: 'customer',
						label: __( 'Customer', 'desktop-mode' ),
						render: ( item ) => String( item.customer ?? '' ),
					};
				}
				if ( column.id === 'status' ) {
					return {
						...column,
						render: ( item ) => {
							const status = String( item.wcStatus ?? '' );
							return labels[ `wc-${ status }` ] ?? status;
						},
					};
				}
				return column;
			} );
	},
);

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

	if ( facts.band === 'vip' || facts.band === 'lapsed' ) {
		payload.tile.dataset.wooCustomerBand = facts.band;
		stampCustomerBand( payload.tile );
	}

	return true;
}

function stampCustomerBand( tile: HTMLElement ): void {
	const band = tile.dataset.wooCustomerBand;
	if ( ! band ) {
		return;
	}

	if ( tile.querySelector( '.os-woo-customer-band' ) ) {
		return;
	}

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

		payload.tile.dataset.wooRibbon = `${ tone }|${ label }`;
		stampRibbon( payload.tile );
	},
);

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

				let bands: string | null = null;
				if ( data.bandsCapped ) {
					bands = __(
						'Not counted on a store this large',
						'desktop-mode',
					);
				} else if ( vips > 0 || lapsed > 0 ) {
					bands = sprintf(

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

								__( '%d orders', 'desktop-mode' ),
								data.processing,
							),
						),
						row(
							__( 'Out of stock', 'desktop-mode' ),
							data.outOfStock > 0
								? sprintf(

									__( '%d products', 'desktop-mode' ),
									data.outOfStock,
								)
								: __( 'None', 'desktop-mode' ),
						),
						row(
							__( 'Customers', 'desktop-mode' ),
							customers > 0
								? sprintf(

									_n( '%d person', '%d people', customers ),
									customers,
								)
								: null,
						),
						row( __( 'VIP · lapsed', 'desktop-mode' ), bands ),

						row(
							__( 'Guest checkout', 'desktop-mode' ),
							data.guestSpend
								? sprintf(

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

const CUSTOMER_WINDOW_ID = 'desktop-mode-woo-customer';

function announceCustomerIdentity(
	body: HTMLElement,
	customerId: number,
	name: string,
): void {
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

			params: { customerId, customerName: name },
		} ) === true
	);
}

registerNativeUrlRemap( {
	id: 'desktop-mode/woo-customer',
	nativeWindowId: CUSTOMER_WINDOW_ID,
	matches: ( _url, parsed ) =>
		parsed.searchParams.get( OS_PERSON_VIEW_PARAM ) === 'wc-customer' &&
		Number( parsed.searchParams.get( 'user_id' ) ) > 0,

	params: ( _url, parsed ) => ( {
		customerId: Number( parsed.searchParams.get( 'user_id' ) ) || 0,
	} ),
} );

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

const CW = 'os-woo-customer-window';

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

					__( 'joined %s', 'desktop-mode' ),
					shortDate( data.registered ),
				)
				: '',
		),
	);

	return grid;
}

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

function customerAddresses( data: CustomerSummary ): Node | null {
	const entries: Array< [ string, string ] > = [];
	if ( data.billing ) {
		entries.push( [ __( 'Billing', 'desktop-mode' ), data.billing ] );
	}

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
			window.location.href = `mailto:${ encodeURIComponent(
				data.email,
			) }`;
		} );
	}

	return footer;
}

let customerPaintTicket = 0;

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

	root.dataset.customerId = String( customerId );
	root.dataset.customerName = data.name || fallback;
}

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

		announceCustomerIdentity( body, customerId, name );
		void renderCustomerWindow( root, customerId, name );
	};

	paint( ctx?.params ?? {} );

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
