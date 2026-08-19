/**
 * WooCommerce Product Studio.
 *
 * A four-stage product-creation flow that lives in its own native
 * OpenStation window. The browser owns the draft and live preview;
 * WooCommerce owns the saved product through the nonce-authenticated
 * server route in `woocommerce-product-studio.php`.
 */

import { addAction } from '../../hooks';
import { __, sprintf } from '../../i18n';
import { trackedFetch } from '../../tracked-fetch';
import '../../ui/components/os-badge/os-badge';
import '../../ui/components/os-button/os-button';
import '../../ui/components/os-card/os-card';
import '../../ui/components/os-checkbox-label/os-checkbox-label';
import '../../ui/components/os-notice/os-notice';
import '../../ui/components/os-progress-bar/os-progress-bar';
import '../../ui/components/os-spinner/os-spinner';
import '../../ui/components/os-text-field/os-text-field';
import '../../ui/components/os-textarea/os-textarea';

const WINDOW_ID = 'desktop-mode-woo-product-studio';
const WOO_GROUP_ID = 'plugin:woocommerce';
const DRAFT_STORAGE_KEY = 'openstation/woocommerce-product-studio-draft:v1';
const REQUEST_ID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

type ProductKind = 'physical' | 'virtual';
type ProductStatus = 'draft' | 'publish';
type StepId = 'basics' | 'commerce' | 'presentation' | 'review';

interface WooProductStudioConfig {
	restRoot: string;
	restNonce: string;
	canCreateProducts?: boolean;
}

interface ProductCategory {
	id: number;
	name: string;
	parent: number;
	count: number;
}

interface ProductStudioBootstrap {
	categories: ProductCategory[];
	currencyCode: string;
	currencySymbol: string;
	priceDecimals: number;
	canPublish: boolean;
	maxImageBytes: number;
	maxImageLabel: string;
	placeholderUrl: string;
}

export interface ProductDraft {
	name: string;
	shortDescription: string;
	description: string;
	kind: ProductKind;
	regularPrice: string;
	salePrice: string;
	sku: string;
	manageStock: boolean;
	stockQuantity: string;
	stockStatus: 'instock' | 'outofstock' | 'onbackorder';
	categoryIds: number[];
	imageFile: File | null;
	imagePreviewUrl: string;
}

interface ProductResult {
	id: number;
	name: string;
	status: ProductStatus;
	price: string;
	editUrl: string;
	viewUrl: string;
	thumbnail: string;
	replayed?: boolean;
}

interface StudioRuntime {
	root: HTMLElement;
	bootstrap: ProductStudioBootstrap;
	draft: ProductDraft;
	stepIndex: number;
	busy: boolean;
	submitMode: ProductStatus | null;
	error: string;
	objectUrl: string;
	requestSignal: AbortSignal;
	stage: HTMLElement;
	preview: HTMLElement;
	progress: HTMLElement;
	stepRail: HTMLElement;
	statusBadge: HTMLElement;
	footer: HTMLElement;
	result: ProductResult | null;
	requestId: string;
	recoveredDraft: boolean;
	recoveryNeedsImage: boolean;
}

interface StoredProductDraft {
	version: 1;
	requestId: string;
	stepIndex: number;
	hadImage: boolean;
	draft: Omit< ProductDraft, 'imageFile' | 'imagePreviewUrl' >;
}

interface GroupExtrasPayload {
	container: HTMLElement;
	groupId: string;
}

const STEPS: Array< { id: StepId; label: string; kicker: string } > = [
	{
		id: 'basics',
		label: __( 'The product', 'desktop-mode' ),
		kicker: __( 'Name and story', 'desktop-mode' ),
	},
	{
		id: 'commerce',
		label: __( 'The offer', 'desktop-mode' ),
		kicker: __( 'Price and stock', 'desktop-mode' ),
	},
	{
		id: 'presentation',
		label: __( 'The shelf', 'desktop-mode' ),
		kicker: __( 'Image and categories', 'desktop-mode' ),
	},
	{
		id: 'review',
		label: __( 'Launch', 'desktop-mode' ),
		kicker: __( 'Review and publish', 'desktop-mode' ),
	},
];

function emptyDraft(): ProductDraft {
	return {
		name: '',
		shortDescription: '',
		description: '',
		kind: 'physical',
		regularPrice: '',
		salePrice: '',
		sku: '',
		manageStock: false,
		stockQuantity: '0',
		stockStatus: 'instock',
		categoryIds: [],
		imageFile: null,
		imagePreviewUrl: '',
	};
}

function createRequestId(): string {
	if ( typeof crypto.randomUUID === 'function' ) {
		return crypto.randomUUID();
	}
	const bytes = new Uint8Array( 16 );
	crypto.getRandomValues( bytes );
	bytes[ 6 ] = 64 + ( bytes[ 6 ] % 16 );
	bytes[ 8 ] = 128 + ( bytes[ 8 ] % 64 );
	const hex = Array.from( bytes, ( byte ) => byte.toString( 16 ).padStart( 2, '0' ) );
	return `${ hex.slice( 0, 4 ).join( '' ) }-${ hex.slice( 4, 6 ).join( '' ) }-${ hex.slice( 6, 8 ).join( '' ) }-${ hex.slice( 8, 10 ).join( '' ) }-${ hex.slice( 10 ).join( '' ) }`;
}

function hasDraftContent( draft: ProductDraft ): boolean {
	return Boolean(
		draft.name.trim() ||
			draft.shortDescription.trim() ||
			draft.description.trim() ||
			draft.regularPrice.trim() ||
			draft.salePrice.trim() ||
			draft.sku.trim() ||
			draft.kind !== 'physical' ||
			draft.manageStock ||
			draft.stockQuantity !== '0' ||
			draft.stockStatus !== 'instock' ||
			draft.categoryIds.length ||
			draft.imageFile,
	);
}

function clearStoredDraft(): void {
	try {
		sessionStorage.removeItem( DRAFT_STORAGE_KEY );
	} catch {
		// Storage may be unavailable in hardened or private browser contexts.
	}
}

function persistDraft( runtime: StudioRuntime ): void {
	if ( runtime.result || ! hasDraftContent( runtime.draft ) ) {
		clearStoredDraft();
		return;
	}
	const draft: StoredProductDraft[ 'draft' ] = {
		name: runtime.draft.name,
		shortDescription: runtime.draft.shortDescription,
		description: runtime.draft.description,
		kind: runtime.draft.kind,
		regularPrice: runtime.draft.regularPrice,
		salePrice: runtime.draft.salePrice,
		sku: runtime.draft.sku,
		manageStock: runtime.draft.manageStock,
		stockQuantity: runtime.draft.stockQuantity,
		stockStatus: runtime.draft.stockStatus,
		categoryIds: [ ...runtime.draft.categoryIds ],
	};
	const stored: StoredProductDraft = {
		version: 1,
		requestId: runtime.requestId,
		stepIndex: runtime.stepIndex,
		hadImage: Boolean( runtime.draft.imageFile ),
		draft,
	};
	try {
		sessionStorage.setItem( DRAFT_STORAGE_KEY, JSON.stringify( stored ) );
	} catch {
		// The flow remains fully usable when storage is disabled or full.
	}
}

function isRecord( value: unknown ): value is Record< string, unknown > {
	return Boolean( value ) && typeof value === 'object' && ! Array.isArray( value );
}

