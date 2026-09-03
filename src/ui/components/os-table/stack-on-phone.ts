/**
 * `<os-table>` on a phone — the one decision every list window makes.
 *
 * A table on a phone is a card list: `stacked` on, sticky columns off.
 * The decision reads the shell's mode stamp rather than the window's
 * width, for the same reason the status control does
 * (`statusControl()` in `src/app-runtime/list-ui.ts`): a desktop window pulled
 * narrow keeps its grid, which scrolls sideways under a mouse, and a
 * phone gets the cards even in landscape, where the window is wider
 * than any container threshold. Idempotent, and it puts the grid
 * back when the stamp is gone, so a window that outlives a crossing
 * can call it again.
 *
 * @public
 */
import { isMobileStamped } from '../../../mode/stamp';

/**
 * Apply the phone layout to a table when the shell is in its phone
 * mode, and lift it otherwise. Returns whether the table is stacked.
 *
 * @param table The `<os-table>` element.
 * @param root  The element carrying the mode stamp; the document's by default.
 */
export function stackOnPhone( table: Element, root: Element | null = null ): boolean {
	const stampRoot = root ?? ( typeof document !== 'undefined' ? document.documentElement : null );
	const phone = !! stampRoot && isMobileStamped( stampRoot );
	if ( phone ) {
		if ( ! table.hasAttribute( 'stacked' ) ) {
			table.setAttribute( 'stacked', '' );
		}
		// A pinned column over a card list has nothing to pin against;
		// the attribute is remembered so the grid gets it back.
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
