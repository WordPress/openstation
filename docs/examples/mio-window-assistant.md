# Register a window companion

**Status: Experimental.** Full contract: [Window-scoped MIO](../mio-window-assistant.md).

This example opts one live App Framework window into MIO. It never registers a WordPress Ability or a global command. Its one action delegates persistence to the app's normal, permission-checked server action.

```typescript
import { defineApp, html } from '@openstation/app';
import type { MioAbility } from 'openstation';
import help from './help/index.md?raw';

export default defineApp('my-reader', {
    view: ({ state }) => html`<p>Density: ${state.density}</p>`,
    mounted(ctx) {
        const density: MioAbility = {
            name: 'set_density',
            description: 'Set this reader’s density to compact or comfortable.',
            parameters: {
                type: 'object',
                properties: { value: { type: 'string', enum: ['compact', 'comfortable'] } },
                required: ['value'],
                additionalProperties: false,
            },
            validate: (args) => Object.keys(args).length === 1 &&
                ['compact', 'comfortable'].includes(String(args.value)),
            async run(args, signal) {
                if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
                // Declare this action in the app's .os.php with validation and permission checks.
                const saved = await ctx.dispatch('set-density', { value: args.value });
                if (!saved) throw new Error('Density could not be saved.');
                return { saved: true, density: ctx.state.density };
            },
        };
        const lease = wp.os.mio.registerWindow(ctx.windowId, {
            host: ctx.root,
            title: 'My reader',
            prompt: () => `You are MIO in My reader. Current density: ${ctx.state.density}. Explain this reader and change density only when asked.`,
            documents: [{ id: 'index.md', title: 'Reader guide', markdown: help }],
            abilities: () => [density],
        });
        return () => lease.dispose();
    },
});
```

Import additional Markdown files as `{id, title, markdown}` entries and link them with ordinary relative links. Never load a path suggested by the model. For choices from a dynamic registry, offer a read/list action and validate selected ids against that same live registry immediately before writing.

The shipped [Preferences integration](../../apps/os-settings/parts/mio.ts) demonstrates a larger catalog, nine linked help documents, dynamic capability gates and chained changes. See its [user help](../../apps/os-settings/help/index.md) for a complete control-by-control example.

A registration leaves the mascot hidden until chat opens. For an explicit control tip, call `lease.showCallout({ id: 'density-help', target: () => ctx.root.querySelector('[data-density-control]'), message: 'Choose your reading density.' })`. The target must belong to this window; return null when that view is absent. Closing the tip suppresses that id until the lease is disposed. `clearCallout()` withdraws it without dismissal. Preferences demonstrates a tip beside the About journal heading.