function restoreDraft(
	bootstrap: ProductStudioBootstrap,
): { draft: ProductDraft; requestId: string; stepIndex: number; hadImage: boolean } | null {
	let parsed: unknown;
	try {
		const raw = sessionStorage.getItem( DRAFT_STORAGE_KEY );
		if ( ! raw ) {
			return null;
		}
		parsed = JSON.parse( raw );
	} catch {
		clearStoredDraft();
		return null;
	}
	if ( ! isRecord( parsed ) || parsed.version !== 1 || ! isRecord( parsed.draft ) ) {
		clearStoredDraft();
		return null;
	}

	const source = parsed.draft;
	const text = ( key: string ): string => typeof source[ key ] === 'string' ? source[ key ] : '';
	const allowedCategories = new Set( bootstrap.categories.map( ( item ) => item.id ) );
	const categoryIds = Array.isArray( source.categoryIds )
		? source.categoryIds.filter(
			( id ): id is number => Number.isInteger( id ) && allowedCategories.has( id ),
		)
		: [];
	const kind: ProductKind = source.kind === 'virtual' ? 'virtual' : 'physical';
	const stockStatus = [ 'instock', 'outofstock', 'onbackorder' ].includes(
		String( source.stockStatus ),
	)
		? source.stockStatus as ProductDraft[ 'stockStatus' ]
		: 'instock';
	const draft: ProductDraft = {
		name: text( 'name' ),
		shortDescription: text( 'shortDescription' ),
		description: text( 'description' ),
		kind,
		regularPrice: text( 'regularPrice' ),
		salePrice: text( 'salePrice' ),
		sku: text( 'sku' ),
		manageStock: kind === 'physical' && source.manageStock === true,
		stockQuantity: text( 'stockQuantity' ) || '0',
		stockStatus,
		categoryIds,
		imageFile: null,
		imagePreviewUrl: '',
	};
	if ( ! hasDraftContent( draft ) && parsed.hadImage !== true ) {
		clearStoredDraft();
		return null;
	}
	return {
		draft,
		requestId: typeof parsed.requestId === 'string' && REQUEST_ID_PATTERN.test( parsed.requestId )
			? parsed.requestId
			: createRequestId(),
		stepIndex: Number.isInteger( parsed.stepIndex )
			? Math.max( 0, Math.min( STEPS.length - 1, Number( parsed.stepIndex ) ) )
			: 0,
		hadImage: parsed.hadImage === true,
	};
}

function getConfig(): WooProductStudioConfig | null {
	const cfg = (
		window as unknown as {
			openStationWooConfig?: WooProductStudioConfig;
		}
	).openStationWooConfig;
	return cfg && typeof cfg.restRoot === 'string' ? cfg : null;
}

/**
 * Validate the draft for a single step or the final publish action.
 * Exported so the workflow contract remains unit-testable without a
 * WooCommerce runtime.
 */
export function validateProductDraft(
	draft: ProductDraft,
	step: StepId | 'draft-save' | 'publish',
): Record< string, string > {
	const errors: Record< string, string > = {};
	const checksBasics = step === 'basics' || step === 'draft-save' || step === 'publish';
	const checksCommerce = step === 'commerce' || step === 'publish';
	const decimalPattern = /^(?:\d+|\d*\.\d+)$/;

	if ( checksBasics && ! draft.name.trim() ) {
		errors.name = __( 'Give the product a name.', 'desktop-mode' );
	}

	if ( checksCommerce ) {
		const regular = Number( draft.regularPrice );
		const sale = draft.salePrice.trim() === '' ? null : Number( draft.salePrice );
		if (
			draft.regularPrice.trim() === '' ||
			! decimalPattern.test( draft.regularPrice.trim() ) ||
			! Number.isFinite( regular ) ||
			regular < 0
		) {
			errors.regularPrice = __( 'Enter a valid regular price.', 'desktop-mode' );
		}
		if (
			sale !== null &&
			(
				! decimalPattern.test( draft.salePrice.trim() ) ||
				! Number.isFinite( sale ) ||
				sale < 0 ||
				sale >= regular
			)
		) {
			errors.salePrice = __( 'Sale price must be lower than the regular price.', 'desktop-mode' );
		}
		if (
			draft.kind === 'physical' &&
			draft.manageStock &&
			(
				! /^\d+$/.test( draft.stockQuantity.trim() ) ||
				! Number.isSafeInteger( Number( draft.stockQuantity ) )
			)
		) {
			errors.stockQuantity = __( 'Enter a whole-number stock quantity of zero or more.', 'desktop-mode' );
		}
	}

	return errors;
}

function firstErrorMessage( errors: Record< string, string > ): string {
	return Object.values( errors )[ 0 ] ?? '';
}

async function fetchBootstrap( signal: AbortSignal ): Promise< ProductStudioBootstrap > {
	const cfg = getConfig();
	if ( ! cfg ) {
		throw new Error( __( 'WooCommerce Product Studio is unavailable.', 'desktop-mode' ) );
	}
	const response = await trackedFetch(
		`${ cfg.restRoot }product-studio`,
		{
			method: 'GET',
			credentials: 'same-origin',
			signal,
			headers: {
				'X-WP-Nonce': cfg.restNonce,
				Accept: 'application/json',
			},
		},
		{
			windowId: WINDOW_ID,
			source: 'desktop-mode/woocommerce-product-studio',
		},
	);
	if ( ! response.ok ) {
		const body = ( await response.json().catch( () => null ) ) as
			| { message?: string }
			| null;
		throw new Error(
			body?.message || __( 'Could not prepare Product Studio.', 'desktop-mode' ),
		);
	}
	return ( await response.json() ) as ProductStudioBootstrap;
}

function field(
	tag: 'os-text-field' | 'os-textarea',
	label: string,
	value: string,
	onChange: ( nextValue: string ) => void,
	opts: {
		placeholder?: string;
		required?: boolean;
		invalid?: boolean;
		fullWidth?: boolean;
		type?: string;
		rows?: number;
		hint?: string;
	} = {},
): HTMLElement {
	const el = document.createElement( tag ) as HTMLElement & { value?: string };
	el.setAttribute( 'label', label );
	el.setAttribute( 'value', value );
	if ( opts.placeholder ) {
		el.setAttribute( 'placeholder', opts.placeholder );
	}
	if ( opts.required ) {
		el.setAttribute( 'required', '' );
	}
	if ( opts.invalid ) {
		el.setAttribute( 'invalid', '' );
	}
	if ( opts.fullWidth !== false ) {
		el.setAttribute( 'full-width', '' );
	}
	if ( opts.type && tag === 'os-text-field' ) {
		el.setAttribute( 'type', opts.type );
	}
	if ( opts.rows && tag === 'os-textarea' ) {
		el.setAttribute( 'rows', String( opts.rows ) );
	}
	el.addEventListener( 'os-input-change', ( event: Event ) => {
		const detail = ( event as CustomEvent< { value?: string } > ).detail;
		onChange( String( detail?.value ?? '' ) );
	} );
	if ( opts.hint ) {
		const wrap = document.createElement( 'div' );
		wrap.className = 'os-woo-product-studio__field-wrap';
		wrap.appendChild( el );
		const hint = document.createElement( 'p' );
		hint.className = 'os-woo-product-studio__field-hint';
		hint.textContent = opts.hint;
		wrap.appendChild( hint );
		return wrap;
	}
	return el;
}

function button(
	label: string,
	variant: 'holo' | 'primary' | 'secondary' | 'ghost' | 'link',
	onClick: () => void,
): HTMLElement {
	const el = document.createElement( 'os-button' );
	el.setAttribute( 'variant', variant );
	el.textContent = label;
	el.addEventListener( 'click', onClick );
	return el;
}

function heading( eyebrow: string, title: string, body: string ): HTMLElement {
	const host = document.createElement( 'header' );
	host.className = 'os-woo-product-studio__stage-heading';
	const overline = document.createElement( 'div' );
	overline.className = 'os-woo-product-studio__eyebrow';
	overline.textContent = eyebrow;
	const h = document.createElement( 'h2' );
	h.textContent = title;
	const p = document.createElement( 'p' );
	p.textContent = body;
	host.append( overline, h, p );
	return host;
}

function editorPanel(
	title: string,
	body: string,
	...children: HTMLElement[]
): HTMLElement {
	const panel = document.createElement( 'section' );
	panel.className = 'os-woo-product-studio__editor-panel';
	const header = document.createElement( 'header' );
	header.className = 'os-woo-product-studio__editor-panel-heading';
	const h = document.createElement( 'h3' );
	h.textContent = title;
	const p = document.createElement( 'p' );
	p.textContent = body;
	header.append( h, p );
	panel.append( header, ...children );
	return panel;
}

