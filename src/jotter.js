/**
 * @class JotterJS
 * @description Vanilla JS rich-text editor built on contenteditable + execCommand.
 *
 * @param {string|Element} target  CSS selector or DOM element to mount into.
 * @param {object}         [options]
 * @param {string}         [options.placeholder='Start typing…']
 * @param {string}         [options.height='320px']          Min-height of the editable area.
 * @param {string}         [options.theme='default']         Content theme: 'default'|'warm'|'ink'|'forest'.
 * @param {Array}          [options.toolbar]                 Override toolbar — array of action descriptors.
 *                                                           Defaults to JotterJS.presets.full.
 * @param {Function}       [options.onChange]                Callback(html) fired on every content change.
 * @param {Function}       [options.onFocus]                 Callback fired on editor focus.
 * @param {Function}       [options.onBlur]                  Callback fired on editor blur.
 * @param {Function}       [options.onRequestImage]          async(ctx) → {src, alt, width} | string | null.
 * @param {Function}       [options.onRequestLink]           async(ctx) → {href, text, title, target} | string | null.
 * @param {Function}       [options.onRequestVideo]          async(ctx) → {url} | {id} | string | null.
 * @param {Function}       [options.onRequestEmbed]          async(ctx) → {html} | string | null.
 *
 * Any onRequest* hook replaces the matching built-in popup: the toolbar button
 * awaits the hook instead of opening the popup, and the editor keeps ownership
 * of bookmarking the caret, restoring it, building the HTML and emitting change.
 * Returning null (or throwing) means "cancelled". While a hook is pending the
 * editor suppresses focus/blur emission, so host modals cannot trigger
 * save-on-blur → re-render → remount while their own UI is still open.
 *
 * @fires change  (html: string)
 * @fires focus
 * @fires blur
 *
 * Public API (all methods return `this` for chaining unless noted):
 *   getHTML()           → string   Raw innerHTML (sanitized). In source mode returns textarea value.
 *   getText()           → string   Plain text (innerText).
 *   setHTML(html)                  Replace content; sanitized before insertion.
 *   insertHTML(html, opts)         Insert sanitized HTML at caret / selection, or at opts.at bookmark.
 *   insertText(text, opts)         Insert plain text at caret, or at opts.at bookmark.
 *   clear()                        Empty the editor.
 *   focus()                        Focus the editable area.
 *   saveSelection()     → token    Bookmark the current selection; survives DOM mutation.
 *   restoreSelection(t)            Restore (and consume) a bookmark from saveSelection().
 *   releaseSelection(t)            Discard a bookmark without restoring it.
 *   beginExternalUI()              Host UI is taking over: suppress focus/blur, bookmark the caret.
 *   endExternalUI(opts)            Host UI is done: restore the caret (unless opts.restore === false).
 *   setTheme(name)                 Change content theme at runtime.
 *   setEnabled(bool)               Toggle contenteditable.
 *   toggleSource()                 Switch between rich-text and raw HTML source view.
 *   isSourceMode()      → boolean
 *   on(event, fn)                  Subscribe to 'change'|'focus'|'blur'.
 *   off(event, fn)                 Unsubscribe.
 *   destroy()           → string   Unmount; restore original innerHTML; return final HTML.
 *
 * Static properties:
 *   JotterJS.toolbar    Full default toolbar array (alias of JotterJS.presets.full).
 *   JotterJS.actions    Named action descriptors (pick and compose custom toolbars).
 *   JotterJS.presets    { minimal, writing, full } — toolbar arrays built from JotterJS.actions.
 */

// ─── Constants ────────────────────────────────────────────────────────────────
//
// Action descriptor shape:
//   { type: 'sep' }                              → visual separator
//   { type: 'blockformat|fontfamily|fontsize|color|theme' } → built-in select/widget
//   { type: 'popup', id: string, icon, title }   → popup panel identified by id
//   { cmd: string, icon?, label?, title }        → document.execCommand wrapper
//   { custom: string, icon?, label?, title }     → internal method dispatch
//   { icon?, label?, title, onClick(editor) }    → external callback button
//
// `onClick` outranks `type`: a descriptor carrying one always renders as a
// plain callback button, so `{ ...JotterJS.actions.image, onClick: fn }` really
// does replace the built-in Insert Image popup instead of being ignored.
//
// Any action with `label` renders a text button (.jotter-btn--text) instead of an icon.
//
// ACTIONS is the single source of truth for the catalogue: every toolbar — the
// default one, every preset, and any host-composed array — is built from these
// objects. Do not re-inline a descriptor anywhere else; add or edit it here.
//
// Each descriptor is frozen because presets share references with one another
// and with JotterJS.actions. Mutating one in place would leak across every
// preset and every editor instance, so hosts must spread-copy to customise:
//   { ...JotterJS.actions.image, onClick: fn }   ✓
//   JotterJS.actions.image.onClick = fn          ✗ throws (frozen)
// The builders only ever read descriptors, so sharing is otherwise safe.

const ACTIONS = {
  source:      { custom: 'toggleSource', label: 'Source', title: 'Edit HTML Source' },
  sep:         { type: 'sep' },
  blockformat: { type: 'blockformat' },
  fontfamily:  { type: 'fontfamily' },
  fontsize:    { type: 'fontsize' },
  theme:       { type: 'theme' },
  undo:        { cmd: 'undo',                 icon: 'undo',                  title: 'Undo (Ctrl+Z)'       },
  redo:        { cmd: 'redo',                 icon: 'redo',                  title: 'Redo (Ctrl+Y)'       },
  bold:        { cmd: 'bold',                 icon: 'format_bold',           title: 'Bold (Ctrl+B)'       },
  italic:      { cmd: 'italic',               icon: 'format_italic',         title: 'Italic (Ctrl+I)'     },
  underline:   { cmd: 'underline',            icon: 'format_underlined',     title: 'Underline (Ctrl+U)'  },
  strike:      { cmd: 'strikeThrough',        icon: 'strikethrough_s',       title: 'Strikethrough'       },
  subscript:   { cmd: 'subscript',            icon: 'subscript',             title: 'Subscript'           },
  superscript: { cmd: 'superscript',          icon: 'superscript',           title: 'Superscript'         },
  code:        { custom: 'code',              icon: 'code',                  title: 'Inline Code'         },
  copy:        { cmd: 'copy',                 icon: 'content_copy',          title: 'Copy'                },
  cut:         { cmd: 'cut',                  icon: 'content_cut',           title: 'Cut'                 },
  paste:       { cmd: 'paste',                icon: 'content_paste',         title: 'Paste'               },
  clearFormat: { cmd: 'removeFormat',         icon: 'format_clear',          title: 'Clear Formatting'    },
  alignLeft:   { cmd: 'justifyLeft',          icon: 'format_align_left',     title: 'Align Left'          },
  alignCenter: { cmd: 'justifyCenter',        icon: 'format_align_center',   title: 'Align Center'        },
  alignRight:  { cmd: 'justifyRight',         icon: 'format_align_right',    title: 'Align Right'         },
  bullets:     { cmd: 'insertUnorderedList',  icon: 'format_list_bulleted',  title: 'Bullet List'         },
  numbered:    { cmd: 'insertOrderedList',    icon: 'format_list_numbered',  title: 'Numbered List'       },
  link:        { type: 'popup', id: 'link',   icon: 'insert_link',           title: 'Insert Link'         },
  unlink:      { cmd: 'unlink',               icon: 'link_off',              title: 'Remove Link'         },
  foreColor:   { type: 'color', cmd: 'foreColor',   icon: 'format_color_text', title: 'Text Color'        },
  hiliteColor: { type: 'color', cmd: 'hiliteColor', icon: 'format_color_fill', title: 'Background Color'  },
  image:       { type: 'popup', id: 'image',        icon: 'image',             title: 'Insert Image'      },
  video:       { type: 'popup', id: 'video',        icon: 'smart_display',     title: 'Insert YouTube Video' },
  table:       { type: 'popup', id: 'table',        icon: 'table_chart',       title: 'Insert Table'      },
  embed:       { type: 'popup', id: 'embed',        icon: 'html',              title: 'Insert Embed'      },
  symbol:      { type: 'popup', id: 'symbol',       icon: 'emoji_symbols',     title: 'Insert Symbol'     },
  specialChar: { type: 'popup', id: 'specialchar',  icon: 'format_shapes',     title: 'Special Characters'},
  lorem:       { type: 'popup', id: 'lorem',        icon: 'history_edu',       title: 'Insert Lorem Ipsum'},
};

Object.values(ACTIONS).forEach(Object.freeze);
Object.freeze(ACTIONS);

