# Edit a record with one form values map

Use the standard component loader described in [the component reference](../components-reference.md).
This example is client-side form handling; authorization and persistence still belong on the server.

```html
<os-form submit-label="Save" show-reset="false">
    <os-text-field name="title" label="Title" required></os-text-field>
    <os-switch name="pinned" label="Pinned"></os-switch>
    <os-range-field name="progress" label="Progress" min="0" max="100"></os-range-field>
    <os-color-field name="color" label="Color"></os-color-field>
    <os-tag-input name="tags" label="Tags" creatable removable></os-tag-input>
</os-form>
```

```ts
import type { OsForm, OsTagInput } from 'openstation';

const form = host.querySelector<OsForm>('os-form')!;
const tags = host.querySelector<OsTagInput>('os-tag-input')!;
form.setValues({ title: 'Ship app', pinned: true, progress: '65',
    color: '#cc3344', tags: [{ label: 'release' }] });

// Tags are controlled: the app owns add/remove policy (such as deduplication).
tags.addEventListener('os-tag-add', (event) => {
    const { tag } = (event as CustomEvent).detail;
    tags.value = [...tags.value.filter((item) => item.label !== tag.label), tag];
});
tags.addEventListener('os-tag-remove', (event) => {
    const { tag } = (event as CustomEvent).detail;
    tags.value = tags.value.filter((item) => item.label !== tag.label);
});

form.addEventListener('os-form-submit', async (event) => {
    const { values } = (event as CustomEvent).detail;
    form.setBusy(true);
    form.setError(null);
    try {
        // saveRecord is your authenticated persistence function.
        await saveRecord({ ...values, progress: Number(values.progress) });
    } catch (error) {
        form.setError(error instanceof Error ? error.message : String(error));
    } finally {
        form.setBusy(false);
    }
});
```

Use `setValues()` to load another record or clear a new-record form.
`reset()` restores mount-time defaults; it does not revert server data or clear an
app's selected record ID. If using the Reset button in an editor, handle
`os-form-reset` to keep selection state consistent, or hide it and supply a New action.