function readinessCue( runtime: StudioRuntime ): HTMLElement {
	const cue = document.createElement( 'div' );
	cue.className = 'os-woo-product-studio__readiness';
	cue.setAttribute( 'role', 'status' );
	cue.setAttribute( 'aria-live', 'polite' );

	const icon = document.createElement( 'span' );
	icon.setAttribute( 'aria-hidden', 'true' );
	const copy = document.createElement( 'span' );
	const title = document.createElement( 'strong' );
	const body = document.createElement( 'small' );
	const step = STEPS[ runtime.stepIndex ].id;

	if ( step === 'basics' ) {
		if ( runtime.draft.name.trim() && runtime.draft.shortDescription.trim() ) {
			cue.classList.add( 'is-ready' );
			icon.className = 'dashicons dashicons-saved';
			title.textContent = __( 'The story is taking shape', 'desktop-mode' );
			body.textContent = __( 'Shoppers will see a clear name and promise in the preview.', 'desktop-mode' );
		} else if ( runtime.draft.name.trim() ) {
			cue.classList.add( 'is-progress' );
			icon.className = 'dashicons dashicons-lightbulb';
			title.textContent = __( 'The name is in place', 'desktop-mode' );
			body.textContent = __( 'Add a one-line promise to make the preview more persuasive.', 'desktop-mode' );
		} else {
			cue.classList.add( 'is-guidance' );
			icon.className = 'dashicons dashicons-edit-page';
			title.textContent = __( 'Start with a clear product name', 'desktop-mode' );
			body.textContent = __( 'Use the name a shopper would expect to find in your catalog.', 'desktop-mode' );
		}
	} else if ( step === 'commerce' ) {
		const errors = validateProductDraft( runtime.draft, 'commerce' );
		if ( Object.keys( errors ).length === 0 ) {
			cue.classList.add( 'is-ready' );
			icon.className = 'dashicons dashicons-money-alt';
			title.textContent = __( 'The offer is ready', 'desktop-mode' );
			body.textContent = __( 'Pricing and inventory are internally consistent.', 'desktop-mode' );
		} else {
			cue.classList.add( 'is-guidance' );
			icon.className = 'dashicons dashicons-tag';
			title.textContent = __( 'A valid price unlocks publishing', 'desktop-mode' );
			body.textContent = firstErrorMessage( errors );
		}
	} else if ( runtime.draft.imageFile && runtime.draft.categoryIds.length > 0 ) {
		cue.classList.add( 'is-ready' );
		icon.className = 'dashicons dashicons-images-alt2';
		title.textContent = __( 'The shelf presentation is ready', 'desktop-mode' );
		body.textContent = __( 'The product has a custom image and a useful category.', 'desktop-mode' );
	} else {
		cue.classList.add( 'is-progress' );
		icon.className = 'dashicons dashicons-format-image';
		title.textContent = runtime.draft.imageFile
			? __( 'The image is ready', 'desktop-mode' )
			: __( 'A placeholder keeps the draft moving', 'desktop-mode' );
		body.textContent = runtime.draft.categoryIds.length > 0
			? __( 'The selected category will help shoppers find it.', 'desktop-mode' )
			: __( 'Choose a category now, or let WooCommerce use the store default.', 'desktop-mode' );
	}

	copy.append( title, body );
	cue.append( icon, copy );
	return cue;
}

function refreshReadinessCue( runtime: StudioRuntime ): void {
	const current = runtime.stage.querySelector( '.os-woo-product-studio__readiness' );
	current?.replaceWith( readinessCue( runtime ) );
}

function markDirty( runtime: StudioRuntime ): void {
	if ( runtime.result ) {
		return;
	}
	runtime.statusBadge.setAttribute( 'tone', 'neutral' );
	runtime.statusBadge.textContent = __( 'Unsaved', 'desktop-mode' );
	runtime.recoveredDraft = false;
	persistDraft( runtime );
}

function updateDraft(
	runtime: StudioRuntime,
	key: keyof ProductDraft,
	value: ProductDraft[ keyof ProductDraft ],
): void {
	( runtime.draft as unknown as Record< string, unknown > )[ key ] = value;
	markDirty( runtime );
	renderPreview( runtime );
	refreshReadinessCue( runtime );
}

function formatPrice( runtime: StudioRuntime, raw: string ): string {
	const value = Number( raw );
	if ( raw.trim() === '' || ! Number.isFinite( value ) ) {
		return sprintf(
			/* translators: %s: store currency symbol. */
			__( '%s0.00', 'desktop-mode' ),
			runtime.bootstrap.currencySymbol,
		);
	}
	try {
		return new Intl.NumberFormat( undefined, {
			style: 'currency',
			currency: runtime.bootstrap.currencyCode,
			minimumFractionDigits: runtime.bootstrap.priceDecimals,
			maximumFractionDigits: runtime.bootstrap.priceDecimals,
		} ).format( value );
	} catch {
		return `${ runtime.bootstrap.currencySymbol }${ value.toFixed(
			runtime.bootstrap.priceDecimals,
		) }`;
	}
}

function selectedCategories( runtime: StudioRuntime ): ProductCategory[] {
	const chosen = new Set( runtime.draft.categoryIds );
	return runtime.bootstrap.categories.filter( ( item ) => chosen.has( item.id ) );
}

function renderPreview( runtime: StudioRuntime ): void {
	const { draft } = runtime;
	runtime.preview.replaceChildren();

	const previewHeader = document.createElement( 'div' );
	previewHeader.className = 'os-woo-product-studio__preview-header';
	const label = document.createElement( 'div' );
	label.className = 'os-woo-product-studio__preview-label';
	label.textContent = __( 'Live storefront preview', 'desktop-mode' );
	const helper = document.createElement( 'span' );
	helper.textContent = __( 'Updates as you type', 'desktop-mode' );
	previewHeader.append( label, helper );

	const frame = document.createElement( 'div' );
	frame.className = 'os-woo-product-studio__preview-frame';
	const storeBar = document.createElement( 'div' );
	storeBar.className = 'os-woo-product-studio__store-bar';
	const store = document.createElement( 'span' );
	const storeIcon = document.createElement( 'span' );
	storeIcon.className = 'dashicons dashicons-store';
	storeIcon.setAttribute( 'aria-hidden', 'true' );
	const storeLabel = document.createElement( 'strong' );
	storeLabel.textContent = __( 'Your storefront', 'desktop-mode' );
	store.append( storeIcon, storeLabel );
	const live = document.createElement( 'os-badge' );
	live.setAttribute( 'tone', 'info' );
	live.textContent = __( 'Live', 'desktop-mode' );
	storeBar.append( store, live );

	const card = document.createElement( 'article' );
	card.className = 'os-woo-product-studio__product-card';

	const media = document.createElement( 'div' );
	media.className = 'os-woo-product-studio__product-media';
	const image = document.createElement( 'img' );
	image.src = draft.imagePreviewUrl || runtime.bootstrap.placeholderUrl;
	image.alt = draft.imagePreviewUrl
		? draft.name || __( 'Selected product image', 'desktop-mode' )
		: '';
	if ( ! draft.imagePreviewUrl ) {
		media.classList.add( 'is-placeholder' );
	}
	media.appendChild( image );

	const state = document.createElement( 'os-badge' );
	state.setAttribute( 'tone', draft.salePrice ? 'success' : 'neutral' );
	state.className = 'os-woo-product-studio__preview-badge';
	state.textContent = draft.salePrice
		? __( 'On sale', 'desktop-mode' )
		: __( 'Preview', 'desktop-mode' );
	media.appendChild( state );

	if ( ! draft.imagePreviewUrl ) {
		const prompt = document.createElement( 'span' );
		prompt.className = 'os-woo-product-studio__image-prompt';
		prompt.textContent = __( 'Your product image lands here', 'desktop-mode' );
		media.appendChild( prompt );
	}

	const copy = document.createElement( 'div' );
	copy.className = 'os-woo-product-studio__product-copy';
	const name = document.createElement( 'h3' );
	name.textContent = draft.name.trim() || __( 'Your product name', 'desktop-mode' );
	const description = document.createElement( 'p' );
	description.textContent =
		draft.shortDescription.trim() ||
		__( 'A short, specific promise helps shoppers decide.', 'desktop-mode' );

	const price = document.createElement( 'div' );
	price.className = 'os-woo-product-studio__preview-price';
	if ( draft.salePrice.trim() ) {
		const was = document.createElement( 's' );
		was.textContent = formatPrice( runtime, draft.regularPrice );
		price.appendChild( was );
	}
	const current = document.createElement( 'strong' );
	current.textContent = formatPrice(
		runtime,
		draft.salePrice.trim() || draft.regularPrice,
	);
	price.appendChild( current );

	const categories = document.createElement( 'div' );
	categories.className = 'os-woo-product-studio__preview-categories';
	for ( const category of selectedCategories( runtime ).slice( 0, 3 ) ) {
		const chip = document.createElement( 'span' );
		chip.textContent = category.name;
		categories.appendChild( chip );
	}

	const stock = document.createElement( 'div' );
	stock.className = 'os-woo-product-studio__preview-stock';
	if ( draft.kind === 'virtual' ) {
		stock.textContent = __( 'Delivered without shipping', 'desktop-mode' );
	} else if ( draft.manageStock ) {
		stock.textContent = sprintf(
			/* translators: %s: units available. */
			__( '%s ready to sell', 'desktop-mode' ),
			draft.stockQuantity || '0',
		);
	} else {
		stock.textContent = __( 'In stock', 'desktop-mode' );
	}

	copy.append( name, price, description );
	if ( categories.childElementCount > 0 ) {
		copy.appendChild( categories );
	}
	copy.appendChild( stock );
	card.append( media, copy );
	frame.append( storeBar, card );
	runtime.preview.append( previewHeader, frame );
}

