export type EditorFontId =
  | 'jetbrains-mono'
  | 'fira-code'
  | 'cascadia-code'
  | 'sf-mono'
  | 'menlo'
  | 'monaco'
  | 'consolas'
  | 'system-mono';

export type EditorThemeId =
  | 'codeyo-editorial'
  | 'one-dark-pro'
  | 'dracula'
  | 'github-dark'
  | 'monokai'
  | 'nord'
  | 'solarized-dark'
  | 'github-light';

export interface EditorFontPreset {
  id: EditorFontId;
  name: string;
  family: string;
}

export interface EditorThemePreset {
  id: EditorThemeId;
  name: string;
  swatches: string[];
  variables: Record<string, string>;
}

export const editorFontPresets: EditorFontPreset[] = [
  { id: 'jetbrains-mono', name: 'JetBrains Mono', family: '"JetBrains Mono", monospace' },
  { id: 'fira-code', name: 'Fira Code', family: '"Fira Code", "JetBrains Mono", monospace' },
  { id: 'cascadia-code', name: 'Cascadia Code', family: '"Cascadia Code", "Cascadia Mono", "JetBrains Mono", monospace' },
  { id: 'sf-mono', name: 'SF Mono', family: '"SF Mono", ui-monospace, monospace' },
  { id: 'menlo', name: 'Menlo', family: 'Menlo, "JetBrains Mono", monospace' },
  { id: 'monaco', name: 'Monaco', family: 'Monaco, "JetBrains Mono", monospace' },
  { id: 'consolas', name: 'Consolas', family: 'Consolas, "JetBrains Mono", monospace' },
  { id: 'system-mono', name: 'System Mono', family: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' },
];

export const editorThemePresets: EditorThemePreset[] = [
  {
    id: 'codeyo-editorial',
    name: 'Codeyo Editorial',
    swatches: ['#1a1a1a', '#fff1bf', '#ff73d7', '#4ea5ff'],
    variables: {
      '--codeyo-editor-bg': '#1a1a1a',
      '--codeyo-editor-fg': '#fff1bf',
      '--codeyo-editor-gutter-bg': '#111111',
      '--codeyo-editor-gutter-fg': '#d8bd4b',
      '--codeyo-editor-accent': '#e8c547',
      '--codeyo-editor-active-line-bg': 'rgba(255, 229, 142, 0.12)',
      '--codeyo-editor-selection-bg': '#e8c547',
      '--codeyo-editor-selection-fg': '#1a1a1a',
      '--codeyo-editor-search-bg': '#faeab5',
      '--codeyo-editor-search-fg': '#1a1a1a',
      '--codeyo-editor-panel-bg': '#f7f1e3',
      '--codeyo-editor-panel-fg': '#1a1a1a',
      '--codeyo-editor-tooltip-border': '#2a2620',
      '--codeyo-editor-error': '#ff7a5c',
      '--codeyo-editor-warning': '#e8c547',
      '--codeyo-editor-diff-added-bg': 'rgba(232, 197, 71, 0.17)',
      '--codeyo-editor-diff-removed-bg': 'rgba(255, 122, 92, 0.18)',
      '--codeyo-syntax-keyword': '#ff73d7',
      '--codeyo-syntax-function': '#4ea5ff',
      '--codeyo-syntax-variable': '#fff1bf',
      '--codeyo-syntax-string': '#ff766c',
      '--codeyo-syntax-number': '#45d08d',
      '--codeyo-syntax-operator': '#ffe18e',
      '--codeyo-syntax-comment': '#6a9955',
      '--codeyo-syntax-meta': '#9de07f',
      '--codeyo-syntax-invalid': '#ffb39c',
    },
  },
  {
    id: 'one-dark-pro',
    name: 'One Dark Pro',
    swatches: ['#282c34', '#abb2bf', '#c678dd', '#61afef'],
    variables: editorTheme({
      bg: '#282c34',
      fg: '#abb2bf',
      gutterBg: '#21252b',
      gutterFg: '#636d83',
      accent: '#61afef',
      activeLine: 'rgba(153, 187, 255, 0.08)',
      keyword: '#c678dd',
      fn: '#61afef',
      variable: '#abb2bf',
      string: '#98c379',
      number: '#d19a66',
      operator: '#56b6c2',
      comment: '#7f848e',
      meta: '#e5c07b',
      error: '#e06c75',
    }),
  },
  {
    id: 'dracula',
    name: 'Dracula',
    swatches: ['#282a36', '#f8f8f2', '#ff79c6', '#8be9fd'],
    variables: editorTheme({
      bg: '#282a36',
      fg: '#f8f8f2',
      gutterBg: '#21222c',
      gutterFg: '#6272a4',
      accent: '#bd93f9',
      activeLine: 'rgba(68, 71, 90, 0.85)',
      keyword: '#ff79c6',
      fn: '#50fa7b',
      variable: '#f8f8f2',
      string: '#f1fa8c',
      number: '#bd93f9',
      operator: '#ff79c6',
      comment: '#6272a4',
      meta: '#8be9fd',
      error: '#ff5555',
    }),
  },
  {
    id: 'github-dark',
    name: 'GitHub Dark',
    swatches: ['#0d1117', '#c9d1d9', '#ff7b72', '#79c0ff'],
    variables: editorTheme({
      bg: '#0d1117',
      fg: '#c9d1d9',
      gutterBg: '#010409',
      gutterFg: '#8b949e',
      accent: '#58a6ff',
      activeLine: 'rgba(110, 118, 129, 0.18)',
      keyword: '#ff7b72',
      fn: '#d2a8ff',
      variable: '#c9d1d9',
      string: '#a5d6ff',
      number: '#79c0ff',
      operator: '#ff7b72',
      comment: '#8b949e',
      meta: '#7ee787',
      error: '#f85149',
    }),
  },
  {
    id: 'monokai',
    name: 'Monokai',
    swatches: ['#272822', '#f8f8f2', '#f92672', '#a6e22e'],
    variables: editorTheme({
      bg: '#272822',
      fg: '#f8f8f2',
      gutterBg: '#1e1f1c',
      gutterFg: '#90908a',
      accent: '#a6e22e',
      activeLine: 'rgba(73, 72, 62, 0.88)',
      keyword: '#f92672',
      fn: '#a6e22e',
      variable: '#f8f8f2',
      string: '#e6db74',
      number: '#ae81ff',
      operator: '#f92672',
      comment: '#88846f',
      meta: '#66d9ef',
      error: '#fd5ff0',
    }),
  },
  {
    id: 'nord',
    name: 'Nord',
    swatches: ['#2e3440', '#d8dee9', '#81a1c1', '#a3be8c'],
    variables: editorTheme({
      bg: '#2e3440',
      fg: '#d8dee9',
      gutterBg: '#242933',
      gutterFg: '#6f7b91',
      accent: '#88c0d0',
      activeLine: 'rgba(67, 76, 94, 0.78)',
      keyword: '#81a1c1',
      fn: '#88c0d0',
      variable: '#d8dee9',
      string: '#a3be8c',
      number: '#b48ead',
      operator: '#81a1c1',
      comment: '#616e88',
      meta: '#ebcb8b',
      error: '#bf616a',
    }),
  },
  {
    id: 'solarized-dark',
    name: 'Solarized Dark',
    swatches: ['#002b36', '#839496', '#268bd2', '#2aa198'],
    variables: editorTheme({
      bg: '#002b36',
      fg: '#839496',
      gutterBg: '#073642',
      gutterFg: '#586e75',
      accent: '#b58900',
      activeLine: 'rgba(7, 54, 66, 0.92)',
      keyword: '#268bd2',
      fn: '#2aa198',
      variable: '#93a1a1',
      string: '#2aa198',
      number: '#d33682',
      operator: '#859900',
      comment: '#586e75',
      meta: '#b58900',
      error: '#dc322f',
    }),
  },
  {
    id: 'github-light',
    name: 'GitHub Light',
    swatches: ['#ffffff', '#24292f', '#cf222e', '#0969da'],
    variables: {
      ...editorTheme({
        bg: '#ffffff',
        fg: '#24292f',
        gutterBg: '#f6f8fa',
        gutterFg: '#57606a',
        accent: '#0969da',
        activeLine: 'rgba(234, 238, 242, 0.92)',
        keyword: '#cf222e',
        fn: '#8250df',
        variable: '#24292f',
        string: '#0a3069',
        number: '#0550ae',
        operator: '#cf222e',
        comment: '#6e7781',
        meta: '#116329',
        error: '#cf222e',
      }),
      '--codeyo-editor-selection-bg': '#0969da',
      '--codeyo-editor-selection-fg': '#ffffff',
      '--codeyo-editor-search-bg': '#fff8c5',
      '--codeyo-editor-search-fg': '#24292f',
      '--codeyo-editor-panel-bg': '#f6f8fa',
      '--codeyo-editor-panel-fg': '#24292f',
      '--codeyo-editor-tooltip-border': '#d0d7de',
    },
  },
];

export const defaultEditorFontId: EditorFontId = 'jetbrains-mono';
export const defaultEditorThemeId: EditorThemeId = 'codeyo-editorial';

export function editorFontPreset(id: string | null | undefined): EditorFontPreset {
  return editorFontPresets.find((preset) => preset.id === id) ?? editorFontPresets[0];
}

export function editorThemePreset(id: string | null | undefined): EditorThemePreset {
  return editorThemePresets.find((preset) => preset.id === id) ?? editorThemePresets[0];
}

function editorTheme(colors: {
  bg: string;
  fg: string;
  gutterBg: string;
  gutterFg: string;
  accent: string;
  activeLine: string;
  keyword: string;
  fn: string;
  variable: string;
  string: string;
  number: string;
  operator: string;
  comment: string;
  meta: string;
  error: string;
}): Record<string, string> {
  return {
    '--codeyo-editor-bg': colors.bg,
    '--codeyo-editor-fg': colors.fg,
    '--codeyo-editor-gutter-bg': colors.gutterBg,
    '--codeyo-editor-gutter-fg': colors.gutterFg,
    '--codeyo-editor-accent': colors.accent,
    '--codeyo-editor-active-line-bg': colors.activeLine,
    '--codeyo-editor-selection-bg': colors.accent,
    '--codeyo-editor-selection-fg': colors.bg,
    '--codeyo-editor-search-bg': colors.accent,
    '--codeyo-editor-search-fg': colors.bg,
    '--codeyo-editor-panel-bg': colors.gutterBg,
    '--codeyo-editor-panel-fg': colors.fg,
    '--codeyo-editor-tooltip-border': colors.gutterFg,
    '--codeyo-editor-error': colors.error,
    '--codeyo-editor-warning': colors.accent,
    '--codeyo-editor-diff-added-bg': `${colors.accent}2b`,
    '--codeyo-editor-diff-removed-bg': `${colors.error}2b`,
    '--codeyo-syntax-keyword': colors.keyword,
    '--codeyo-syntax-function': colors.fn,
    '--codeyo-syntax-variable': colors.variable,
    '--codeyo-syntax-string': colors.string,
    '--codeyo-syntax-number': colors.number,
    '--codeyo-syntax-operator': colors.operator,
    '--codeyo-syntax-comment': colors.comment,
    '--codeyo-syntax-meta': colors.meta,
    '--codeyo-syntax-invalid': colors.error,
  };
}
