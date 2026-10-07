export function computeAutoId( element: HTMLElement ): string {
	const parts: string[] = [];
	const tabs: string[] = [];
	let windowId: string | null = null;

	let node: Element | null = element.parentElement;
	while ( node ) {
		if ( node === document.body || node === document.documentElement ) {
			break;
		}
		const id = node.id || '';
		if ( id.startsWith( 'wp-window-' ) ) {
			windowId = id.slice( 'wp-window-'.length );
			break;
		}

		if ( node.tagName.toLowerCase() === 'os-tabpanel' ) {
			const forValue = node.getAttribute( 'for' );
			if ( forValue ) {
				tabs.unshift( forValue );
			}
		}
		node = node.parentElement;
	}

	if ( windowId ) {
		parts.push( slugify( windowId ) );
	}
	for ( const tab of tabs ) {
		parts.push( 'tab-' + slugify( tab ) );
	}
	const label = element.getAttribute( 'label' );
	if ( label ) {
		parts.push( slugify( label ) );
	}

	if ( parts.length === 0 ) {
		return 'os-unnamed';
	}
	return 'os-' + parts.filter( ( p ) => p !== '' ).join( '-' );
}

function slugify( s: string ): string {
	return s
		.toLowerCase()
		.replace( /[^a-z0-9]+/g, '-' )
		.replace( /^-+|-+$/g, '' );
}

export function ensureAutoId( element: HTMLElement ): string {
	if ( element.id ) {
		return element.id;
	}
	const id = computeAutoId( element );
	element.id = id;
	return id;
}