function renderKindCards( runtime: StudioRuntime ): HTMLElement {
	const grid = document.createElement( 'div' );
	grid.className = 'os-woo-product-studio__kind-grid';

	const choices: Array< {
		id: ProductKind;
		icon: string;
		title: string;
		body: string;
	} > = [
		{
			id: 'physical',
			icon: 'dashicons-archive',
			title: __( 'Physical product', 'desktop-mode' ),
			body: __( 'Something you stock, pack, or ship.', 'desktop-mode' ),
		},
		{
			id: 'virtual',
			icon: 'dashicons-cloud',
			title: __( 'Virtual product', 'desktop-mode' ),
			body: __( 'A service or item with no shipping step.', 'desktop-mode' ),
		},
	];

	for ( const choice of choices ) {
		const card = document.createElement( 'os-card' );
		card.setAttribute( 'interactive', '' );
		card.setAttribute( 'aria-label', choice.title );
		card.dataset.kind = choice.id;
		if ( runtime.draft.kind === choice.id ) {
			card.setAttribute( 'selected', '' );
		}
		const icon = document.createElement( 'span' );
		icon.className = `dashicons ${ choice.icon } os-woo-product-studio__kind-icon`;
		icon.setAttribute( 'aria-hidden', 'true' );
		const copy = document.createElement( 'span' );
		const title = document.createElement( 'strong' );
		title.textContent = choice.title;
		const body = document.createElement( 'small' );
		body.textContent = choice.body;
		copy.append( title, body );
		card.append( icon, copy );
		card.addEventListener( 'os-card-click', () => {
			updateDraft( runtime, 'kind', choice.id );
			renderStage( runtime );
		} );
		grid.appendChild( card );
	}
	return grid;
}

function renderBasics( runtime: StudioRuntime ): void {
	const errors = validateProductDraft( runtime.draft, 'basics' );
	runtime.stage.append(
		heading(
			__( 'Step 1 of 4', 'desktop-mode' ),
			__( 'The product', 'desktop-mode' ),
			__( 'Tell shoppers what makes it special in language they will understand.', 'desktop-mode' ),
		),
		editorPanel(
			__( 'Product story', 'desktop-mode' ),
			__( 'These are the details shoppers notice first.', 'desktop-mode' ),
			renderKindCards( runtime ),
			field(
				'os-text-field',
				__( 'Product name', 'desktop-mode' ),
				runtime.draft.name,
				( value ) => updateDraft( runtime, 'name', value ),
				{
					placeholder: __( 'e.g. Signal Desk Lamp', 'desktop-mode' ),
					required: true,
					invalid: Boolean( runtime.error && errors.name ),
				},
			),
			field(
				'os-text-field',
				__( 'One-line promise', 'desktop-mode' ),
				runtime.draft.shortDescription,
				( value ) => updateDraft( runtime, 'shortDescription', value ),
				{
					placeholder: __( 'What will a shopper understand in five seconds?', 'desktop-mode' ),
					hint: __( 'This appears beside the price on many storefronts.', 'desktop-mode' ),
				},
			),
			field(
				'os-textarea',
				__( 'Full description', 'desktop-mode' ),
				runtime.draft.description,
				( value ) => updateDraft( runtime, 'description', value ),
				{
					placeholder: __( 'Explain the details, materials, fit, or outcome.', 'desktop-mode' ),
					rows: 7,
				},
			),
		),
		readinessCue( runtime ),
	);
}

function renderCommerce( runtime: StudioRuntime ): void {
	const errors = validateProductDraft( runtime.draft, 'commerce' );
	runtime.stage.appendChild(
		heading(
			__( 'Step 2 of 4', 'desktop-mode' ),
			__( 'The offer', 'desktop-mode' ),
			__( 'Set the price shoppers see and decide how WooCommerce should handle inventory.', 'desktop-mode' ),
		),
	);
	const grid = document.createElement( 'div' );
	grid.className = 'os-woo-product-studio__field-grid';
	grid.append(
		field(
			'os-text-field',
			__( 'Regular price', 'desktop-mode' ),
			runtime.draft.regularPrice,
			( value ) => updateDraft( runtime, 'regularPrice', value ),
			{
				type: 'number',
				placeholder: '0.00',
				required: true,
				invalid: Boolean( runtime.error && errors.regularPrice ),
				fullWidth: false,
				hint: runtime.bootstrap.currencyCode,
			},
		),
		field(
			'os-text-field',
			__( 'Sale price', 'desktop-mode' ),
			runtime.draft.salePrice,
			( value ) => updateDraft( runtime, 'salePrice', value ),
			{
				type: 'number',
				placeholder: __( 'Optional', 'desktop-mode' ),
				invalid: Boolean( runtime.error && errors.salePrice ),
				fullWidth: false,
				hint: __( 'Leave blank when it is not on sale.', 'desktop-mode' ),
			},
		),
		field(
			'os-text-field',
			__( 'SKU', 'desktop-mode' ),
			runtime.draft.sku,
			( value ) => updateDraft( runtime, 'sku', value ),
			{
				placeholder: __( 'Optional internal code', 'desktop-mode' ),
				hint: __( 'Product Studio checks uniqueness when you save.', 'desktop-mode' ),
			},
		),
	);
	const panel = editorPanel(
		__( 'Pricing and identity', 'desktop-mode' ),
		__( 'A price is required to publish. The SKU and sale price stay optional.', 'desktop-mode' ),
		grid,
	);
	runtime.stage.appendChild( panel );

	if ( runtime.draft.kind === 'physical' ) {
		const inventory = document.createElement( 'section' );
		inventory.className = 'os-woo-product-studio__subsection';
		const h = document.createElement( 'h3' );
		h.textContent = __( 'Inventory', 'desktop-mode' );
		const toggle = document.createElement( 'os-checkbox-label' );
		toggle.setAttribute( 'label', __( 'Track the quantity on hand', 'desktop-mode' ) );
		if ( runtime.draft.manageStock ) {
			toggle.setAttribute( 'checked', '' );
		}
		toggle.addEventListener( 'os-checkbox-change', ( event: Event ) => {
			const checked = Boolean(
				( event as CustomEvent< { checked?: boolean } > ).detail?.checked,
			);
			updateDraft( runtime, 'manageStock', checked );
			renderStage( runtime );
		} );
		inventory.append( h, toggle );
		if ( runtime.draft.manageStock ) {
			inventory.appendChild(
				field(
					'os-text-field',
					__( 'Quantity available', 'desktop-mode' ),
					runtime.draft.stockQuantity,
					( value ) => updateDraft( runtime, 'stockQuantity', value ),
					{
						type: 'number',
						placeholder: '0',
						invalid: Boolean( runtime.error && errors.stockQuantity ),
					},
				),
			);
		}
		panel.appendChild( inventory );
	}
	runtime.stage.appendChild( readinessCue( runtime ) );
}

