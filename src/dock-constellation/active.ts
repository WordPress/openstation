/**
 * Is the hover-submenu flyout live?
 *
 * A deliberate leaf module with zero imports. Two very different
 * consumers ask this question — the constellation itself, and
 * `dock-peek`, which has to stand down for menu tiles while the
 * constellation owns the hover gesture — and routing the answer
 * through either of them would put an import edge between two modules
 * that otherwise know nothing about each other.
 *
 * It used to ask which LAYOUT was painted, because the flyout was
 * something one layout had. It is now on every rail in every layout,
 * so the only thing left worth asking is whether it is mounted at
 * all: a dock rendered without it — a plugin embedding the rail on
 * its own, a test — must keep the peek on menu tiles rather than
 * leave them with no hover surface whatsoever.
 *
 * The mount writes the flag and its teardown clears it, so the DOM is
 * the source of truth. A module-level boolean would give every bundle
 * that imports this file its own copy of the answer.
 */

/** Set on `<body>` for as long as a constellation is mounted. */
export const CONSTELLATION_FLAG = 'data-os-constellation';

export function isConstellationMounted(): boolean {
	return document.body.hasAttribute( CONSTELLATION_FLAG );
}