const A = ACTIONS;

/**
 * Pre-built toolbar arrays, all composed from ACTIONS.
 *   minimal  — source + bold/italic/underline + link
 *   writing  — heading/formatting/lists/link/image
 *   full     — everything; the default toolbar
 * Frozen for the same reason the descriptors are: hosts extend by spreading,
 * e.g. [...JotterJS.presets.minimal, JotterJS.actions.sep, JotterJS.actions.image].
 */
const PRESETS = {
  minimal: [
    A.source, A.sep,
    A.bold, A.italic, A.underline, A.sep,
    A.link, A.unlink,
  ],
  writing: [
    A.source, A.sep,
    A.undo, A.redo, A.sep,
    A.blockformat, A.sep,
    A.bold, A.italic, A.underline, A.strike, A.sep,
    A.bullets, A.numbered, A.sep,
    A.link, A.unlink, A.sep,
    A.image,
  ],
  full: [
    A.source, A.sep,
    A.undo, A.redo, A.sep,
    A.copy, A.cut, A.paste, A.sep,
    A.clearFormat, A.sep,
    A.blockformat, A.fontfamily, A.fontsize, A.sep,
    A.bold, A.italic, A.underline, A.strike, A.subscript, A.superscript, A.code, A.sep,
    A.foreColor, A.hiliteColor, A.sep,
    A.alignLeft, A.alignCenter, A.alignRight, A.sep,
    A.bullets, A.numbered, A.sep,
    A.link, A.unlink, A.sep,
    A.image, A.video, A.table, A.embed, A.symbol, A.specialChar, A.lorem, A.sep,
    A.theme,
  ],
};

Object.values(PRESETS).forEach(Object.freeze);
Object.freeze(PRESETS);

const TOOLBAR_ACTIONS = PRESETS.full;

/**
 * Popup id → constructor option that replaces it. Present here means a host can
 * hand the whole interaction to its own UI; every other popup is built-in only.
 */
const RESOLVER_OPTIONS = {
  image: 'onRequestImage',
  link:  'onRequestLink',
  video: 'onRequestVideo',
  embed: 'onRequestEmbed',
};

const HEADING_OPTIONS = [
  { label: 'Paragraph',  tag: 'p'          },
  { label: 'Heading 1',  tag: 'h1'         },
  { label: 'Heading 2',  tag: 'h2'         },
  { label: 'Heading 3',  tag: 'h3'         },
  { label: 'Heading 4',  tag: 'h4'         },
  { label: 'Pre / Code', tag: 'pre'        },
  { label: 'Blockquote', tag: 'blockquote' },
];

const FONT_FAMILIES = [
  'Arial', 'Arial Black', 'Comic Sans MS', 'Courier New', 'Georgia',
  'Impact', 'Lucida Console', 'Palatino Linotype', 'Tahoma',
  'Times New Roman', 'Trebuchet MS', 'Verdana',
];

const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 72];

const SYMBOLS = [
  '←','→','↑','↓','↔','↕','⇐','⇒','⇑','⇓','⇔',
  '•','·','◦','○','●','□','■','◆','◇','▲','▼',
  '★','☆','♠','♣','♥','♦','✓','✗','✕','✘',
  '≈','≠','≡','≤','≥','÷','×','±','∞','√','∑',
  '∏','∫','∂','∆','∇','π','Ω','μ','α','β','γ',
  '©','®','™','§','¶','†','‡','°','′','″','‰',
  '\u201C','\u201D','\u2018','\u2019','«','»','‹','›','—','–','…',
  '¿','¡','€','£','¥','¢','₹','₽','₿',
];

const SPECIAL_CHARS = [
  'À','Á','Â','Ã','Ä','Å','Æ','Ç','È','É','Ê','Ë',
  'Ì','Í','Î','Ï','Ð','Ñ','Ò','Ó','Ô','Õ','Ö','Ø',
  'Ù','Ú','Û','Ü','Ý','Þ','ß','à','á','â','ã','ä',
  'å','æ','ç','è','é','ê','ë','ì','í','î','ï','ð',
  'ñ','ò','ó','ô','õ','ö','ø','ù','ú','û','ü','ý',
  'þ','ÿ','Œ','œ','Š','š','Ÿ','Ž','ž',
];

const THEMES = [
  { id: 'default', label: 'Default'      },
  { id: 'warm',    label: 'Warm'         },
  { id: 'ink',     label: 'Ink / Navy'   },
  { id: 'forest',  label: 'Forest'       },
];

const LOREM_VARIANTS = [
  {
    label: 'Short — 1 sentence',
    text: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.',
  },
  {
    label: 'Medium — 1 paragraph',
    text: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.',
  },
  {
    label: 'Long — 3 paragraphs',
    isHTML: true,
    text: '<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.</p><p>Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.</p><p>Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium, totam rem aperiam eaque ipsa quae ab illo inventore veritatis et quasi architecto beatae vitae dicta sunt explicabo.</p>',
  },
];

// ─── Class ────────────────────────────────────────────────────────────────────

class JotterJS {
  constructor(target, options = {}) {
    this._target = typeof target === 'string' ? document.querySelector(target) : target;
    if (!this._target) throw new Error('[JotterJS] Target element not found.');

    this._options = Object.assign({
      placeholder: 'Start typing…',
      height: '320px',
      theme: 'default',
      onChange: null,
      onFocus: null,
      onBlur: null,
      onRequestImage: null,
      onRequestLink: null,
      onRequestVideo: null,
      onRequestEmbed: null,
    }, options);

    this._listeners        = {};
    this._bookmarks        = new Map();  // token → { start, end } marker nodes
    this._bmSeq            = 0;
    this._savedBookmark    = null;       // caret held across a toolbar interaction
    this._externalBookmark = null;       // caret held across host UI (see beginExternalUI)
    this._externalDepth    = 0;
    this._changeCount      = 0;
    this._destroyed        = false;
    this._lastForeColor    = '#e8e4d8';
    this._lastHiliteColor  = '#c8a96e';
    this._init();
  }

  // ─── Init ─────────────────────────────────────────────────────────────────
  // Popup is appended to document.body (not the root) to escape overflow:hidden.
  // _savedBookmark holds the selection before any toolbar interaction steals
  // focus, so popup submit handlers can put it back via _restoreSavedBookmark().

  _init() {
    const initialHTML = this._target.innerHTML || '';
    this._target.innerHTML = '';
    this._target.classList.add('jotter-host');

    this._root = document.createElement('div');
    this._root.className = 'htmled';

    this._toolbar = this._buildToolbar();

    this._editorWrap = document.createElement('div');
    this._editorWrap.className = 'jotter-editor-wrap';

    this._editor = document.createElement('div');
    this._editor.className = 'jotter-editor';
    this._editor.contentEditable = 'true';
    this._editor.setAttribute('data-placeholder', this._options.placeholder);
    this._editor.style.minHeight = this._options.height;
    this._editor.innerHTML = this._sanitize(initialHTML);
    this._editor.spellcheck = true;
    document.execCommand('defaultParagraphSeparator', false, 'p');

    this._source = document.createElement('textarea');
    this._source.className = 'jotter-source';
    this._source.setAttribute('aria-label', 'HTML source');
    this._source.setAttribute('spellcheck', 'false');
    this._source.style.minHeight = this._options.height;
    this._sourceMode = false;

    this._statusBar = this._buildStatusBar();

    this._editorWrap.appendChild(this._editor);
    this._editorWrap.appendChild(this._source);
    this._root.appendChild(this._toolbar);
    this._root.appendChild(this._editorWrap);
    this._root.appendChild(this._statusBar);
    this._target.appendChild(this._root);

    // Popup lives on body to escape overflow:hidden
    this._popup = this._buildPopupContainer();
    document.body.appendChild(this._popup);

    this._bindEvents();
    this._updateToolbarState();
    this._updateStatus();
    this.setTheme(this._options.theme);
  }

  // ─── Toolbar ──────────────────────────────────────────────────────────────

  /** Renders options.toolbar (or TOOLBAR_ACTIONS) into .jotter-toolbar. */
  _buildToolbar() {
    const bar = document.createElement('div');
    bar.className = 'jotter-toolbar';
    this._toolbarEl = bar;
    (this._options.toolbar || TOOLBAR_ACTIONS).forEach(action => {
      const el = this._buildAction(action);
      if (el) bar.appendChild(el);
    });
    return bar;
  }

