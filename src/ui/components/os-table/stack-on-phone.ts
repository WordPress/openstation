import { isMobileStamped } from '../../../mode/stamp';

export function stackOnPhone( table: Element, root: Element | null = null ): boolean {
	const stampRoot = root ?? ( typeof document !== 'undefined' ? document.documentElement : null );
	const phone = !! stampRoot && isMobileStamped( stampRoot );
	if ( phone ) {
		if ( ! table.hasAttribute( 'stacked' ) ) {
			table.setAttribute( 'stacked', '' );
		}

		const sticky = table.getAttribute( 'sticky-columns' );
		if ( sticky !== null ) {
			table.setAttribute( 'data-os-sticky-columns', sticky );
			table.removeAttribute( 'sticky-columns' );
		}
		return true;
	}
	if ( table.hasAttribute( 'stacked' ) ) {
		table.removeAttribute( 'stacked' );
	}
	const kept = table.getAttribute( 'data-os-sticky-columns' );
	if ( kept !== null ) {
		table.setAttribute( 'sticky-columns', kept );
		table.removeAttribute( 'data-os-sticky-columns' );
	}
	return false;
}
