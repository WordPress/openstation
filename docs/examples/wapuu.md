# Make Wapuu your plugin's notifier + helper

> Status: **Experimental** *(since 0.32.0)* — see [`wp.desktop.wapuu`](../javascript-reference.md#wapuu--experimental-since-0320).

The Wapuu pet widget exposes `wp.desktop.wapuu` while it's mounted on
the desktop (the user adds it from the widget picker). Your plugin can
pop comic balloons, ask one-shot questions, run a persistent chat, and
trigger his tricks. Everything is a safe no-op when Wapuu isn't around,
but guard with `?.` anyway — it documents intent.

## PHP — enqueue a shell-side script

```php
<?php
/**
 * Plugin Name: Wapuu Deploy Buddy
 */
defined( 'ABSPATH' ) || exit;

add_action( 'admin_enqueue_scripts', function () {
	if ( ! function_exists( 'desktop_mode_is_enabled' ) || ! desktop_mode_is_enabled() ) {
		return;
	}
	wp_enqueue_script(
		'wapuu-deploy-buddy',
		plugins_url( 'deploy-buddy.js', __FILE__ ),
		array( 'desktop-mode' ),
		'1.0.0',
		true
	);
} );
```

## JS — celebrate a deploy

```javascript
// deploy-buddy.js
wp.desktop.ready( () => {
	// Subscribe to your own activity channel (or any signal you have).
	wp.desktop.activity.subscribe( 'my-plugin/deploy-finished', () => {
		wp.desktop.wapuu?.jump();
		wp.desktop.wapuu?.yell( 'Deploy finished! 🚀' );
	} );
} );
```

## JS — a one-shot question

```javascript
const title = await wp.desktop.wapuu?.ask( 'Name the new draft?', {
	placeholder: 'Post title…',
} );
if ( title ) {
	await createDraft( title ); // your code
	wp.desktop.wapuu?.say( 'Draft created! ✨' );
}
// `title` is null if the user pressed Escape or the balloon was replaced.
```

## JS — a back-and-forth chat wired to your backend

```javascript
function openSupportChat() {
	const session = wp.desktop.wapuu.chat( {
		placeholder: 'Ask me about your site…',
		messages: [
			{ role: 'assistant', content: 'Hi! 👋 What do you need?' },
		],
		onSend: async ( text ) => {
			session.setTyping( true );
			try {
				// Route through the framework fetch — never raw fetch().
				const res = await wp.desktop.fetch( '/wp-json/my-plugin/v1/chat', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify( { text } ),
				}, { source: 'my-plugin/wapuu-chat' } );
				const data = await res.json();
				session.setTyping( false );
				// OpenAI-format messages — tool calls render as machine chips.
				session.appendMany( data.messages );
			} catch ( err ) {
				session.setTyping( false );
				session.append( {
					role: 'assistant',
					content: 'Hmm, something went wrong. 😿',
				} );
			}
		},
		onClose: () => {
			// Escape, backdrop click, the ball button, or replaced.
		},
	} );
}
```

A response with tool activity renders the calls inline:

```javascript
session.appendMany( [
	{
		role: 'assistant',
		tool_calls: [ {
			type: 'function',
			function: { name: 'get_site_health', arguments: '{"checks":"all"}' },
		} ],
	},
	{ role: 'tool', content: '✓ 12 passed, 1 recommendation' },
	{ role: 'assistant', content: 'All good — one minor recommendation.' },
] );
```

## Notes

- **One balloon at a time.** Opening any balloon replaces the current
  one; a replaced live chat fires its `onClose`.
- Balloons render UNDER the window stack — they never cover a focused
  window.
- The user can also open the chat themselves by clicking the WordPress
  ball on Wapuu (the W swaps to a "?" while the chat is open).
