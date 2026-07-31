# JotterJS

A lightweight, vanilla JS rich-text editor component built on `contenteditable`. No dependencies at runtime.

## Features

- Full formatting toolbar (bold, italic, underline, strikethrough, subscript/superscript, inline code)
- Block format, font family, font size, and colour pickers
- Lists, indentation, alignment, tables, links, and image insertion
- Source (raw HTML) toggle
- Content themes: `default`, `warm`, `ink`, `forest`
- Pre-built toolbar presets (`minimal`, `writing`, `full`) and fully custom toolbar support
- Custom toolbar buttons with `onClick` callbacks
- Replaceable insert dialogs — swap the built-in image/link/video/embed popups for your own UI
- Selection bookmarks that survive async host UI and DOM mutation
- Event system (`change`, `focus`, `blur`)
- Simple chainable API

## Installation

```bash
npm install jotterjs
```

Or use the built files from `dist/` directly in a `<script>` tag.

## Usage

### ES Module

```js
import JotterJS from 'jotterjs';

const editor = new JotterJS('#my-editor', {
  height: '320px',
  placeholder: 'Start typing…',
  onChange: (html) => console.log(html),
});
```

### IIFE (script tag)

```html
<link rel="stylesheet" href="dist/jotter.min.css" />
<script src="dist/jotter.iife.min.js"></script>
<script>
  const editor = new JotterJS('#my-editor');
</script>
```

## Options

