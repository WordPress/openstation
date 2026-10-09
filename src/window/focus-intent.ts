/**
 * OpenStation: whose focus change is this?
 *
 * Focus moving into a window's iframe raises that window: a click in
 * the page, or a Tab from the shell into it, means the user is now
 * working there. But a page can also take focus on its own as it
 * loads (the block editor focuses an empty title on `post-new.php`),
 * and that is not the user choosing a window. On a boot that restores
 * such a window, it rose over the page the user had just asked for by
 * URL (a shared "Copy link" landed behind a blank editor).
 *
 * The browser already tracks the difference: a click or a key press
 * gives the document transient user activation, and activation inside
 * a frame is propagated to its ancestors, so the shell sees it for a
 * click in any window's page too. Without it, focus moved because a
 * script asked. A browser without `navigator.userActivation` keeps the
 * old answer: every focus change is the user's.
 */

/**
 * Whether the current focus change can be the user's doing.
 */
export function focusIsFromUser(): boolean {
	const activation = (
		globalThis.navigator as ( Navigator & { userActivation?: { isActive: boolean } } ) | undefined
	)?.userActivation;
	return activation ? activation.isActive : true;
}
