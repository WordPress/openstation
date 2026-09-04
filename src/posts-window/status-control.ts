/**
 * Native Posts / Pages / Users windows — the status control.
 *
 * The toolbar's first control is the status filter: All / Published /
 * Drafts / … as an `<os-segmented>` pill bar on a desk, where six pills
 * fit on one row. On a phone they do not — six pills in 360px wrap
 * into two ragged rows and push the search field off the toolbar — so
 * the same list is offered as an `<os-select>` there. The two
 * components share their contract on purpose (set `value`, listen for
 * `os-pick`, populate through `items`), which is what lets the window
 * swap the tag and keep every listener it already has.
 *
 * The decision reads the shell's mode stamp, not the window's width:
 * a desktop window pulled narrow keeps the pills (they wrap, which is
 * fine under a mouse) and a phone gets the picker even in landscape.
 */
import { isMobileStamped } from '../mode/stamp';
import '../ui/components/os-select/os-select';
import '../ui/components/os-segmented/os-segmented';

export interface StatusSegment {
	value: string;
	label: string;
}

/**
 * Populate the status control in `host`, swapping the host for an
 * `<os-select>` when the shell is in its phone mode. Returns the
 * element that now carries the host's attributes and sits in its
 * place — the same node when nothing was swapped — so the caller can
 * keep querying the toolbar by the data attribute it already uses.
 *
 * @param host     The `<os-segmented data-os-posts-status>` from the template.
 * @param segments The status list, already filtered.
 * @param value    The current status (`''` for All).
 * @param root     The element carrying the mode stamp; the document's by default.
 */
export function mountStatusControl(
	host: HTMLElement,
	segments: readonly StatusSegment[],
	value: string,
	root: Element | null = null,
): HTMLElement {
	const stampRoot = root ?? ( typeof document !== 'undefined' ? document.documentElement : null );
	const asSelect = !! stampRoot && isMobileStamped( stampRoot );
	let control = host;
	if ( asSelect && host.localName !== 'os-select' ) {
		control = document.createElement( 'os-select' );
		for ( const attr of Array.from( host.attributes ) ) {
			control.setAttribute( attr.name, attr.value );
		}
		if ( ! control.hasAttribute( 'aria-label' ) && ! control.hasAttribute( 'label' ) ) {
			control.setAttribute( 'aria-label', host.getAttribute( 'aria-label' ) ?? '' );
		}
		host.replaceWith( control );
	}
	control.replaceChildren();
	const childTag = control.localName === 'os-select' ? 'os-option' : 'os-segment';
	for ( const seg of segments ) {
		const el = document.createElement( childTag );
		el.setAttribute( 'value', seg.value );
		el.textContent = seg.label;
		control.appendChild( el );
	}
	// Mirror the view value so the right entry paints as selected on
	// the first frame (the parent's `value` attribute is what both
	// components read).
	control.setAttribute( 'value', value );
	return control;
}
