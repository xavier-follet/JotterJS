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
 *
 * @fires change  (html: string)
 * @fires focus
 * @fires blur
 *
 * Public API (all methods return `this` for chaining unless noted):
 *   getHTML()           → string   Raw innerHTML (sanitized). In source mode returns textarea value.
 *   getText()           → string   Plain text (innerText).
 *   setHTML(html)                  Replace content; sanitized before insertion.
 *   insertHTML(html)               Insert sanitized HTML at caret / selection.
 *   insertText(text)               Insert plain text at caret.
 *   clear()                        Empty the editor.
 *   focus()                        Focus the editable area.
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
    }, options);

    this._listeners    = {};
    this._savedRange   = null;
    this._lastForeColor   = '#e8e4d8';
    this._lastHiliteColor = '#c8a96e';
    this._init();
  }

  // ─── Init ─────────────────────────────────────────────────────────────────
  // Popup is appended to document.body (not the root) to escape overflow:hidden.
  // _savedRange stores the selection before any toolbar interaction steals focus,
  // so popup submit handlers can restore it via _restoreRange().

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

  /** Dispatches an action descriptor to the appropriate builder. */
  _buildAction(action) {
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

    btn.addEventListener('mousedown', e => {
      e.preventDefault();
      this._editor.focus();

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

      this._updateToolbarState();
      this._updateStatus();
      this._emit('change', this.getHTML());
      if (this._options.onChange) this._options.onChange(this.getHTML());
    });

    return btn;
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
    sel.addEventListener('mousedown', () => { this._savedRange = this._saveRange(); });
    sel.addEventListener('change', () => {
      this._restoreRange(this._savedRange);
      document.execCommand('formatBlock', false, sel.value);
      this._editor.focus();
      this._updateStatus();
      this._emit('change', this.getHTML());
      if (this._options.onChange) this._options.onChange(this.getHTML());
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
    sel.addEventListener('mousedown', () => { this._savedRange = this._saveRange(); });
    sel.addEventListener('change', () => {
      if (!sel.value) return;
      this._restoreRange(this._savedRange);
      document.execCommand('fontName', false, sel.value);
      this._editor.focus();
      this._emit('change', this.getHTML());
      if (this._options.onChange) this._options.onChange(this.getHTML());
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
    sel.addEventListener('mousedown', () => { this._savedRange = this._saveRange(); });
    sel.addEventListener('change', () => {
      if (!sel.value) return;
      this._restoreRange(this._savedRange);
      this._applyFontSize(sel.value);
      this._editor.focus();
      this._emit('change', this.getHTML());
      if (this._options.onChange) this._options.onChange(this.getHTML());
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

    input.addEventListener('change', () => {
      const color = input.value;
      swatch.style.background = color;
      if (action.cmd === 'foreColor') this._lastForeColor = color;
      else this._lastHiliteColor = color;
      this._restoreRange(this._savedRange);
      this._editor.focus();
      document.execCommand(action.cmd, false, color);
      this._emit('change', this.getHTML());
      if (this._options.onChange) this._options.onChange(this.getHTML());
    });

    btn.addEventListener('mousedown', e => {
      e.preventDefault();
      this._savedRange = this._saveRange();
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

    btn.addEventListener('mousedown', e => {
      e.preventDefault();
      this._savedRange = this._saveRange();

      if (this._popup.classList.contains('jotter-popup--visible') &&
          this._popup.dataset.popupId === action.id) {
        this._hidePopup();
        return;
      }

      this._showPopup(btn, this._buildPopupContent(action.id), action.id);
    });

    return btn;
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

  _hidePopup() {
    this._popup.classList.remove('jotter-popup--visible');
    this._popup.dataset.popupId = '';
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

  /** Hover-to-select grid (up to 8×10). Click inserts <table> with <th> header row. */
  _popupTable() {
    const wrap = document.createElement('div');
    wrap.className = 'jotter-popup-inner';

    const title = this._popupTitle('Insert Table');
    wrap.appendChild(title);

    const COLS = 10, ROWS = 8;
    const grid = document.createElement('div');
    grid.className = 'jotter-table-grid';
    grid.style.gridTemplateColumns = `repeat(${COLS}, 1fr)`;

    const hint = document.createElement('div');
    hint.className = 'jotter-popup-hint';
    hint.textContent = 'Hover to select size';

    const cells = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const cell = document.createElement('span');
        cell.className = 'jotter-table-cell';
        cell.dataset.r = r;
        cell.dataset.c = c;

        cell.addEventListener('mouseenter', () => {
          hint.textContent = `${r + 1} × ${c + 1} table`;
          cells.forEach(cl => {
            cl.classList.toggle('jotter-table-cell--active',
              +cl.dataset.r <= r && +cl.dataset.c <= c);
          });
        });
        cell.addEventListener('click', () => {
          this._insertTable(r + 1, c + 1);
          this._hidePopup();
        });

        cells.push(cell);
        grid.appendChild(cell);
      }
    }

    wrap.appendChild(grid);
    wrap.appendChild(hint);
    return wrap;
  }

  _insertTable(rows, cols) {
    this._restoreRange(this._savedRange);
    this._editor.focus();
    let html = '<table><tbody>';
    for (let r = 0; r < rows; r++) {
      html += '<tr>';
      for (let c = 0; c < cols; c++) {
        html += r === 0 ? '<th><br></th>' : '<td><br></td>';
      }
      html += '</tr>';
    }
    html += '</tbody></table><p><br></p>';
    document.execCommand('insertHTML', false, html);
    this._emit('change', this.getHTML());
    if (this._options.onChange) this._options.onChange(this.getHTML());
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

    // Walk up from anchorNode to find an <a> ancestor within the editor
    let existingAnchor = null;
    let selectedText = '';
    if (this._savedRange) {
      const sel = window.getSelection();
      if (sel && sel.rangeCount) {
        selectedText = sel.toString();
        let node = sel.anchorNode;
        while (node && node !== this._editor) {
          if (node.nodeName === 'A') { existingAnchor = node; break; }
          node = node.parentNode;
        }
      }
    }

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
      const linkText = textInput.value.trim() || selectedText || href;
      const title    = titleInput.value.trim();
      const target   = targetSel.value;
      let attrs = `href="${this._esc(href)}"`;
      if (target) attrs += ` target="${this._esc(target)}"`;
      if (title)  attrs += ` title="${this._esc(title)}"`;
      this._restoreRange(this._savedRange);
      this._editor.focus();
      if (existingAnchor) {
        existingAnchor.href = href;
        if (target) existingAnchor.target = target; else existingAnchor.removeAttribute('target');
        if (title)  existingAnchor.title = title;  else existingAnchor.removeAttribute('title');
        existingAnchor.textContent = linkText;
      } else {
        document.execCommand('insertHTML', false, `<a ${attrs}>${this._esc(linkText)}</a>`);
      }
      this._hidePopup();
      this._emit('change', this.getHTML());
      if (this._options.onChange) this._options.onChange(this.getHTML());
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
      const alt = altInput.value.trim();
      const w = widthInput.value.trim();
      const style = w ? `max-width:${w}` : 'max-width:100%';
      this._restoreRange(this._savedRange);
      this._editor.focus();
      document.execCommand('insertHTML', false,
        `<img src="${this._esc(src)}" alt="${this._esc(alt)}" style="${style}">`);
      this._hidePopup();
      this._emit('change', this.getHTML());
      if (this._options.onChange) this._options.onChange(this.getHTML());
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
      const html = `<div class="jotter-video-wrap"><iframe src="https://www.youtube.com/embed/${id}" frameborder="0" allowfullscreen loading="lazy" title="YouTube video"></iframe></div><p><br></p>`;
      this._restoreRange(this._savedRange);
      this._editor.focus();
      document.execCommand('insertHTML', false, html);
      this._hidePopup();
      this._emit('change', this.getHTML());
      if (this._options.onChange) this._options.onChange(this.getHTML());
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
      this._restoreRange(this._savedRange);
      this._editor.focus();
      document.execCommand('insertHTML', false, html + '<p><br></p>');
      this._hidePopup();
      this._emit('change', this.getHTML());
      if (this._options.onChange) this._options.onChange(this.getHTML());
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
      btn.addEventListener('mousedown', e => {
        e.preventDefault();
        this._restoreRange(this._savedRange);
        this._editor.focus();
        document.execCommand('insertText', false, ch);
        this._hidePopup();
        this._emit('change', this.getHTML());
        if (this._options.onChange) this._options.onChange(this.getHTML());
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
      btn.addEventListener('mousedown', e => {
        e.preventDefault();
        this._restoreRange(this._savedRange);
        this._editor.focus();
        if (v.isHTML) {
          document.execCommand('insertHTML', false, v.text);
        } else {
          document.execCommand('insertText', false, v.text);
        }
        this._hidePopup();
        this._emit('change', this.getHTML());
        if (this._options.onChange) this._options.onChange(this.getHTML());
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
    return s.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
      this._emit('change', this.getHTML());
      if (this._options.onChange) this._options.onChange(this.getHTML());
    });

    this._editor.addEventListener('keyup',   () => this._updateToolbarState());
    this._editor.addEventListener('mouseup', () => this._updateToolbarState());

    this._editor.addEventListener('focus', () => {
      this._root.classList.add('jotter--focused');
      this._emit('focus');
      if (this._options.onFocus) this._options.onFocus();
    });

    this._editor.addEventListener('blur', () => {
      this._root.classList.remove('jotter--focused');
      this._emit('blur');
      if (this._options.onBlur) this._options.onBlur();
    });

    this._editor.addEventListener('keydown', e => {
      if (e.key === 'Tab') {
        e.preventDefault();
        document.execCommand('insertHTML', false, '&nbsp;&nbsp;&nbsp;&nbsp;');
      }
    });

    // Close popup on outside click
    document.addEventListener('mousedown', e => {
      if (this._popup.classList.contains('jotter-popup--visible') &&
          !this._popup.contains(e.target) &&
          !this._toolbarEl.contains(e.target)) {
        this._hidePopup();
      }
    });

    // Close popup on Escape
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && this._popup.classList.contains('jotter-popup--visible')) {
        this._hidePopup();
        this._editor.focus();
      }
    });
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
      this._source.value = this._prettyHTML(this._editor.innerHTML);
      this._editor.style.display = 'none';
      this._source.style.display = 'block';
    } else {
      this._editor.innerHTML = this._sanitize(this._source.value);
      this._source.style.display = 'none';
      this._editor.style.display = '';
      this._updateStatus();
      this._emit('change', this.getHTML());
      if (this._options.onChange) this._options.onChange(this.getHTML());
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

  /** Clones current selection range before a toolbar interaction steals focus. */
  _saveRange() {
    const sel = window.getSelection();
    return (sel && sel.rangeCount > 0) ? sel.getRangeAt(0).cloneRange() : null;
  }

  /** Restores a previously saved range so execCommand targets the original selection. */
  _restoreRange(range) {
    if (!range) return;
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  _emit(event, data) {
    (this._listeners[event] || []).forEach(fn => fn(data));
  }

  // ─── Public API ─────────────────────────────────────────────────────────
  // See class-level JSDoc for full method signatures.

  getHTML()      { return this._sourceMode ? this._source.value : this._editor.innerHTML; }
  getText()      { return this._editor.innerText; }
  isSourceMode() { return this._sourceMode; }
  toggleSource() { this._toggleSourceMode(); return this; }
  clear()    { this._editor.innerHTML = ''; this._updateStatus(); return this; }
  focus()    { this._editor.focus(); return this; }

  insertHTML(html) {
    this._editor.focus();
    document.execCommand('insertHTML', false, this._sanitize(html));
    this._updateStatus();
    this._emit('change', this.getHTML());
    if (this._options.onChange) this._options.onChange(this.getHTML());
    return this;
  }

  insertText(text) {
    this._editor.focus();
    document.execCommand('insertText', false, text);
    this._updateStatus();
    this._emit('change', this.getHTML());
    if (this._options.onChange) this._options.onChange(this.getHTML());
    return this;
  }

  setHTML(html) {
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
    this._hidePopup();
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