function setProductImage( runtime: StudioRuntime, file: File ): void {
	runtime.error = '';
	const allowedTypes = [ 'image/jpeg', 'image/png', 'image/gif', 'image/webp' ];
	if ( ! allowedTypes.includes( file.type ) ) {
		runtime.error = __( 'Choose a JPEG, PNG, GIF, or WebP image.', 'desktop-mode' );
		renderStage( runtime );
		return;
	}
	if ( file.size <= 0 ) {
		runtime.error = __( 'Choose an image that is not empty.', 'desktop-mode' );
		renderStage( runtime );
		return;
	}
	if ( file.size > runtime.bootstrap.maxImageBytes ) {
		runtime.error = sprintf(
			/* translators: %s: site upload limit. */
			__( 'Choose an image smaller than %s.', 'desktop-mode' ),
			runtime.bootstrap.maxImageLabel,
		);
		renderStage( runtime );
		return;
	}
	if ( runtime.objectUrl ) {
		URL.revokeObjectURL( runtime.objectUrl );
	}
	runtime.objectUrl = URL.createObjectURL( file );
	runtime.draft.imageFile = file;
	runtime.draft.imagePreviewUrl = runtime.objectUrl;
	runtime.recoveryNeedsImage = false;
	markDirty( runtime );
	renderStage( runtime );
	renderPreview( runtime );
}

function renderImagePicker( runtime: StudioRuntime ): HTMLElement {
	const host = document.createElement( 'div' );
	host.className = 'os-woo-product-studio__image-picker';
	if ( runtime.draft.imagePreviewUrl ) {
		host.classList.add( 'has-image' );
	}

	const input = document.createElement( 'input' );
	input.type = 'file';
	input.accept = 'image/jpeg,image/png,image/gif,image/webp';
	input.className = 'os-woo-product-studio__file-input';
	input.hidden = true;
	input.tabIndex = -1;

	const icon = document.createElement( 'span' );
	icon.className = 'dashicons dashicons-format-image';
	icon.setAttribute( 'aria-hidden', 'true' );
	const title = document.createElement( 'strong' );
	title.textContent = runtime.draft.imageFile
		? runtime.draft.imageFile.name
		: __( 'Add the product image', 'desktop-mode' );
	const body = document.createElement( 'span' );
	body.textContent = sprintf(
		/* translators: %s: site upload limit. */
		__( 'Drop an image here, or choose one. Maximum %s.', 'desktop-mode' ),
		runtime.bootstrap.maxImageLabel,
	);
	const choose = button(
		runtime.draft.imageFile
			? __( 'Replace image', 'desktop-mode' )
			: __( 'Choose image', 'desktop-mode' ),
		'secondary',
		() => input.click(),
	);

	host.append( input, icon, title, body, choose );
	if ( runtime.draft.imageFile ) {
		host.appendChild(
			button( __( 'Remove', 'desktop-mode' ), 'link', () => {
				if ( runtime.objectUrl ) {
					URL.revokeObjectURL( runtime.objectUrl );
				}
				runtime.objectUrl = '';
				runtime.draft.imageFile = null;
				runtime.draft.imagePreviewUrl = '';
				markDirty( runtime );
				renderStage( runtime );
				renderPreview( runtime );
			} ),
		);
	}

	input.addEventListener( 'change', () => {
		const file = input.files?.[ 0 ];
		if ( file ) {
			setProductImage( runtime, file );
		}
	} );
	for ( const type of [ 'dragenter', 'dragover' ] ) {
		host.addEventListener( type, ( event ) => {
			event.preventDefault();
			host.classList.add( 'is-dragging' );
		} );
	}
	for ( const type of [ 'dragleave', 'drop' ] ) {
		host.addEventListener( type, ( event ) => {
			event.preventDefault();
			host.classList.remove( 'is-dragging' );
		} );
	}
	host.addEventListener( 'drop', ( event: DragEvent ) => {
		const file = event.dataTransfer?.files?.[ 0 ];
		if ( file ) {
			setProductImage( runtime, file );
		}
	} );
	return host;
}

function categoryDepth(
	category: ProductCategory,
	byId: Map< number, ProductCategory >,
): number {
	let depth = 0;
	let parent = category.parent;
	const seen = new Set< number >();
	while ( parent && byId.has( parent ) && ! seen.has( parent ) && depth < 4 ) {
		seen.add( parent );
		depth++;
		parent = byId.get( parent )?.parent ?? 0;
	}
	return depth;
}

function renderCategories( runtime: StudioRuntime ): HTMLElement {
	const section = document.createElement( 'section' );
	section.className = 'os-woo-product-studio__categories';
	const title = document.createElement( 'h3' );
	title.textContent = __( 'Categories', 'desktop-mode' );
	const helper = document.createElement( 'p' );
	helper.textContent = __( 'Choose every shelf where this product belongs.', 'desktop-mode' );
	section.append( title, helper );

	if ( runtime.bootstrap.categories.length === 0 ) {
		const empty = document.createElement( 'p' );
		empty.className = 'os-woo-product-studio__category-empty';
		empty.textContent = __( 'No product categories exist yet. WooCommerce will use the store default.', 'desktop-mode' );
		section.appendChild( empty );
		return section;
	}

	const list = document.createElement( 'div' );
	list.className = 'os-woo-product-studio__category-list';
	const byId = new Map( runtime.bootstrap.categories.map( ( item ) => [ item.id, item ] ) );
	for ( const category of runtime.bootstrap.categories ) {
		const row = document.createElement( 'os-checkbox-label' );
		row.setAttribute( 'label', category.name );
		row.style.setProperty( '--os-woo-category-depth', String( categoryDepth( category, byId ) ) );
		if ( runtime.draft.categoryIds.includes( category.id ) ) {
			row.setAttribute( 'checked', '' );
		}
		row.addEventListener( 'os-checkbox-change', ( event: Event ) => {
			const checked = Boolean(
				( event as CustomEvent< { checked?: boolean } > ).detail?.checked,
			);
			const ids = new Set( runtime.draft.categoryIds );
			if ( checked ) {
				ids.add( category.id );
			} else {
				ids.delete( category.id );
			}
			updateDraft( runtime, 'categoryIds', Array.from( ids ) );
		} );
		list.appendChild( row );
	}
	section.appendChild( list );
	return section;
}

function renderPresentation( runtime: StudioRuntime ): void {
	runtime.stage.append(
		heading(
			__( 'Step 3 of 4', 'desktop-mode' ),
			__( 'The shelf', 'desktop-mode' ),
			__( 'Give shoppers a strong visual and a useful way to find the product.', 'desktop-mode' ),
		),
		editorPanel(
			__( 'Shelf presentation', 'desktop-mode' ),
			__( 'A strong image and category make the product recognizable at a glance.', 'desktop-mode' ),
			renderImagePicker( runtime ),
			renderCategories( runtime ),
		),
		readinessCue( runtime ),
	);
}

function reviewRow( label: string, value: string, ready = true ): HTMLElement {
	const row = document.createElement( 'div' );
	row.className = 'os-woo-product-studio__review-row';
	const icon = document.createElement( 'span' );
	icon.className = `dashicons ${ ready ? 'dashicons-yes-alt' : 'dashicons-marker' }`;
	icon.setAttribute( 'aria-hidden', 'true' );
	const copy = document.createElement( 'span' );
	const l = document.createElement( 'small' );
	l.textContent = label;
	const v = document.createElement( 'strong' );
	v.textContent = value;
	copy.append( l, v );
	row.append( icon, copy );
	return row;
}

