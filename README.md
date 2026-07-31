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
```

Methods return `this` for chaining (except `getHTML`, `getText`, `isSourceMode`, and `destroy`).

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

## Development

```bash
npm run dev    # start dev server
npm run build  # build to dist/
```

## License

MIT