  /**
   * Dispatches an action descriptor to the appropriate builder.
   * `onClick` is checked before `type` so a host can override any built-in —
   * popup actions included — with `{ ...JotterJS.actions.image, onClick: fn }`.
   */
  _buildAction(action) {
    if (typeof action.onClick === 'function') return this._buildBtn(action);

    switch (action.type) {
      case 'sep':         return this._makeSep();
      case 'blockformat': return this._buildBlockFormatSelect();
      case 'fontfamily':  return this._buildFontFamilySelect();
      case 'fontsize':    return this._buildFontSizeSelect();
      case 'color':       return this._buildColorBtn(action);
      case 'popup':       return this._buildPopupBtn(action);
      case 'theme':       return this._buildThemeSelect();
      default:            return this._buildBtn(action);
    }
  }

  _makeSep() {
    const s = document.createElement('span');
    s.className = 'jotter-sep';
    return s;
  }

  // ─── Activation ───────────────────────────────────────────────────────────
  // Every toolbar control activates through _bindActivation, so the mouse and
  // the keyboard always run the same body. Binding them separately is what let
  // the keyboard rot: the pointer path grew a selection save/restore dance the
  // key path never had, and a focused button did nothing at all.

  /**
   * Binds a control's activation to the pointer *and* the keyboard.
   *
   * The pointer path has to run on `mousedown` with the default prevented —
   * that is what keeps the caret inside the contenteditable instead of letting
   * focus jump to the button before the command runs. A focused button has no
   * such problem, so the key path just calls the same `run()`.
   *
   * preventDefault() on the keydown does double duty: Space no longer scrolls
   * the page, and the browser no longer synthesises the click it derives from a
   * key press — so one activation stays one activation, here and for anything
   * else listening further down. Auto-repeat is dropped for the same reason.
   *
   * @param {Element}  el
   * @param {Function} run  Receives true when the activation came from the keyboard.
   */
  _bindActivation(el, run) {
    el.addEventListener('mousedown', e => {
      e.preventDefault();
      run(false);
    });
    el.addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
      if (e.repeat) return;
      e.preventDefault();
      run(true);
    });
  }

  /**
   * Hands focus back to a control after a keyboard activation, so the user
   * keeps their place on the toolbar instead of being dropped into the editor
   * on every keystroke. The pointer path never moved focus off the editor in
   * the first place, so it is left alone.
   *
   * Skipped when something outside the editor's own chrome has taken focus —
   * a host modal opened from an `onClick`, say — since stealing it back would
   * break that UI.
   */
  _returnFocus(el, viaKeyboard) {
    if (viaKeyboard && this._isInternalTarget(document.activeElement)) el.focus();
  }

  /**
   * General button builder. Priority order for click handling:
   *   1. action.onClick(editor)   — external callback
   *   2. action.custom            — internal method ('toggleSource' | 'code')
   *   3. action.cmd               — document.execCommand
   *   4. action.prompt            — prompt() then execCommand (legacy fallback)
   */
  _buildBtn(action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'jotter-btn';
    if (action.cmd)    btn.dataset.cmd    = action.cmd;
    if (action.custom) btn.dataset.custom = action.custom;
    btn.title = action.title;
    btn.setAttribute('aria-label', action.title);

    if (action.label) {
      btn.classList.add('jotter-btn--text');
      btn.appendChild(document.createTextNode(action.label));
    } else {
      const icon = document.createElement('span');
      icon.className = 'material-icons';
      icon.textContent = action.icon;
      btn.appendChild(icon);
    }

    this._bindActivation(btn, viaKeyboard => {
      this._editor.focus();

      this._applyEdit(() => {
        if (action.onClick) {
          action.onClick(this);
        } else if (action.custom === 'toggleSource') {
          this._toggleSourceMode();
        } else if (action.custom === 'code') {
          this._toggleInlineCode();
        } else if (action.cmd === 'copy') {
          document.execCommand('copy');
        } else if (action.cmd === 'cut') {
          document.execCommand('cut');
        } else if (action.cmd === 'paste') {
          this._pasteFromClipboard();
        } else if (action.prompt) {
          const val = window.prompt(action.prompt);
          if (val) document.execCommand(action.cmd, false, val);
        } else {
          document.execCommand(action.cmd, false, null);
        }
      });

      this._updateToolbarState();
      this._returnFocus(btn, viaKeyboard);
    });

    return btn;
  }

  /**
   * Keeps the caret bookmarked for a select, whichever way the user drives it.
   * By mouse the bookmark has to be taken on `mousedown`, before focus leaves
   * the editable; by keyboard the value can change on the very first arrow
   * press, so the keydown has to take one too.
   *
   * Returns a state object the `change` handler reads to decide where focus
   * belongs afterwards: back on the select for a keyboard user still walking
   * the options, in the editor for a mouse user who has finished picking.
   */
  _bindSelectCaret(sel) {
    const state = { viaKeyboard: false };
    sel.addEventListener('mousedown', () => {
      state.viaKeyboard = false;
      this._saveBookmark();
    });
    sel.addEventListener('keydown', e => {
      if (e.key === 'Tab' || e.key === 'Escape') return;
      state.viaKeyboard = true;
      // Not _saveBookmark: once the select has focus a re-read can come back
      // empty, and overwriting a good bookmark with nothing loses the caret.
      if (this._savedBookmark == null) this._saveBookmark();
    });
    return state;
  }

  _buildBlockFormatSelect() {
    const sel = document.createElement('select');
    sel.className = 'jotter-select';
    sel.title = 'Block format';
    sel.dataset.id = 'blockformat';
    HEADING_OPTIONS.forEach(({ label, tag }) => {
      const opt = document.createElement('option');
      opt.value = tag;
      opt.textContent = label;
      sel.appendChild(opt);
    });
    const caret = this._bindSelectCaret(sel);
    sel.addEventListener('change', () => {
      this._restoreSavedBookmark();
      this._applyEdit(() => document.execCommand('formatBlock', false, sel.value));
      this._returnFocus(sel, caret.viaKeyboard);
    });
    return sel;
  }

  _buildFontFamilySelect() {
    const sel = document.createElement('select');
    sel.className = 'jotter-select jotter-select--font';
    sel.title = 'Font family';
    sel.dataset.id = 'fontfamily';
    const def = document.createElement('option');
    def.value = '';
    def.textContent = 'Font';
    sel.appendChild(def);
    FONT_FAMILIES.forEach(f => {
      const opt = document.createElement('option');
      opt.value = f;
      opt.textContent = f;
      opt.style.fontFamily = f;
      sel.appendChild(opt);
    });
    const caret = this._bindSelectCaret(sel);
    sel.addEventListener('change', () => {
      if (!sel.value) return;
      this._restoreSavedBookmark();
      this._applyEdit(() => document.execCommand('fontName', false, sel.value));
      this._returnFocus(sel, caret.viaKeyboard);
    });
    return sel;
  }

  _buildFontSizeSelect() {
    const sel = document.createElement('select');
    sel.className = 'jotter-select jotter-select--size';
    sel.title = 'Font size';
    sel.dataset.id = 'fontsize';
    const def = document.createElement('option');
    def.value = '';
    def.textContent = 'Size';
    sel.appendChild(def);
    FONT_SIZES.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s;
      opt.textContent = `${s}px`;
      sel.appendChild(opt);
    });
    const caret = this._bindSelectCaret(sel);
    sel.addEventListener('change', () => {
      if (!sel.value) return;
      this._restoreSavedBookmark();
      this._applyEdit(() => this._applyFontSize(sel.value));
      this._returnFocus(sel, caret.viaKeyboard);
    });
    return sel;
  }

  _buildThemeSelect() {
    const sel = document.createElement('select');
    sel.className = 'jotter-select jotter-select--theme';
    sel.title = 'Editor theme';
    sel.dataset.id = 'theme';
    THEMES.forEach(({ id, label }) => {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = label;
      sel.appendChild(opt);
    });
    sel.value = this._options.theme;
    sel.addEventListener('change', () => this.setTheme(sel.value));
    this._themeSelect = sel;
    return sel;
  }

  _buildColorBtn(action) {
    const wrap = document.createElement('span');
    wrap.className = 'jotter-color-wrap';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'jotter-btn jotter-color-btn';
    btn.dataset.cmd = action.cmd;
    btn.title = action.title;
    btn.setAttribute('aria-label', action.title);

    const icon = document.createElement('span');
    icon.className = 'material-icons';
    icon.textContent = action.icon;
    btn.appendChild(icon);

    const swatch = document.createElement('span');
    swatch.className = 'jotter-color-swatch';
    const defaultColor = action.cmd === 'foreColor' ? this._lastForeColor : this._lastHiliteColor;
    swatch.style.background = defaultColor;
    btn.appendChild(swatch);

    const input = document.createElement('input');
    input.type = 'color';
    input.className = 'jotter-color-input';
    input.value = defaultColor;
    input.tabIndex = -1;

    // The native colour dialog is opened by the button, not entered as a tab
    // stop, so which way the button was activated has to be remembered until
    // the dialog comes back with a value.
    let viaKeyboard = false;

    input.addEventListener('change', () => {
      const color = input.value;
      swatch.style.background = color;
      if (action.cmd === 'foreColor') this._lastForeColor = color;
      else this._lastHiliteColor = color;
      this._restoreSavedBookmark();
      this._applyEdit(() => document.execCommand(action.cmd, false, color));
      this._returnFocus(btn, viaKeyboard);
    });

    this._bindActivation(btn, fromKeyboard => {
      viaKeyboard = fromKeyboard;
      this._saveBookmark();
      input.click();
    });

    wrap.appendChild(btn);
    wrap.appendChild(input);
    return wrap;
  }

  // ─── Popup system ─────────────────────────────────────────────────────────
  // Single _popup element on document.body; toggled via _showPopup / _hidePopup.
  // Clicking the same button again dismisses the popup (toggle).
  // Outside-click and Escape both close it (see _bindEvents).
  // A popup whose id has an onRequest* hook is never built: the button hands
  // over to the host resolver instead (see _runResolver).

  _buildPopupBtn(action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'jotter-btn';
    btn.title = action.title;
    btn.setAttribute('aria-label', action.title);

    const icon = document.createElement('span');
    icon.className = 'material-icons';
    icon.textContent = action.icon;
    btn.appendChild(icon);

    this._bindActivation(btn, viaKeyboard => {
      const resolver = this._resolverFor(action.id);
      if (resolver) {
        this._hidePopup();
        this._runResolver(action.id, resolver);
        return;
      }

      this._saveBookmark();

      if (this._popupVisible() && this._popup.dataset.popupId === action.id) {
        this._hidePopup();
        return;
      }

      this._showPopup(btn, this._buildPopupContent(action.id), action.id);
      if (viaKeyboard) this._focusPopup();
    });

    return btn;
  }

  /**
   * Moves focus into a popup that was opened from the keyboard. The popup lives
   * on document.body, a whole document away from the button that opened it, so
   * without this the fields the user just asked for would be unreachable
   * without tabbing through the rest of the page.
   */
  _focusPopup() {
    const el = this._popup.querySelector(
      'input, textarea, select, button, [tabindex]:not([tabindex="-1"])');
    if (el) el.focus();
  }

  _buildPopupContainer() {
    const el = document.createElement('div');
    el.className = 'jotter-popup';
    el.setAttribute('role', 'dialog');
    return el;
  }

  _showPopup(anchor, content, id) {
    this._popup.innerHTML = '';
    this._popup.appendChild(content);
    this._popup.dataset.popupId = id;
    this._popup.classList.add('jotter-popup--visible');

    const r = anchor.getBoundingClientRect();
    this._popup.style.top  = (r.bottom + 6) + 'px';
    this._popup.style.left = r.left + 'px';
    this._popup.style.right = 'auto';

    // Clamp to viewport right edge after paint so popup width is known
    requestAnimationFrame(() => {
      const pr = this._popup.getBoundingClientRect();
      if (pr.right > window.innerWidth - 8) {
        this._popup.style.left = Math.max(8, r.left - (pr.right - window.innerWidth + 8)) + 'px';
      }
    });
  }

  _popupVisible() {
    return this._popup.classList.contains('jotter-popup--visible');
  }

  /** Hides the popup and drops the caret bookmark it was holding (no-op if already consumed). */
  _hidePopup() {
    this._popup.classList.remove('jotter-popup--visible');
    this._popup.dataset.popupId = '';
    this._releaseSavedBookmark();
  }

  /** Returns the DOM subtree for the popup identified by id. */
  _buildPopupContent(id) {
    switch (id) {
      case 'link':        return this._popupLink();
      case 'table':       return this._popupTable();
      case 'image':       return this._popupImage();
      case 'video':       return this._popupVideo();
      case 'embed':       return this._popupEmbed();
      case 'symbol':      return this._popupSymbol();
      case 'specialchar': return this._popupSpecialChar();
      case 'lorem':       return this._popupLorem();
      default: {
        const d = document.createElement('div');
        d.className = 'jotter-popup-inner';
        d.textContent = 'Unknown: ' + id;
        return d;
      }
    }
  }

  /**
   * Size picker (up to 8×10) inserting a <table> with a <th> header row.
   * Pointer: hover sizes it, click inserts. Keyboard: the grid is a single tab
   * stop (roving tabindex), arrows size it and Enter/Space inserts — 80 tab
   * stops would be worse than no keyboard support at all.
   */
  _popupTable() {
    const wrap = document.createElement('div');
    wrap.className = 'jotter-popup-inner';

    const title = this._popupTitle('Insert Table');
    wrap.appendChild(title);

    const COLS = 10, ROWS = 8;
    const grid = document.createElement('div');
    grid.className = 'jotter-table-grid';
    grid.style.gridTemplateColumns = `repeat(${COLS}, 1fr)`;
    grid.setAttribute('role', 'grid');
    grid.setAttribute('aria-label', 'Table size');

    const hint = document.createElement('div');
    hint.className = 'jotter-popup-hint';
    hint.textContent = 'Hover or arrow to select size';

    const cells = [];
    const preview = (r, c) => {
      hint.textContent = `${r + 1} × ${c + 1} table`;
      cells.forEach(cl => {
        cl.classList.toggle('jotter-table-cell--active',
          +cl.dataset.r <= r && +cl.dataset.c <= c);
      });
    };

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const cell = document.createElement('span');
        cell.className = 'jotter-table-cell';
        cell.dataset.r = r;
        cell.dataset.c = c;
        cell.setAttribute('role', 'gridcell');
        cell.setAttribute('aria-label', `${r + 1} by ${c + 1} table`);
        cell.tabIndex = (r === 0 && c === 0) ? 0 : -1;

        cell.addEventListener('mouseenter', () => preview(r, c));
        cell.addEventListener('focus', () => preview(r, c));
        cell.addEventListener('click', () => this._insertTable(r + 1, c + 1));

        cells.push(cell);
        grid.appendChild(cell);
      }
    }

    const STEP = { ArrowRight: [0, 1], ArrowLeft: [0, -1], ArrowDown: [1, 0], ArrowUp: [-1, 0] };
    grid.addEventListener('keydown', e => {
      const cell = cells.indexOf(document.activeElement) === -1 ? null : document.activeElement;
      if (!cell) return;
      const r = +cell.dataset.r, c = +cell.dataset.c;

      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        this._insertTable(r + 1, c + 1);
        return;
      }

      const step = STEP[e.key];
      if (!step) return;
      e.preventDefault();
      const nr = Math.min(ROWS - 1, Math.max(0, r + step[0]));
      const nc = Math.min(COLS - 1, Math.max(0, c + step[1]));
      const next = cells[nr * COLS + nc];
      if (next === cell) return;
      cell.tabIndex = -1;
      next.tabIndex = 0;
      next.focus();
    });

    wrap.appendChild(grid);
    wrap.appendChild(hint);
    return wrap;
  }

  /**
   * Completes a popup interaction: caret back where it was, popup closed, edit
   * applied. The popup goes away before the change is announced, so a host that
   * re-renders on change never remounts the editor with its popup still open.
   */
  _commitPopup(fn) {
    this._restoreSavedBookmark();
    this._hidePopup();
    this._applyEdit(fn);
  }

  _insertTable(rows, cols) {
    let html = '<table><tbody>';
    for (let r = 0; r < rows; r++) {
      html += '<tr>';
      for (let c = 0; c < cols; c++) {
        html += r === 0 ? '<th><br></th>' : '<td><br></td>';
      }
      html += '</tr>';
    }
    html += '</tbody></table><p><br></p>';
    this._commitPopup(() => document.execCommand('insertHTML', false, html));
  }

  /**
   * Fields: URL, link text, title/tooltip, target.
   * Pre-fills from existing <a> under caret (edit mode) or current selection (text mode).
   * Edit mode mutates the anchor in-place; insert mode uses execCommand('insertHTML').
   */
  _popupLink() {
    const wrap = document.createElement('div');
    wrap.className = 'jotter-popup-inner jotter-popup-form';
    wrap.appendChild(this._popupTitle('Insert Link'));

    const existingAnchor = this._anchorInSelection();
    const selectedText   = this._selectedText();

    const urlInput    = this._makeField(wrap, 'URL', 'url', 'https://');
    const textInput   = this._makeField(wrap, 'Link text (leave blank to keep selection)', 'text', '');
    const titleInput  = this._makeField(wrap, 'Title / tooltip', 'text', '');

    const targetLabel = document.createElement('label');
    targetLabel.className = 'jotter-popup-label';
    targetLabel.textContent = 'Open in';
    const targetSel = document.createElement('select');
    targetSel.className = 'jotter-popup-select';
    [['(same window)', ''], ['New tab (_blank)', '_blank'], ['Parent frame (_parent)', '_parent'], ['Top frame (_top)', '_top']].forEach(([text, val]) => {
      const o = document.createElement('option');
      o.value = val; o.textContent = text;
      targetSel.appendChild(o);
    });
    wrap.appendChild(targetLabel);
    wrap.appendChild(targetSel);

    if (existingAnchor) {
      urlInput.value    = existingAnchor.getAttribute('href') || '';
      textInput.value   = existingAnchor.textContent || '';
      titleInput.value  = existingAnchor.getAttribute('title') || '';
      targetSel.value   = existingAnchor.getAttribute('target') || '';
    } else if (selectedText) {
      textInput.value = selectedText;
    }

    wrap.appendChild(this._makeSubmitBtn(existingAnchor ? 'Update Link' : 'Insert Link', () => {
      const href = urlInput.value.trim();
      if (!href) return;
      const text   = textInput.value.trim() || selectedText || href;
      const title  = titleInput.value.trim();
      const target = targetSel.value;
      this._commitPopup(() => {
        if (existingAnchor) {
          existingAnchor.href = href;
          if (target) existingAnchor.target = target; else existingAnchor.removeAttribute('target');
          if (title)  existingAnchor.title = title;  else existingAnchor.removeAttribute('title');
          existingAnchor.textContent = text;
        } else {
          document.execCommand('insertHTML', false, this._linkHTML({ href, text, title, target }));
        }
      });
    }));

    return wrap;
  }

  /** Fields: URL, alt text, width. Inserts <img> via execCommand('insertHTML'). */
  _popupImage() {
    const wrap = document.createElement('div');
    wrap.className = 'jotter-popup-inner jotter-popup-form';
    wrap.appendChild(this._popupTitle('Insert Image'));

    const urlInput = this._makeField(wrap, 'Image URL', 'text', 'https://example.com/image.jpg');
    const altInput = this._makeField(wrap, 'Alt text', 'text', 'Descriptive text');
    const widthInput = this._makeField(wrap, 'Width (e.g. 400px or 50%)', 'text', '');

    wrap.appendChild(this._makeSubmitBtn('Insert Image', () => {
      const src = urlInput.value.trim();
      if (!src) return;
      const html = this._imageHTML({ src, alt: altInput.value.trim(), width: widthInput.value.trim() });
      this._commitPopup(() => document.execCommand('insertHTML', false, html));
    }));

    return wrap;
  }

  /** Accepts any youtube.com or youtu.be URL; extracts 11-char video ID via _ytId(). */
  _popupVideo() {
    const wrap = document.createElement('div');
    wrap.className = 'jotter-popup-inner jotter-popup-form';
    wrap.appendChild(this._popupTitle('Insert YouTube Video'));

    const urlInput = this._makeField(wrap, 'YouTube URL', 'text', 'https://www.youtube.com/watch?v=...');

    wrap.appendChild(this._makeSubmitBtn('Embed Video', () => {
      const id = this._ytId(urlInput.value.trim());
      if (!id) { urlInput.classList.add('jotter-input--error'); return; }
      urlInput.classList.remove('jotter-input--error');
      this._commitPopup(() => document.execCommand('insertHTML', false, this._videoHTML(id)));
    }));

    return wrap;
  }

  _ytId(url) {
    for (const re of [/[?&]v=([A-Za-z0-9_-]{11})/, /youtu\.be\/([A-Za-z0-9_-]{11})/, /embed\/([A-Za-z0-9_-]{11})/]) {
      const m = url.match(re);
      if (m) return m[1];
    }
    return null;
  }

  /** Pastes raw HTML/embed code directly; no sanitization (user-supplied trusted content). */
  _popupEmbed() {
    const wrap = document.createElement('div');
    wrap.className = 'jotter-popup-inner jotter-popup-form';
    wrap.appendChild(this._popupTitle('Insert Embed'));

    const label = document.createElement('label');
    label.className = 'jotter-popup-label';
    label.textContent = 'Paste HTML / embed code';
    const ta = document.createElement('textarea');
    ta.className = 'jotter-popup-textarea';
    ta.placeholder = '<iframe src="..." ...></iframe>';
    ta.rows = 4;
    wrap.appendChild(label);
    wrap.appendChild(ta);

    wrap.appendChild(this._makeSubmitBtn('Insert', () => {
      const html = ta.value.trim();
      if (!html) return;
      this._commitPopup(() => document.execCommand('insertHTML', false, this._embedHTML(html)));
    }));

    return wrap;
  }

  /** Renders SYMBOLS array as a clickable character grid. */
  _popupSymbol() {
    const wrap = document.createElement('div');
    wrap.className = 'jotter-popup-inner';
    wrap.appendChild(this._popupTitle('Insert Symbol'));
    wrap.appendChild(this._charGrid(SYMBOLS));
    return wrap;
  }

  /** Renders SPECIAL_CHARS (accented/extended Latin) as a clickable character grid. */
  _popupSpecialChar() {
    const wrap = document.createElement('div');
    wrap.className = 'jotter-popup-inner';
    wrap.appendChild(this._popupTitle('Special Characters'));
    wrap.appendChild(this._charGrid(SPECIAL_CHARS));
    return wrap;
  }

  _charGrid(chars) {
    const grid = document.createElement('div');
    grid.className = 'jotter-char-grid';
    chars.forEach(ch => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'jotter-char-btn';
      btn.textContent = ch;
      btn.title = `U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`;
      this._bindActivation(btn, () => {
        this._commitPopup(() => document.execCommand('insertText', false, ch));
      });
      grid.appendChild(btn);
    });
    return grid;
  }

  /** Three variants (short/medium/long); long variant inserts as HTML paragraphs. */
  _popupLorem() {
    const wrap = document.createElement('div');
    wrap.className = 'jotter-popup-inner';
    wrap.appendChild(this._popupTitle('Insert Lorem Ipsum'));
    LOREM_VARIANTS.forEach(v => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'jotter-lorem-btn';
      btn.textContent = v.label;
      this._bindActivation(btn, () => {
        this._commitPopup(() => document.execCommand(
          v.isHTML ? 'insertHTML' : 'insertText', false, v.text));
      });
      wrap.appendChild(btn);
    });
    return wrap;
  }

  // ─── Popup helpers ────────────────────────────────────────────────────────

  /** Creates a .jotter-popup-title heading element. */
  _popupTitle(text) {
    const el = document.createElement('div');
    el.className = 'jotter-popup-title';
    el.textContent = text;
    return el;
  }

  /** Appends a label+input pair to parent; returns the input element. */
  _makeField(parent, labelText, type, placeholder) {
    const label = document.createElement('label');
    label.className = 'jotter-popup-label';
    label.textContent = labelText;
    const input = document.createElement('input');
    input.type = type;
    input.className = 'jotter-popup-input';
    input.placeholder = placeholder;
    parent.appendChild(label);
    parent.appendChild(input);
    return input;
  }

  _makeSubmitBtn(text, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'jotter-popup-submit';
    btn.textContent = text;
    btn.addEventListener('click', onClick);
    return btn;
  }

  /** Escapes ", <, > for safe insertion into HTML attribute values and text. */
  _esc(s) {
    return String(s).replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ─── Insertion markup ─────────────────────────────────────────────────────
  // Single source of truth for what each insertable looks like. The built-in
  // popups and the onRequest* resolver hooks both go through these, so host UI
  // produces byte-identical markup to the popup it replaced.

  _imageHTML({ src, alt, width }) {
    const style = width ? `max-width:${width}` : 'max-width:100%';
    return `<img src="${this._esc(src)}" alt="${this._esc(alt || '')}" style="${this._esc(style)}">`;
  }

  _linkHTML({ href, text, title, target }) {
    let attrs = `href="${this._esc(href)}"`;
    if (target) attrs += ` target="${this._esc(target)}"`;
    if (title)  attrs += ` title="${this._esc(title)}"`;
    return `<a ${attrs}>${this._esc(text || href)}</a>`;
  }

  /** @param {string} id  An 11-char YouTube id — anything else yields null. */
  _videoHTML(id) {
    if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return null;
    return `<div class="jotter-video-wrap"><iframe src="https://www.youtube.com/embed/${id}" frameborder="0" allowfullscreen loading="lazy" title="YouTube video"></iframe></div><p><br></p>`;
  }

  /** Embeds are inserted verbatim — the host, not the end user, supplies them. */
  _embedHTML(html) {
    return html + '<p><br></p>';
  }

  // ─── Resolver hooks ───────────────────────────────────────────────────────
  // An onRequest* option replaces the built-in popup for that insertable. The
  // editor still owns the caret bookmark, the blur suppression, the markup and
  // the change emit; the host only answers "which image / link / video / embed?".

  _resolverFor(id) {
    const key = RESOLVER_OPTIONS[id];
    const fn  = key ? this._options[key] : null;
    return typeof fn === 'function' ? fn : null;
  }

  /**
   * Bookmarks the caret, awaits the host, then inserts at the bookmark.
   * A null/false/throwing result means cancelled — the caret still comes back.
   */
  async _runResolver(id, resolver) {
    const ctx = this._resolverContext(id);
    this.beginExternalUI();

    let result = null;
    try {
      result = await resolver(ctx);
    } catch (_) {
      result = null;
    }
    if (this._destroyed) return;

    const html = (result === null || result === undefined || result === false)
      ? null
      : this._resolvedHTML(id, result, ctx);

    this.endExternalUI();
    if (!html) return;

    this._applyEdit(() => document.execCommand('insertHTML', false, html));
    this._updateToolbarState();
  }

  /** Current values handed to the resolver, mirroring the popup's pre-filled fields. */
  _resolverContext(id) {
    switch (id) {
      case 'image': return { src: '', alt: '', width: '', selection: this._selectedText() };
      case 'video': return { url: '', selection: this._selectedText() };
      case 'embed': return { html: '', selection: this._selectedText() };
      case 'link':  return this._linkContext();
      default:      return { selection: this._selectedText() };
    }
  }

  /**
   * Link context doubles as edit mode: when the caret sits in an <a>, the whole
   * anchor is selected first so whatever the host returns replaces it — the same
   * outcome as the popup's in-place mutation, but robust to the host re-rendering.
   */
  _linkContext() {
    const anchor = this._anchorInSelection();
    if (!anchor) {
      const text = this._selectedText();
      return { href: '', text, title: '', target: '', selection: text, isEdit: false };
    }

    const sel = window.getSelection();
    if (sel) {
      const r = document.createRange();
      r.selectNode(anchor);
      sel.removeAllRanges();
      sel.addRange(r);
    }
    return {
      href:      anchor.getAttribute('href')   || '',
      text:      anchor.textContent            || '',
      title:     anchor.getAttribute('title')  || '',
      target:    anchor.getAttribute('target') || '',
      selection: anchor.textContent            || '',
      isEdit:    true,
    };
  }

  /** Normalises a resolver result (object or bare string) into insertable HTML. */
  _resolvedHTML(id, result, ctx) {
    switch (id) {
      case 'image': {
        const r   = typeof result === 'string' ? { src: result } : result;
        const src = String(r.src || r.url || '').trim();
        return src ? this._imageHTML({ ...r, src }) : null;
      }
      case 'link': {
        const r    = typeof result === 'string' ? { href: result } : result;
        const href = String(r.href || r.url || '').trim();
        if (!href) return null;
        const text = String(r.text != null ? r.text : (ctx.text || '')).trim();
        return this._linkHTML({ ...r, href, text });
      }
      case 'video': {
        const r  = typeof result === 'string' ? { url: result } : result;
        const id = r.id ? String(r.id).trim() : this._ytId(String(r.url || '').trim());
        return id ? this._videoHTML(id) : null;
      }
      case 'embed': {
        const html = String(typeof result === 'string' ? result : (result.html || '')).trim();
        return html ? this._embedHTML(html) : null;
      }
      default:
        return null;
    }
  }

  /** Text of the current selection, '' when it is collapsed or outside the editor. */
  _selectedText() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return '';
    return this._editor.contains(sel.getRangeAt(0).commonAncestorContainer) ? sel.toString() : '';
  }

  /** Nearest <a> ancestor of the caret, or null when the caret is elsewhere. */
  _anchorInSelection() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    let node = sel.anchorNode;
    if (!node || !this._editor.contains(node)) return null;
    while (node && node !== this._editor) {
      if (node.nodeName === 'A') return node;
      node = node.parentNode;
    }
    return null;
  }

  // ─── Status bar ───────────────────────────────────────────────────────────

  _buildStatusBar() {
    const bar = document.createElement('div');
    bar.className = 'jotter-status';

    this._wordCountEl = document.createElement('span');
    this._wordCountEl.className = 'jotter-status-words';

    this._charCountEl = document.createElement('span');
    this._charCountEl.className = 'jotter-status-chars';

    const modeEl = document.createElement('span');
    modeEl.className = 'jotter-status-mode';
    modeEl.textContent = 'HTML';

    bar.appendChild(this._wordCountEl);
    bar.appendChild(this._charCountEl);
    bar.appendChild(modeEl);
    return bar;
  }

  // ─── Events ───────────────────────────────────────────────────────────────

  _bindEvents() {
    this._editor.addEventListener('input', () => {
      // Normalize the bare <div>s browsers insert on Enter into <p> to enforce
      // paragraph semantics. Only touch attribute-less divs — a div carrying
      // style/class/etc. is intentional layout content and must be preserved.
      this._editor.querySelectorAll(':scope > div').forEach(d => {
        if (d.attributes.length > 0) return;
        const p = document.createElement('p');
        p.innerHTML = d.innerHTML;
        d.replaceWith(p);
      });
      // Wrap bare top-level text nodes in <p>, preserving caret position
      Array.from(this._editor.childNodes).forEach(node => {
        if (node.nodeType === Node.TEXT_NODE && node.textContent.trim() !== '') {
          const sel = window.getSelection();
          let caretOffset = null;
          if (sel && sel.rangeCount) {
            const r = sel.getRangeAt(0);
            if (r.startContainer === node) caretOffset = r.startOffset;
          }
          const p = document.createElement('p');
          node.replaceWith(p);
          p.appendChild(node);
          if (caretOffset !== null) {
            const r = document.createRange();
            r.setStart(node, caretOffset);
            r.collapse(true);
            sel.removeAllRanges();
            sel.addRange(r);
          }
        }
      });
      this._updateStatus();
      this._emitChange();
    });

    this._editor.addEventListener('keyup',   () => this._updateToolbarState());
    this._editor.addEventListener('mouseup', () => this._updateToolbarState());

    // focusin/focusout rather than focus/blur: they carry relatedTarget, which is
    // what tells "the user left the editor" apart from "the user moved into the
    // editor's own chrome". The popup lives on document.body, so clicking its URL
    // field blurs the contenteditable — hosts that save on blur would then
    // re-render and remount the editor out from under their own open popup.
    this._editor.addEventListener('focusin', e => {
      this._root.classList.add('jotter--focused');
      if (this._externalDepth > 0) return;          // caret restored by endExternalUI
      if (this._isInternalTarget(e.relatedTarget)) return;
      this._emit('focus');
      if (this._options.onFocus) this._options.onFocus();
    });

    this._editor.addEventListener('focusout', e => {
      if (this._externalDepth > 0) return;          // host UI has the floor
      if (this._isInternalTarget(e.relatedTarget)) return;
      // relatedTarget is null whenever focus lands on something unfocusable —
      // popup chrome, a label, the page background — so settle a tick and look
      // at where focus actually ended up before declaring a blur.
      setTimeout(() => {
        if (this._destroyed || this._externalDepth > 0) return;
        if (this._isInternalTarget(document.activeElement)) return;
        if (this._popupVisible()) return;
        this._root.classList.remove('jotter--focused');
        this._emit('blur');
        if (this._options.onBlur) this._options.onBlur();
      }, 0);
    });

    this._editor.addEventListener('keydown', e => {
      if (e.key === 'Tab') {
        e.preventDefault();
        document.execCommand('insertHTML', false, '&nbsp;&nbsp;&nbsp;&nbsp;');
      }
    });

    // Close popup on outside click — the caret bookmark goes with it, since the
    // click has already moved the caret somewhere the user chose.
    this._onDocMouseDown = e => {
      if (this._popupVisible() &&
          !this._popup.contains(e.target) &&
          !this._toolbarEl.contains(e.target)) {
        this._hidePopup();
      }
    };
    document.addEventListener('mousedown', this._onDocMouseDown);

    // Close popup on Escape, putting the caret back where it was
    this._onDocKeyDown = e => {
      if (e.key === 'Escape' && this._popupVisible()) {
        this._restoreSavedBookmark();
        this._hidePopup();
      }
    };
    document.addEventListener('keydown', this._onDocKeyDown);
  }

  /** True when a node lives inside the editor's own chrome (root or body-level popup). */
  _isInternalTarget(node) {
    return !!node && (this._root.contains(node) || this._popup.contains(node));
  }

  // ─── Custom commands ──────────────────────────────────────────────────────

  /**
   * Toggles between rich-text (contenteditable) and raw HTML (textarea) views.
   * Entering source mode: pretty-prints innerHTML into the textarea.
   * Leaving source mode: sanitizes textarea value back into innerHTML.
   */
  _toggleSourceMode() {
    this._sourceMode = !this._sourceMode;

    if (this._sourceMode) {
      // Outstanding bookmarks cannot survive the round-trip through the textarea.
      this._dropBookmarks();
      this._source.value = this._prettyHTML(this._richHTML());
      this._editor.style.display = 'none';
      this._source.style.display = 'block';
    } else {
      this._editor.innerHTML = this._sanitize(this._source.value);
      this._source.style.display = 'none';
      this._editor.style.display = '';
      this._updateStatus();
      this._emitChange();
    }

    this._root.classList.toggle('jotter--source-mode', this._sourceMode);

    const btn = this._toolbarEl.querySelector('[data-custom="toggleSource"]');
    if (btn) btn.classList.toggle('jotter-btn--active', this._sourceMode);
  }

  /**
   * Minimal HTML formatter for source-mode display.
   * Algorithm: collapse inter-tag whitespace → split on tag boundaries →
   * track indent depth, skipping void and inline elements.
   */
  _prettyHTML(html) {
    let indent = 0;
    const INDENT = '  ';
    const VOID = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
    const INLINE = new Set(['a','abbr','acronym','b','bdo','big','br','button','cite','code','dfn','em','i','img','input','kbd','label','map','object','output','q','samp','select','small','span','strong','sub','sup','textarea','time','tt','u','var']);

    return html
      .replace(/>\s+</g, '><')
      .replace(/(<[^>]+>)/g, '\n$1\n')
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .map(line => {
        const closeMatch  = line.match(/^<\/(\w+)/);
        const openMatch   = line.match(/^<(\w+)/);
        const selfClose   = line.endsWith('/>');
        const tag         = openMatch ? openMatch[1].toLowerCase() : null;
        const closeTag    = closeMatch ? closeMatch[1].toLowerCase() : null;

        if (closeTag && !INLINE.has(closeTag)) indent = Math.max(0, indent - 1);
        const out = INDENT.repeat(indent) + line;
        if (tag && !selfClose && !VOID.has(tag) && !closeTag && !INLINE.has(tag)) indent++;
        return out;
      })
      .join('\n');
  }

  /**
   * XSS sanitizer using an inert DOMParser document (scripts never execute).
   * Removes: <script> elements, on* event attributes, javascript: URLs on
   * href/src/action/formaction/data attributes.
   */
  _sanitize(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script').forEach(el => el.remove());
    // Selection markers are internal bookkeeping; never let them back in.
    doc.querySelectorAll('[data-jotter-bookmark]').forEach(el => el.remove());
    doc.querySelectorAll('*').forEach(el => {
      Array.from(el.attributes).forEach(attr => {
        if (attr.name.startsWith('on')) {
          el.removeAttribute(attr.name);
        } else if (['href', 'src', 'action', 'formaction', 'data'].includes(attr.name)) {
          if (/^\s*javascript:/i.test(attr.value)) el.removeAttribute(attr.name);
        }
      });
    });
    return doc.body.innerHTML;
  }

  /**
   * Toggles <code> wrapper on selection.
   * If caret is inside <code>: unwraps (moves children to parent).
   * If selection exists: wraps with surroundContents (fallback: extract+wrap).
   * If collapsed: inserts empty <code> with zero-width space and selects it.
   */
  _toggleInlineCode() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);

    let node = range.commonAncestorContainer;
    if (node.nodeType === 3) node = node.parentNode;
    const codeEl = node.closest ? node.closest('code') : null;

    if (codeEl) {
      const parent = codeEl.parentNode;
      while (codeEl.firstChild) parent.insertBefore(codeEl.firstChild, codeEl);
      parent.removeChild(codeEl);
    } else if (!range.collapsed) {
      const code = document.createElement('code');
      try {
        range.surroundContents(code);
      } catch (e) {
        const frag = range.extractContents();
        code.appendChild(frag);
        range.insertNode(code);
      }
    } else {
      const code = document.createElement('code');
      code.innerHTML = '&#8203;';
      range.insertNode(code);
      const r2 = document.createRange();
      r2.setStart(code, 0);
      r2.setEnd(code, code.childNodes.length);
      sel.removeAllRanges();
      sel.addRange(r2);
    }
  }

  /**
   * Wraps selection in <span style="font-size: Xpx">.
   * Uses Range API instead of execCommand('fontSize') to avoid the legacy 1-7 scale.
   */
  _applyFontSize(px) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (range.collapsed) return;
    const span = document.createElement('span');
    span.style.fontSize = px + 'px';
    try {
      range.surroundContents(span);
    } catch (e) {
      const frag = range.extractContents();
      span.appendChild(frag);
      range.insertNode(span);
    }
  }

  /**
   * Clipboard paste via Clipboard API (requires user permission prompt).
   * Falls back to execCommand('paste') which most browsers block silently.
   * Silent catch: user can always use Ctrl+V as a native fallback.
   */
  async _pasteFromClipboard() {
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        const text = await navigator.clipboard.readText();
        document.execCommand('insertText', false, text);
      } else {
        document.execCommand('paste');
      }
    } catch (_) {}
  }

  // ─── Toolbar state ────────────────────────────────────────────────────────

  /**
   * Syncs .jotter-btn--active and blockformat select to current cursor context.
   * Uses queryCommandState (bold/italic/etc.) and queryCommandValue (formatBlock).
   */
  _updateToolbarState() {
    this._toolbarEl.querySelectorAll('.jotter-btn[data-cmd]').forEach(btn => {
      try {
        btn.classList.toggle('jotter-btn--active', document.queryCommandState(btn.dataset.cmd));
      } catch (_) {}
    });

    const bfSel = this._toolbarEl.querySelector('[data-id="blockformat"]');
    if (bfSel) {
      const block = document.queryCommandValue('formatBlock').toLowerCase().replace(/[<>]/g, '');
      const match = HEADING_OPTIONS.find(o => o.tag === block);
      if (match) bfSel.value = match.tag;
    }
  }

  _updateStatus() {
    const text  = this._editor.innerText || '';
    const words = text.trim() === '' ? 0 : text.trim().split(/\s+/).length;
    const chars = text.replace(/\n/g, '').length;
    this._wordCountEl.textContent = `${words} word${words !== 1 ? 's' : ''}`;
    this._charCountEl.textContent = `${chars} char${chars !== 1 ? 's' : ''}`;
  }

  // ─── Selection bookmarks ──────────────────────────────────────────────────
  // Toolbar interactions and host UI both need the caret to survive losing
  // focus. A cloned Range does not: it goes stale the moment the DOM around it
  // mutates, which is exactly what happens during an upload with a progress
  // indicator or a host re-render. Empty marker <span>s move with the DOM
  // instead, so they still point at the right spot afterwards. They are stripped
  // from getHTML() and from _sanitize(), so hosts never see them.

  /** Editable area's HTML, minus any live selection markers. */
  _richHTML() {
    if (this._bookmarks.size === 0) return this._editor.innerHTML;
    const clone = this._editor.cloneNode(true);
    clone.querySelectorAll('[data-jotter-bookmark]').forEach(el => el.remove());
    return clone.innerHTML;
  }

  _makeMarker(id) {
    const el = document.createElement('span');
    el.className = 'jotter-bookmark';
    el.dataset.jotterBookmark = id;
    return el;
  }

  /**
   * Turns a bookmark back into a Range and takes it out of circulation:
   * markers are removed and the token is forgotten. Returns null when the token
   * is unknown or its markers were wiped out (setHTML, host re-render).
   */
  _takeRange(token) {
    const rec = token != null ? this._bookmarks.get(token) : null;
    if (!rec) return null;
    this._bookmarks.delete(token);

    if (rec.atStart) {
      const range = document.createRange();
      range.setStart(this._editor, 0);
      range.collapse(true);
      return range;
    }

    const { start, end } = rec;
    const live = this._editor.contains(start) && (!end || this._editor.contains(end));

    // Ranges track node removal, so anchoring after/before the markers and then
    // removing them leaves the boundaries exactly where the markers sat.
    let range = null;
    if (live) {
      range = document.createRange();
      range.setStartAfter(start);
      if (end) range.setEndBefore(end); else range.collapse(true);
    }
    if (start.parentNode) start.remove();
    if (end && end.parentNode) end.remove();
    return range;
  }

  /** Bookmarks the caret for the current toolbar interaction, dropping any previous one. */
  _saveBookmark() {
    this._releaseSavedBookmark();
    this._savedBookmark = this.saveSelection();
  }

  /** Puts the caret back where the toolbar interaction started and focuses the editor. */
  _restoreSavedBookmark() {
    this.restoreSelection(this._savedBookmark);
    this._savedBookmark = null;
    this._editor.focus();
  }

  _releaseSavedBookmark() {
    this.releaseSelection(this._savedBookmark);
    this._savedBookmark = null;
  }

  /** Drops every outstanding bookmark — for operations that replace the content wholesale. */
  _dropBookmarks() {
    Array.from(this._bookmarks.keys()).forEach(token => this.releaseSelection(token));
    this._savedBookmark = null;
  }

  _emit(event, data) {
    (this._listeners[event] || []).forEach(fn => fn(data));
  }

  /** Single funnel for content-change notification, so 'change' and onChange never drift. */
  _emitChange() {
    const html = this.getHTML();
    this._changeCount++;
    this._emit('change', html);
    if (this._options.onChange) this._options.onChange(html);
  }

  /**
   * Runs an edit and reports it exactly once.
   *
   * execCommand fires `input` on the editable, and that handler already emits —
   * so emitting again here would double-notify, while an edit made straight
   * through the DOM (the link popup's in-place update) emits nothing at all.
   * Both matter: hosts that save on change re-render, and a re-render mid-edit
   * remounts the editor. So: emit only if the edit changed something and
   * nothing else has spoken for it.
   */
  _applyEdit(fn) {
    const emits  = this._changeCount;
    const before = this._richHTML();
    fn();
    this._updateStatus();
    if (this._changeCount === emits && this._richHTML() !== before) this._emitChange();
  }

  // ─── Public API ─────────────────────────────────────────────────────────
  // See class-level JSDoc for full method signatures.

  getHTML()      { return this._sourceMode ? this._source.value : this._richHTML(); }
  getText()      { return this._editor.innerText; }
  isSourceMode() { return this._sourceMode; }
  toggleSource() { this._toggleSourceMode(); return this; }
  clear()    { this._dropBookmarks(); this._editor.innerHTML = ''; this._updateStatus(); return this; }
  focus()    { this._editor.focus(); return this; }

  /**
   * @param {string} html
   * @param {object} [opts]
   * @param {*}      [opts.at]  Bookmark from saveSelection(); insert there instead
   *                            of at the current caret. The bookmark is consumed.
   */
  insertHTML(html, opts = {}) {
    if (opts.at != null) this.restoreSelection(opts.at);
    this._editor.focus();
    this._applyEdit(() => document.execCommand('insertHTML', false, this._sanitize(html)));
    return this;
  }

  /** @param {object} [opts] @param {*} [opts.at] Bookmark to insert at; consumed. */
  insertText(text, opts = {}) {
    if (opts.at != null) this.restoreSelection(opts.at);
    this._editor.focus();
    this._applyEdit(() => document.execCommand('insertText', false, text));
    return this;
  }

  /**
   * Bookmarks the current selection and returns an opaque token, or null when
   * the selection is not inside this editor. The token survives DOM mutation
   * between save and restore — uploads, progress indicators, host re-renders.
   * Every token must be handed to restoreSelection() or releaseSelection()
   * exactly once; both consume it.
   *
   * @returns {string|null}
   */
  saveSelection() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;

    const range = sel.getRangeAt(0);
    if (!this._editor.contains(range.startContainer) ||
        !this._editor.contains(range.endContainer)) return null;

    const token = 'jbm' + (++this._bmSeq);

    // Nothing to anchor to in an empty editor — and injecting a marker would
    // break :empty, hiding the placeholder while host UI is open.
    if (this._editor.childNodes.length === 0) {
      this._bookmarks.set(token, { atStart: true });
      return token;
    }

    // End marker first: splitting a text node at the end boundary leaves the
    // earlier start boundary untouched, but not the other way round.
    const start = this._makeMarker(token);
    const end   = range.collapsed ? null : this._makeMarker(token);
    if (end) {
      const r = range.cloneRange();
      r.collapse(false);
      r.insertNode(end);
    }
    const r0 = range.cloneRange();
    r0.collapse(true);
    r0.insertNode(start);

    this._bookmarks.set(token, { start, end });

    // Re-select between the markers so the visible selection is unchanged.
    const live = document.createRange();
    live.setStartAfter(start);
    if (end) live.setEndBefore(end); else live.collapse(true);
    sel.removeAllRanges();
    sel.addRange(live);

    return token;
  }

  /** Restores (and consumes) a saveSelection() token; no-op for null/stale tokens. */
  restoreSelection(token) {
    const range = this._takeRange(token);
    if (!range) return this;
    if (!this._sourceMode) this._editor.focus();
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    return this;
  }

  /** Consumes a saveSelection() token without moving the caret. */
  releaseSelection(token) {
    this._takeRange(token);
    return this;
  }

  /**
   * Declares that host UI (a modal, an asset picker) is taking over. Bookmarks
   * the caret and suppresses focus/blur emission until endExternalUI(), so a
   * save-on-blur host cannot re-render — and remount the editor — while its own
   * modal is still open. Calls nest.
   */
  beginExternalUI() {
    if (this._externalDepth === 0) this._externalBookmark = this.saveSelection();
    this._externalDepth++;
    return this;
  }

  /**
   * Hands control back: restores the caret bookmarked by beginExternalUI() and
   * resumes focus/blur emission. Call it after the host UI has closed, so the
   * focus it takes back is not stolen again.
   *
   * @param {object}  [opts]
   * @param {boolean} [opts.restore=true]  false to drop the caret instead.
   */
  endExternalUI(opts = {}) {
    if (this._externalDepth === 0) return this;
    if (this._externalDepth === 1) {
      const token = this._externalBookmark;
      this._externalBookmark = null;
      // Still inside the suppression window, so restoring focus here stays silent.
      if (opts.restore === false) this.releaseSelection(token);
      else this.restoreSelection(token);
    }
    this._externalDepth--;
    return this;
  }

  setHTML(html) {
    this._dropBookmarks();
    this._editor.innerHTML = this._sanitize(html);
    this._updateStatus();
    return this;
  }

  setTheme(name) {
    const valid = THEMES.find(t => t.id === name);
    const id = valid ? name : 'default';
    this._editor.dataset.theme = id;
    this._options.theme = id;
    if (this._themeSelect) this._themeSelect.value = id;
    return this;
  }

  setEnabled(enabled) {
    this._editor.contentEditable = String(enabled);
    this._root.classList.toggle('jotter--disabled', !enabled);
    return this;
  }

  on(event, fn) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(fn);
    return this;
  }

  off(event, fn) {
    if (this._listeners[event])
      this._listeners[event] = this._listeners[event].filter(f => f !== fn);
    return this;
  }

  /** Unmounts editor, restores original element innerHTML, removes body popup, clears listeners. */
  destroy() {
    const html = this.getHTML();
    this._destroyed = true;
    this._hidePopup();
    this._dropBookmarks();
    this._externalBookmark = null;
    this._externalDepth = 0;
    document.removeEventListener('mousedown', this._onDocMouseDown);
    document.removeEventListener('keydown', this._onDocKeyDown);
    if (this._popup.parentNode) this._popup.parentNode.removeChild(this._popup);
    this._target.classList.remove('jotter-host');
    this._target.innerHTML = html;
    this._listeners = {};
    return html;
  }
}

// ─── Static references ────────────────────────────────────────────────────────
// Attached after class definition so they survive minification without prototype pollution.

/** Full default toolbar array — alias of JotterJS.presets.full. Spread/filter to build custom toolbars. */
JotterJS.toolbar = PRESETS.full;

/**
 * Named action descriptors — the single catalogue every toolbar is built from.
 * Use these to compose custom toolbar arrays:
 *   toolbar: [JotterJS.actions.bold, JotterJS.actions.italic, JotterJS.actions.sep, ...]
 * Descriptors are frozen; customise by spreading, e.g.
 *   { ...JotterJS.actions.image, onClick: fn }
 */
JotterJS.actions = ACTIONS;

/**
 * Pre-built toolbar arrays, composed from JotterJS.actions.
 *   minimal  — bold/italic/underline + link
 *   writing  — heading/formatting/lists/link/image
 *   full     — the default toolbar
 */
JotterJS.presets = PRESETS;

export default JotterJS;
export { JotterJS };