function renderReview( runtime: StudioRuntime ): void {
	const publishErrors = validateProductDraft( runtime.draft, 'publish' );
	runtime.stage.appendChild(
		heading(
			__( 'Step 4 of 4', 'desktop-mode' ),
			__( 'Launch with confidence', 'desktop-mode' ),
			__( 'Product Studio will create a standard simple WooCommerce product. You can still refine advanced details in the full editor.', 'desktop-mode' ),
		),
	);

	const notice = document.createElement( 'os-notice' );
	notice.setAttribute( 'not-dismissible', '' );
	if ( Object.keys( publishErrors ).length === 0 ) {
		notice.setAttribute( 'tone', 'success' );
		notice.setAttribute( 'icon', 'dashicons-yes-alt' );
		notice.textContent = runtime.bootstrap.canPublish
			? __( 'Everything required to publish is ready.', 'desktop-mode' )
			: __( 'Everything required to submit this product as a draft is ready.', 'desktop-mode' );
	} else {
		notice.setAttribute( 'tone', 'warning' );
		notice.setAttribute( 'icon', 'dashicons-warning' );
		notice.textContent = firstErrorMessage( publishErrors );
	}
	runtime.stage.appendChild( notice );

	const rows = document.createElement( 'div' );
	rows.className = 'os-woo-product-studio__review-grid';
	rows.append(
		reviewRow(
			__( 'Product', 'desktop-mode' ),
			runtime.draft.name || __( 'Name still needed', 'desktop-mode' ),
			Boolean( runtime.draft.name.trim() ),
		),
		reviewRow(
			__( 'Offer', 'desktop-mode' ),
			runtime.draft.regularPrice
				? formatPrice( runtime, runtime.draft.salePrice || runtime.draft.regularPrice )
				: __( 'Price still needed', 'desktop-mode' ),
			Boolean( runtime.draft.regularPrice.trim() ),
		),
		reviewRow(
			__( 'Image', 'desktop-mode' ),
			runtime.draft.imageFile?.name || __( 'Using the store placeholder', 'desktop-mode' ),
			Boolean( runtime.draft.imageFile ),
		),
		reviewRow(
			__( 'Categories', 'desktop-mode' ),
			selectedCategories( runtime )
				.map( ( item ) => item.name )
				.join( ', ' ) || __( 'Store default', 'desktop-mode' ),
			true,
		),
	);
	runtime.stage.appendChild(
		editorPanel(
			__( 'Launch checklist', 'desktop-mode' ),
			__( 'A final scan of the details WooCommerce will save.', 'desktop-mode' ),
			rows,
		),
	);
}

function renderError( runtime: StudioRuntime ): void {
	const previous = runtime.stage.querySelector( '.os-woo-product-studio__error' );
	previous?.remove();
	if ( ! runtime.error ) {
		return;
	}
	const notice = document.createElement( 'os-notice' );
	notice.className = 'os-woo-product-studio__error';
	notice.setAttribute( 'tone', 'error' );
	notice.setAttribute( 'icon', 'dashicons-warning' );
	notice.setAttribute( 'not-dismissible', '' );
	notice.setAttribute( 'role', 'alert' );
	notice.textContent = runtime.error;
	runtime.stage.prepend( notice );
}

function renderRecoveryNotice( runtime: StudioRuntime ): void {
	if ( ! runtime.recoveryNeedsImage ) {
		return;
	}
	const notice = document.createElement( 'os-notice' );
	notice.className = 'os-woo-product-studio__recovery-notice';
	notice.setAttribute( 'tone', 'warning' );
	notice.setAttribute( 'icon', 'dashicons-format-image' );
	notice.setAttribute( 'not-dismissible', '' );
	notice.setAttribute( 'role', 'status' );
	notice.textContent = __( 'Draft recovered. Choose the product image again before saving.', 'desktop-mode' );
	runtime.stage.prepend( notice );
}

function renderStage( runtime: StudioRuntime ): void {
	runtime.stage.replaceChildren();
	const id = STEPS[ runtime.stepIndex ].id;
	if ( id === 'basics' ) {
		renderBasics( runtime );
	} else if ( id === 'commerce' ) {
		renderCommerce( runtime );
	} else if ( id === 'presentation' ) {
		renderPresentation( runtime );
	} else {
		renderReview( runtime );
	}
	renderRecoveryNotice( runtime );
	renderError( runtime );
	renderNavigation( runtime );
}

function renderStepRail( runtime: StudioRuntime ): void {
	runtime.stepRail.replaceChildren();
	STEPS.forEach( ( step, index ) => {
		const item = document.createElement( 'os-button' );
		item.setAttribute( 'variant', 'ghost' );
		item.className = 'os-woo-product-studio__step-button';
		item.setAttribute( 'aria-current', index === runtime.stepIndex ? 'step' : 'false' );
		if ( index < runtime.stepIndex ) {
			item.classList.add( 'is-complete' );
		}
		const number = document.createElement( 'span' );
		number.className = 'os-woo-product-studio__step-number';
		number.textContent = index < runtime.stepIndex ? '✓' : String( index + 1 );
		const copy = document.createElement( 'span' );
		const label = document.createElement( 'strong' );
		label.textContent = step.label;
		const kicker = document.createElement( 'small' );
		kicker.textContent = step.kicker;
		copy.append( label, kicker );
		item.append( number, copy );
		item.addEventListener( 'click', () => {
			if ( runtime.busy ) {
				return;
			}
			goToStep( runtime, index );
		} );
		runtime.stepRail.appendChild( item );
	} );
}

function updateProgress( runtime: StudioRuntime ): void {
	runtime.progress.setAttribute( 'value', String( ( runtime.stepIndex + 1 ) * 25 ) );
	runtime.progress.setAttribute(
		'label',
		sprintf(
			/* translators: 1: current step, 2: total steps. */
			__( 'Step %1$d of %2$d', 'desktop-mode' ),
			runtime.stepIndex + 1,
			STEPS.length,
		),
	);
}

function focusStageFeedback( runtime: StudioRuntime, hasError = false ): void {
	const target = hasError
		? runtime.stage.querySelector< HTMLElement >( '.os-woo-product-studio__error' )
		: runtime.stage.querySelector< HTMLElement >( 'h2' );
	if ( ! target ) {
		return;
	}
	target.tabIndex = -1;
	target.focus( { preventScroll: true } );
}

function goToStep( runtime: StudioRuntime, index: number, preserveError = false ): void {
	if ( ! preserveError ) {
		runtime.error = '';
	}
	runtime.stepIndex = Math.max( 0, Math.min( STEPS.length - 1, index ) );
	renderStage( runtime );
	renderStepRail( runtime );
	updateProgress( runtime );
	runtime.stage.scrollTop = 0;
	persistDraft( runtime );
	focusStageFeedback( runtime, preserveError && Boolean( runtime.error ) );
}

function validateCurrentStep( runtime: StudioRuntime ): boolean {
	const id = STEPS[ runtime.stepIndex ].id;
	const errors = validateProductDraft( runtime.draft, id );
	if ( Object.keys( errors ).length === 0 ) {
		return true;
	}
	runtime.error = firstErrorMessage( errors );
	renderStage( runtime );
	focusStageFeedback( runtime, true );
	return false;
}

function productFormData(
	draft: ProductDraft,
	status: ProductStatus,
	requestId: string,
): FormData {
	const data = new FormData();
	data.set( 'requestId', requestId );
	data.set( 'name', draft.name.trim() );
	data.set( 'shortDescription', draft.shortDescription.trim() );
	data.set( 'description', draft.description.trim() );
	data.set( 'regularPrice', draft.regularPrice.trim() );
	data.set( 'salePrice', draft.salePrice.trim() );
	data.set( 'sku', draft.sku.trim() );
	data.set( 'virtual', draft.kind === 'virtual' ? '1' : '0' );
	data.set( 'manageStock', draft.kind === 'physical' && draft.manageStock ? '1' : '0' );
	data.set( 'stockQuantity', draft.stockQuantity || '0' );
	data.set( 'stockStatus', draft.stockStatus );
	data.set( 'categoryIds', JSON.stringify( draft.categoryIds ) );
	data.set( 'status', status );
	if ( draft.imageFile ) {
		data.set( 'image', draft.imageFile, draft.imageFile.name );
	}
	return data;
}

function announceCreatedProduct( result: ProductResult ): void {
	const broadcast = (
		window.wp as
			| { os?: { broadcast?: ( topic: string, payload: unknown ) => void } }
			| undefined
	)?.os?.broadcast;
	if ( typeof broadcast === 'function' ) {
		broadcast( 'os.product.changed', {
			source: 'product-studio',
			action: 'created',
			ids: [ result.id ],
		} );
	}
}

