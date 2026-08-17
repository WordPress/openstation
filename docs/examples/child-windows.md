# Open a child window its owner can't cover

**Stable.**

A **child window** is a real window — own chrome, drag, resize, minimize, taskbar entry — with one rule layered on top: **its owner can never sit above it.** Clicking the owner shakes the child and leaves focus there.

Use it where you would otherwise reach for a modal dialog but what you actually want is a window, because the user needs to keep reading what's behind it: a full editor for one row of a list, a wizard beside the page it configures, a diff over the revision it belongs to.

The owner stays completely usable throughout — scrollable, draggable, resizable, minimizable. Only its z-order is constrained.

## The whole recipe

```js
// Open an audit panel owned by the post window it belongs to.
const child = await wp.os.windowManager.openChild( 'edit-post-42', {
	id: 'my-plugin-seo-audit-42',
	url: '#seo-audit-42',
	title: 'SEO audit',
	icon: 'dashicons-chart-line',
	width: 480,
	height: 560,
	native: true,
	render: ( body ) => {
		body.innerHTML = '<h2>Fix these before publishing</h2>';
	},
} );
```

That's it. The child centers over its owner's current position, opens on the owner's virtual desktop, and from then on the post window cannot be raised above it.

`openChild()` **throws** if `parentWindowId` names no open window — a child of nothing has nothing to block, so failing loudly beats quietly opening a standalone window.

Everything `open()` accepts works here too (`native`, `render`, `params`, `width`, `initialState`, …). Pass `x` / `y` to place the child yourself instead of centering it.

## Registering it from a title-bar button

The natural trigger — a button on the owner's own title bar:

```js
wp.os.registerTitleBarButton( {
	id: 'my-plugin/seo-audit',
	label: 'SEO audit',
	icon: 'dashicons-chart-line',
	placement: 'right',
	match: ( win ) => !! win.config.url?.includes( 'post.php' ),
	onClick: ( win ) => {
		const id = `my-plugin-seo-audit-${ win.id }`;
		// Already open? `openChild` reuses by id exactly as `open`
		// does, and focus lands on the child either way.
		void wp.os.windowManager.openChild( win.id, {
			id,
			url: `#${ id }`,
			title: 'SEO audit',
			icon: 'dashicons-chart-line',
			native: true,
			render: ( body ) => renderAudit( body, win.id ),
		} );
	},
} );
```

## Reacting when the user tries to leave

Every blocked focus attempt fires an event. The child already shakes; this is for adding your own nudge on top.

```js
document.addEventListener( 'os-window-child-blocked', ( e ) => {
	const { windowId, childWindowId } = e.detail;
	if ( childWindowId !== 'my-plugin-seo-audit-42' ) {
		return;
	}
	wp.os.showToast( {
		message: 'Finish the audit — it saves when you close it.',
	} );
	console.log( `${ windowId } stayed put` );
} );
```

Same payload on the `os.window.child-blocked` action if you prefer the hook bus:

```js
wp.hooks.addAction(
	'os.window.child-blocked',
	'my-plugin/audit-nudge',
	( { windowId, childWindowId } ) => { /* … */ },
);
```

## Inspecting ownership

```js
const mgr = wp.os.windowManager;

mgr.childrenOf( 'edit-post-42' );        // [ Window ] — direct children, z-order
mgr.ownerOf( child );                    // the post window
mgr.blockingChildOf( postWindow );       // the deepest child holding focus, or undefined
```

`childrenOf()` includes minimized children (you need them to answer "what does closing this take with it"). `blockingChildOf()` does not — see below.

## The behaviors worth knowing before you ship

| | |
|---|---|
| **Chains** | A child can own a child. Focus goes to the deepest link; the middle ones are blocked in turn. |
| **Close** | Closing an owner closes its children. A child with unsaved changes still gets to ask — one that vetoes outlives its owner and becomes an ordinary window, which beats discarding the user's work. |
| **Minimize** | Minimizing an owner minimizes its children; restoring brings back exactly the ones the cascade put away. A child the user had already minimized themselves stays minimized. |
| **Minimized children stop blocking** | The user put it away on purpose, so the owner is theirs again until they bring it back. Don't build a flow that depends on the child being unreachable — it isn't a security boundary, it's an affordance. |
| **Unrelated windows** | Ownership constrains owner-vs-child and nothing else. Any other window can still be focused over both. |
| **Session** | Children are **not** persisted across a reload. A restored child whose owner failed to come back (deactivated plugin, dead URL) would block a window that doesn't exist. If your child holds state worth keeping, save it yourself and reopen from the owner. |

## When you want the other thing

If what you actually want is a *visual* relationship between peer windows — a post and its comments, tied together with lines drawn on the desktop, either one focusable — that's [content relations](./window-links.md), not ownership. Ownership is specifically about z-order and focus.

And if the surface really is a dialog (short, answer-then-dismiss, nothing to read behind it), use [`<os-confirm-dialog>` / `wp.os.confirm`](../components-reference.md) instead. A window has a title bar, a taskbar entry and a resize grip; a yes/no question doesn't need any of them.