| Option        | Type       | Default          | Description                                      |
|---------------|------------|------------------|--------------------------------------------------|
| `placeholder` | `string`   | `'Start typing…'`| Placeholder text shown when the editor is empty |
| `height`      | `string`   | `'320px'`        | Min-height of the editable area                  |
| `theme`       | `string`   | `'default'`      | Content theme: `default`, `warm`, `ink`, `forest`|
| `toolbar`     | `Array`    | Full toolbar     | Array of action descriptors                      |
| `onChange`    | `Function` | —                | Callback `(html)` fired on every content change  |
| `onFocus`     | `Function` | —                | Callback fired on editor focus                   |
| `onBlur`      | `Function` | —                | Callback fired on editor blur                    |
| `onRequestImage` | `Function` | —             | Replaces the Insert Image popup — see [Replacing a built-in popup](#replacing-a-built-in-popup) |
| `onRequestLink`  | `Function` | —             | Replaces the Insert Link popup                   |
| `onRequestVideo` | `Function` | —             | Replaces the Insert Video popup                  |
| `onRequestEmbed` | `Function` | —             | Replaces the Insert Embed popup                  |

`change` fires once per edit. `focus` and `blur` describe the editor as a whole:
moving into the editor's own popup is not a blur, and neither is host UI opened
between `beginExternalUI()` and `endExternalUI()`.

## API

```js
editor.getHTML()          // → string  — raw innerHTML
editor.getText()          // → string  — plain text
editor.setHTML(html)      // replace content
editor.insertHTML(html)   // insert HTML at caret
editor.insertText(text)   // insert plain text at caret
editor.clear()            // empty the editor
editor.focus()            // focus the editable area
editor.setTheme(name)     // change theme at runtime
editor.setEnabled(bool)   // toggle contenteditable
editor.toggleSource()     // switch rich-text ↔ HTML source view
editor.isSourceMode()     // → boolean
editor.on(event, fn)      // subscribe to 'change' | 'focus' | 'blur'
editor.off(event, fn)     // unsubscribe
editor.destroy()          // unmount and return final HTML

// Working across async host UI
editor.saveSelection()          // → token — bookmark the caret
editor.restoreSelection(token)  // put the caret back (consumes the token)
editor.releaseSelection(token)  // discard a bookmark instead
editor.insertHTML(html, { at: token })   // restore, then insert
editor.insertText(text, { at: token })
editor.beginExternalUI()        // your UI is taking over: hold the caret, hush focus/blur
editor.endExternalUI()          // your UI is done: caret back, events resume
```

Methods return `this` for chaining (except `getHTML`, `getText`, `saveSelection`,
`isSourceMode`, and `destroy`).

## Toolbar Presets

```js
new JotterJS('#el', { toolbar: JotterJS.presets.minimal });
new JotterJS('#el', { toolbar: JotterJS.presets.writing });
new JotterJS('#el', { toolbar: JotterJS.presets.full });    // the default toolbar
```

Every preset is composed from `JotterJS.actions`, so a given command has the
same icon and tooltip whichever toolbar it appears in. Extend one by spreading:

```js
new JotterJS('#el', {
  toolbar: [
    ...JotterJS.presets.minimal,
    JotterJS.actions.sep,
    JotterJS.actions.image,
  ],
});
```

## Custom Toolbar

Action descriptors and preset arrays are frozen and shared between presets, so
customise by copying rather than mutating in place:

```js
{ ...JotterJS.actions.image, onClick: fn }   // ✓
JotterJS.actions.image.onClick = fn          // ✗ throws — would leak everywhere
```

```js
const { actions } = JotterJS;

new JotterJS('#el', {
  toolbar: [
    actions.bold,
    actions.italic,
    actions.sep,
    {
      icon: 'star',
      title: 'Insert signature',
      onClick: (editor) => editor.insertHTML('<p><em>— Sent with JotterJS</em></p>'),
    },
    {
      label: 'Clear',
      title: 'Clear content',
      onClick: (editor) => editor.clear(),
    },
  ],
});
```

## Replacing a built-in popup

The insert dialogs are defaults, not fixtures. An app with its own asset library
wants "pick from files uploaded to this course", not a URL field. There are two
ways in, depending on how much you want to own.

### Resolver hooks — keep the button, replace the dialog

Pass an `onRequest*` option and the toolbar button awaits it instead of opening
the popup. You answer *which image*; the editor still bookmarks the caret,
restores it afterwards, builds the markup and emits `change`:

```js
new JotterJS('#el', {
  onRequestImage: async ({ src, alt, width }) => {
    const file = await myAssetLibrary.pick();   // your modal, focus trap and all
    if (!file) return null;                     // null (or a throw) = cancelled
    return { src: file.url, alt: file.title, width: '480px' };
  },
});
```

| Hook             | Receives                                          | Return                                        |
|------------------|---------------------------------------------------|-----------------------------------------------|
| `onRequestImage` | `{ src, alt, width, selection }`                  | `{ src, alt, width }` or a `src` string        |
| `onRequestLink`  | `{ href, text, title, target, selection, isEdit }`| `{ href, text, title, target }` or an `href` string |
| `onRequestVideo` | `{ url, selection }`                              | `{ url }` / `{ id }` or a URL string           |
| `onRequestEmbed` | `{ html, selection }`                             | `{ html }` or an HTML string                   |

`onRequestLink` doubles as edit mode: when the caret sits inside an `<a>`, the
context arrives pre-filled with `isEdit: true`, and what you return replaces that
anchor. Take as long as you like — an upload with a progress bar, a re-render,
anything: the insertion point is bookmarked, not merely remembered.

### `onClick` — replace the button outright

`onClick` outranks everything else on a descriptor, popup actions included:

```js
const { actions } = JotterJS;

new JotterJS('#el', {
  toolbar: [
    actions.bold, actions.italic, actions.sep,
    { ...actions.image, onClick: (editor) => openMyPicker(editor) },
  ],
});
```

You now own the whole interaction, including the caret. Wrap the async part so
the editor knows host UI has the floor:

```js
async function openMyPicker(editor) {
  editor.beginExternalUI();          // hold the caret, stop emitting focus/blur
  try {
    const file = await myAssetLibrary.pick();
    editor.endExternalUI();          // caret comes back before we insert
    if (file) editor.insertHTML(`<img src="${file.url}" alt="">`);
  } catch (err) {
    editor.endExternalUI();
  }
}
```

Or bookmark explicitly, if the caret must outlive several steps:

```js
const bookmark = editor.saveSelection();
const file = await upload(blob);                    // DOM churns meanwhile
editor.insertHTML(`<img src="${file.url}">`, { at: bookmark });
```

Bookmarks are marker nodes, not cloned ranges, so they still point at the right
spot after the surrounding DOM has changed. Each token is consumed exactly once —
by `restoreSelection`, by `insertHTML(..., { at })`, or by `releaseSelection` if
the user cancels. They never appear in `getHTML()`.

### Why `beginExternalUI` matters

A `contenteditable` blurs the moment your modal takes focus. Hosts that save on
blur then re-render, and a re-render remounts the editor — with your modal still
open on top of it. Between `beginExternalUI()` and `endExternalUI()`, `blur` and
`focus` are not emitted, so that chain never starts. The `onRequest*` hooks wrap
this for you.

## Development

```bash
npm run dev    # start dev server
npm run build  # build to dist/
```

`test/index.html` is the manual playground; `test/spec.html` is a self-checking
behaviour spec — open it and read the pass/fail list.

## License

MIT