async function submitProduct(
	runtime: StudioRuntime,
	status: ProductStatus,
): Promise< void > {
	if ( runtime.busy ) {
		return;
	}
	const validation = validateProductDraft(
		runtime.draft,
		status === 'draft' ? 'draft-save' : 'publish',
	);
	if ( Object.keys( validation ).length > 0 ) {
		runtime.error = firstErrorMessage( validation );
		if ( validation.name ) {
			goToStep( runtime, 0, true );
		} else if ( validation.regularPrice || validation.salePrice || validation.stockQuantity ) {
			goToStep( runtime, 1, true );
		} else {
			renderStage( runtime );
			focusStageFeedback( runtime, true );
		}
		return;
	}

	const cfg = getConfig();
	if ( ! cfg ) {
		runtime.error = __( 'WooCommerce Product Studio is unavailable.', 'desktop-mode' );
		renderStage( runtime );
		return;
	}

	runtime.busy = true;
	runtime.submitMode = status;
	runtime.error = '';
	renderNavigation( runtime );
	runtime.statusBadge.setAttribute( 'tone', 'info' );
	runtime.statusBadge.textContent = status === 'publish'
		? __( 'Publishing…', 'desktop-mode' )
		: __( 'Saving…', 'desktop-mode' );

	try {
		const response = await trackedFetch(
			`${ cfg.restRoot }products`,
			{
				method: 'POST',
				credentials: 'same-origin',
				signal: runtime.requestSignal,
				headers: {
					'X-WP-Nonce': cfg.restNonce,
					Accept: 'application/json',
				},
				body: productFormData( runtime.draft, status, runtime.requestId ),
			},
			{
				windowId: WINDOW_ID,
				source: 'desktop-mode/woocommerce-product-studio',
			},
		);
		const body = ( await response.json().catch( () => null ) ) as
			| ProductResult
			| { message?: string }
			| null;
		if ( ! response.ok ) {
			throw new Error(
				( body as { message?: string } | null )?.message ||
					__( 'WooCommerce could not save the product.', 'desktop-mode' ),
			);
		}
		runtime.result = body as ProductResult;
		clearStoredDraft();
		announceCreatedProduct( runtime.result );
		renderSuccess( runtime );
	} catch ( error ) {
		if ( runtime.requestSignal.aborted ) {
			return;
		}
		runtime.error = error instanceof Error
			? error.message
			: __( 'WooCommerce could not save the product.', 'desktop-mode' );
		runtime.busy = false;
		runtime.submitMode = null;
		runtime.statusBadge.setAttribute( 'tone', 'danger' );
		runtime.statusBadge.textContent = __( 'Needs attention', 'desktop-mode' );
		renderStage( runtime );
	}
}

function renderNavigation( runtime: StudioRuntime ): void {
	runtime.footer.replaceChildren();
	const leading = document.createElement( 'div' );
	leading.className = 'os-woo-product-studio__footer-leading';
	if ( runtime.stepIndex > 0 ) {
		leading.appendChild(
			button( __( 'Back', 'desktop-mode' ), 'ghost', () =>
				goToStep( runtime, runtime.stepIndex - 1 ),
			),
		);
	}
	leading.appendChild(
		button( __( 'Save draft', 'desktop-mode' ), 'secondary', () => {
			void submitProduct( runtime, 'draft' );
		} ),
	);

	const trailing = document.createElement( 'div' );
	trailing.className = 'os-woo-product-studio__footer-trailing';
	if ( runtime.stepIndex < STEPS.length - 1 ) {
		const labels = [
			__( 'Continue to offer', 'desktop-mode' ),
			__( 'Continue to shelf', 'desktop-mode' ),
			__( 'Review product', 'desktop-mode' ),
		];
		trailing.appendChild(
			button( labels[ runtime.stepIndex ], 'primary', () => {
				if ( validateCurrentStep( runtime ) ) {
					goToStep( runtime, runtime.stepIndex + 1 );
				}
			} ),
		);
	} else if ( runtime.bootstrap.canPublish ) {
		trailing.appendChild(
			button( __( 'Publish product', 'desktop-mode' ), 'holo', () => {
				void submitProduct( runtime, 'publish' );
			} ),
		);
	} else {
		trailing.appendChild(
			button( __( 'Save product draft', 'desktop-mode' ), 'primary', () => {
				void submitProduct( runtime, 'draft' );
			} ),
		);
	}

	if ( runtime.busy ) {
		for ( const control of [ ...leading.children, ...trailing.children ] ) {
			control.setAttribute( 'disabled', '' );
		}
		const active = runtime.submitMode === 'draft'
			? leading.lastElementChild
			: trailing.lastElementChild;
		active?.removeAttribute( 'disabled' );
		active?.setAttribute( 'busy', '' );
	}
	runtime.footer.append( leading, trailing );
}

function openUrlWindow( url: string, title: string, icon: string ): void {
	if ( ! url ) {
		return;
	}
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
	if ( ! os?.windowManager?.open ) {
		window.open( url, '_blank', 'noopener,noreferrer' );
		return;
	}
	const id = typeof os.deriveWindowId === 'function'
		? os.deriveWindowId( url )
		: `os-woo-product-${ url.replace( /[^a-z0-9]+/gi, '-' ).slice( -60 ) }`;
	os.windowManager.open( { id, url, title, icon } );
}

function renderSuccess( runtime: StudioRuntime ): void {
	const result = runtime.result;
	if ( ! result ) {
		return;
	}
	runtime.busy = false;
	runtime.submitMode = null;
	runtime.root.classList.add( 'is-complete' );
	runtime.statusBadge.setAttribute( 'tone', 'success' );
	runtime.statusBadge.textContent = result.status === 'publish'
		? __( 'Published', 'desktop-mode' )
		: __( 'Draft saved', 'desktop-mode' );

	const success = document.createElement( 'section' );
	success.className = 'os-woo-product-studio__success';
	const mark = document.createElement( 'span' );
	mark.className = 'dashicons dashicons-yes-alt';
	mark.setAttribute( 'aria-hidden', 'true' );
	const eyebrow = document.createElement( 'div' );
	eyebrow.className = 'os-woo-product-studio__eyebrow';
	eyebrow.textContent = result.status === 'publish'
		? __( 'Now on the shelf', 'desktop-mode' )
		: __( 'Safe in WooCommerce', 'desktop-mode' );
	const title = document.createElement( 'h2' );
	title.textContent = result.name;
	const body = document.createElement( 'p' );
	body.textContent = result.status === 'publish'
		? __( 'The product is live. Open it beside Product Studio, or refine advanced details in the full editor.', 'desktop-mode' )
		: __( 'The draft is saved. Open the full editor whenever you are ready to finish it.', 'desktop-mode' );

	const product = document.createElement( 'div' );
	product.className = 'os-woo-product-studio__success-product';
	const image = document.createElement( 'img' );
	image.src = result.thumbnail || runtime.draft.imagePreviewUrl || runtime.bootstrap.placeholderUrl;
	image.alt = '';
	const meta = document.createElement( 'div' );
	const name = document.createElement( 'strong' );
	name.textContent = result.name;
	const price = document.createElement( 'span' );
	price.textContent = result.price || formatPrice( runtime, runtime.draft.regularPrice );
	meta.append( name, price );
	product.append( image, meta );

	const actions = document.createElement( 'div' );
	actions.className = 'os-woo-product-studio__success-actions';
	if ( result.viewUrl ) {
		actions.appendChild(
			button( __( 'View product', 'desktop-mode' ), 'holo', () =>
				openUrlWindow( result.viewUrl, result.name, 'dashicons-products' ),
			),
		);
	}
	actions.append(
		button( __( 'Open full editor', 'desktop-mode' ), 'secondary', () =>
			openUrlWindow( result.editUrl, result.name, 'dashicons-products' ),
		),
		button( __( 'Create another', 'desktop-mode' ), 'ghost', () => {
			if ( runtime.objectUrl ) {
				URL.revokeObjectURL( runtime.objectUrl );
			}
			runtime.objectUrl = '';
			runtime.draft = emptyDraft();
			runtime.requestId = createRequestId();
			runtime.recoveredDraft = false;
			runtime.recoveryNeedsImage = false;
			runtime.result = null;
			runtime.stepIndex = 0;
			runtime.error = '';
			runtime.root.classList.remove( 'is-complete' );
			clearStoredDraft();
			mountWorkbench( runtime );
		} ),
	);
	success.append( mark, eyebrow, title, body, product, actions );

	const header = runtime.root.querySelector( '.os-woo-product-studio__header' );
	runtime.root.replaceChildren();
	if ( header ) {
		runtime.root.appendChild( header );
	}
	runtime.root.appendChild( success );
}

function mountWorkbench( runtime: StudioRuntime ): void {
	runtime.root.replaceChildren();

	const header = document.createElement( 'header' );
	header.className = 'os-woo-product-studio__header';
	const brand = document.createElement( 'div' );
	const eyebrow = document.createElement( 'div' );
	eyebrow.className = 'os-woo-product-studio__eyebrow';
	eyebrow.textContent = __( 'WooCommerce · Product Studio', 'desktop-mode' );
	const title = document.createElement( 'h1' );
	title.textContent = __( 'Put something new on the shelf.', 'desktop-mode' );
	brand.append( eyebrow, title );
	runtime.statusBadge = document.createElement( 'os-badge' );
	runtime.statusBadge.setAttribute( 'tone', runtime.recoveredDraft ? 'info' : 'neutral' );
	runtime.statusBadge.textContent = runtime.recoveredDraft
		? __( 'Recovered', 'desktop-mode' )
		: __( 'Unsaved', 'desktop-mode' );
	header.append( brand, runtime.statusBadge );

	runtime.progress = document.createElement( 'os-progress-bar' );
	runtime.progress.className = 'os-woo-product-studio__progress';
	runtime.progress.setAttribute( 'max', '100' );

	const workbench = document.createElement( 'div' );
	workbench.className = 'os-woo-product-studio__workbench';
	runtime.stepRail = document.createElement( 'nav' );
	runtime.stepRail.className = 'os-woo-product-studio__steps';
	runtime.stepRail.setAttribute( 'aria-label', __( 'Product creation steps', 'desktop-mode' ) );
	runtime.stage = document.createElement( 'main' );
	runtime.stage.className = 'os-woo-product-studio__stage';
	runtime.preview = document.createElement( 'aside' );
	runtime.preview.className = 'os-woo-product-studio__preview';
	runtime.preview.setAttribute( 'aria-label', __( 'Product preview', 'desktop-mode' ) );
	workbench.append( runtime.stage, runtime.preview );

	runtime.footer = document.createElement( 'footer' );
	runtime.footer.className = 'os-woo-product-studio__footer';
	runtime.root.append(
		header,
		runtime.stepRail,
		runtime.progress,
		workbench,
		runtime.footer,
	);

	renderStepRail( runtime );
	updateProgress( runtime );
	renderStage( runtime );
	renderPreview( runtime );
}

function mountProductStudio(
	root: HTMLElement,
	bootstrap: ProductStudioBootstrap,
	signal: AbortSignal,
): () => void {
	const placeholder = document.createElement( 'div' );
	const restored = restoreDraft( bootstrap );
	const runtime: StudioRuntime = {
		root,
		bootstrap,
		draft: restored?.draft ?? emptyDraft(),
		stepIndex: restored?.stepIndex ?? 0,
		busy: false,
		submitMode: null,
		error: '',
		objectUrl: '',
		requestSignal: signal,
		stage: placeholder,
		preview: placeholder,
		progress: placeholder,
		stepRail: placeholder,
		statusBadge: placeholder,
		footer: placeholder,
		result: null,
		requestId: restored?.requestId ?? createRequestId(),
		recoveredDraft: Boolean( restored ),
		recoveryNeedsImage: Boolean( restored?.hadImage ),
	};
	mountWorkbench( runtime );
	return () => {
		if ( runtime.objectUrl ) {
			URL.revokeObjectURL( runtime.objectUrl );
		}
	};
}

function paintLoadError( root: HTMLElement, message: string, retry: () => void ): void {
	const host = document.createElement( 'div' );
	host.className = 'os-woo-product-studio__load-error';
	const icon = document.createElement( 'span' );
	icon.className = 'dashicons dashicons-warning';
	icon.setAttribute( 'aria-hidden', 'true' );
	const title = document.createElement( 'h2' );
	title.textContent = __( 'Product Studio could not start.', 'desktop-mode' );
	const body = document.createElement( 'p' );
	body.textContent = message;
	host.append( icon, title, body, button( __( 'Try again', 'desktop-mode' ), 'primary', retry ) );
	root.replaceChildren( host );
}

export function openProductStudio(): boolean {
	const openWindow = (
		window.wp as
			| {
					os?: {
						openWindow?: (
							id: string,
							opts?: { source?: string },
						) => boolean;
					};
				}
			| undefined
	)?.os?.openWindow;
	return typeof openWindow === 'function'
		? openWindow( WINDOW_ID, { source: 'my-wordpress/woocommerce' } )
		: false;
}

function appendLauncher( container: HTMLElement ): void {
	if ( container.querySelector( '.os-woo-product-studio-launcher' ) ) {
		return;
	}
	const host = document.createElement( 'section' );
	host.className = 'os-woo-product-studio-launcher';
	const icon = document.createElement( 'span' );
	icon.className = 'dashicons dashicons-plus-alt2';
	icon.setAttribute( 'aria-hidden', 'true' );
	const copy = document.createElement( 'div' );
	const eyebrow = document.createElement( 'div' );
	eyebrow.className = 'os-woo-product-studio-launcher__eyebrow';
	eyebrow.textContent = __( 'Product Studio', 'desktop-mode' );
	const title = document.createElement( 'h3' );
	title.textContent = __( 'Put a new product on the shelf', 'desktop-mode' );
	const body = document.createElement( 'p' );
	body.textContent = __( 'Name it, price it, add a photo, and publish through a focused four-step flow.', 'desktop-mode' );
	copy.append( eyebrow, title, body );
	const launch = button( __( 'Create product', 'desktop-mode' ), 'holo', () => {
		openProductStudio();
	} );
	host.append( icon, copy, launch );
	container.appendChild( host );
}

let registered = false;

/** Register the Woo folder launcher and native-window renderer. */
export function registerWooProductStudio(): void {
	if ( registered ) {
		return;
	}
	registered = true;

	addAction(
		'os.my-wordpress.group-extras',
		'desktop-mode/woocommerce-product-studio',
		( payload: GroupExtrasPayload ) => {
			const cfg = getConfig();
			if ( payload.groupId !== WOO_GROUP_ID || ! cfg?.canCreateProducts ) {
				return;
			}
			appendLauncher( payload.container );
		},
	);

	type NativeRenderContext = { signal?: AbortSignal };
	type NativeWindowRenderer = (
		body: HTMLElement,
		ctx?: NativeRenderContext,
	) => unknown;
	const globals = window as unknown as {
		openStationNativeWindows?: Record< string, NativeWindowRenderer >;
	};
	globals.openStationNativeWindows = globals.openStationNativeWindows ?? {};
	globals.openStationNativeWindows[ WINDOW_ID ] = ( body, ctx ) => {
		const root = body.querySelector< HTMLElement >(
			'[data-os-woo-product-studio-root]',
		) ?? body;
		const local = new AbortController();
		const upstream = ctx?.signal;
		const abort = () => local.abort();
		upstream?.addEventListener( 'abort', abort, { once: true } );
		let cleanup: () => void = () => undefined;

		const load = async (): Promise< void > => {
			const loading = document.createElement( 'div' );
			loading.className = 'os-woo-product-studio__loading';
			loading.appendChild( document.createElement( 'os-spinner' ) );
			root.replaceChildren( loading );
			try {
				const bootstrap = await fetchBootstrap( local.signal );
				if ( local.signal.aborted ) {
					return;
				}
				cleanup();
				cleanup = mountProductStudio( root, bootstrap, local.signal );
			} catch ( error ) {
				if ( local.signal.aborted ) {
					return;
				}
				paintLoadError(
					root,
					error instanceof Error
						? error.message
						: __( 'Could not prepare Product Studio.', 'desktop-mode' ),
					() => void load(),
				);
			}
		};
		void load();

		return () => {
			upstream?.removeEventListener( 'abort', abort );
			local.abort();
			cleanup();
		};
	};
}
