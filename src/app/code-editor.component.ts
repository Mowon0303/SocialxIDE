import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild,
  ViewEncapsulation,
} from '@angular/core';
import { basicSetup } from 'codemirror';
import {
  autocompletion,
  CompletionContext,
  CompletionResult,
  startCompletion,
} from '@codemirror/autocomplete';
import { indentWithTab } from '@codemirror/commands';
import { cpp } from '@codemirror/lang-cpp';
import { python } from '@codemirror/lang-python';
import { HighlightStyle, indentUnit, syntaxHighlighting } from '@codemirror/language';
import { openSearchPanel } from '@codemirror/search';
import { Diagnostic, setDiagnostics } from '@codemirror/lint';
import { Compartment, EditorState, Extension } from '@codemirror/state';
import { Decoration, EditorView, hoverTooltip, keymap, Tooltip } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import {
  EditorDiagnostic,
  EditorLanguage,
  LanguageCompletionResult,
  LanguageHoverResult,
} from './desktop-api';
import { resolveEditorLanguage } from './editor-language';

export interface EditorLanguagePosition {
  line: number;
  column: number;
}

@Component({
  selector: 'codeyo-editor',
  standalone: true,
  template: '<div #host class="codeyo-editor-host" [attr.aria-label]="ariaLabel"></div>',
  styleUrl: './code-editor.component.css',
  encapsulation: ViewEncapsulation.None,
})
export class CodeEditorComponent implements AfterViewInit, OnChanges, OnDestroy {
  @ViewChild('host', { static: true }) private host?: ElementRef<HTMLDivElement>;
  @Input() content = '';
  @Input() language: EditorLanguage = 'text';
  @Input() readOnly = false;
  @Input() ariaLabel = 'Code editor';
  @Input() diagnostics: EditorDiagnostic[] = [];
  @Input() revealLine = 0;
  @Input() revealColumn = 1;
  @Input() revealRequest = 0;
  @Input() searchRequest = 0;
  @Input() definitionRequest = 0;
  @Input() completionEnabled = false;
  @Input() hoverEnabled = false;
  @Input() completionProvider?: (position: EditorLanguagePosition) => Promise<LanguageCompletionResult>;
  @Input() hoverProvider?: (position: EditorLanguagePosition) => Promise<LanguageHoverResult>;
  @Input() layoutKey = '';
  @Input() diffLines: number[] = [];
  @Input() diffKind: 'added' | 'removed' | null = null;
  @Output() readonly contentChange = new EventEmitter<string>();
  @Output() readonly cursorChange = new EventEmitter<{ line: number; column: number }>();
  @Output() readonly definitionLookup = new EventEmitter<EditorLanguagePosition>();

  private view?: EditorView;
  private applyingExternalChange = false;
  private readonly languageCompartment = new Compartment();
  private readonly readOnlyCompartment = new Compartment();
  private readonly diffCompartment = new Compartment();
  private appliedLanguage: EditorLanguage = 'text';
  private cursorEmitQueued = false;
  private pendingCursorPosition: { line: number; column: number } | null = null;
  private layoutMeasureQueued = false;
  private destroyed = false;

  ngAfterViewInit(): void {
    if (!this.host) {
      return;
    }
    this.view = new EditorView({
      parent: this.host.nativeElement,
      state: EditorState.create({
        doc: this.content,
        extensions: [
          basicSetup,
          indentUnit.of('    '),
          this.languageCompartment.of(this.languageExtension()),
          this.readOnlyCompartment.of(this.readOnlyExtensions()),
          this.diffCompartment.of(this.diffExtension()),
          autocompletion({ override: [this.languageCompletionSource] }),
          hoverTooltip(this.languageHoverSource),
          keymap.of([
            { key: 'Ctrl-Space', run: startCompletion },
            { key: 'F12', run: () => this.requestDefinitionAtCursor() },
            indentWithTab,
          ]),
          syntaxHighlighting(editorialHighlightStyle),
          editorialEditorTheme,
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !this.applyingExternalChange) {
              this.contentChange.emit(update.state.doc.toString());
            }
            if (update.selectionSet || update.docChanged) {
              this.emitCursorPosition();
            }
          }),
        ],
      }),
    });
    this.applyDiagnostics();
    this.emitCursorPosition();
    this.queueLayoutMeasure();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.view) {
      return;
    }
    if (changes['content'] && this.view.state.doc.toString() !== this.content) {
      this.applyingExternalChange = true;
      this.view.dispatch({
        changes: { from: 0, to: this.view.state.doc.length, insert: this.content },
      });
      this.applyingExternalChange = false;
    }
    if ((changes['language'] || changes['content']) && this.appliedLanguage !== this.resolvedLanguage()) {
      this.view.dispatch({
        effects: this.languageCompartment.reconfigure(this.languageExtension()),
      });
    }
    if (changes['readOnly']) {
      this.view.dispatch({
        effects: this.readOnlyCompartment.reconfigure(this.readOnlyExtensions()),
      });
    }
    if (changes['diffLines'] || changes['diffKind']) {
      this.view.dispatch({
        effects: this.diffCompartment.reconfigure(this.diffExtension()),
      });
    }
    if (changes['diagnostics'] || changes['content']) {
      this.applyDiagnostics();
    }
    if (changes['revealRequest'] && this.revealRequest > 0) {
      this.revealPosition();
    }
    if (changes['searchRequest'] && this.searchRequest > 0) {
      this.openSearch();
    }
    if (changes['definitionRequest'] && this.definitionRequest > 0) {
      this.requestDefinitionAtCursor();
    }
    if (changes['layoutKey']) {
      this.queueLayoutMeasure();
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.view?.destroy();
  }

  private languageExtension(): Extension {
    const language = this.resolvedLanguage();
    this.appliedLanguage = language;
    if (language === 'python') {
      return python();
    }
    if (language === 'cpp') {
      return cpp();
    }
    return [];
  }

  private resolvedLanguage(): EditorLanguage {
    return resolveEditorLanguage(this.language, this.content);
  }

  private readOnlyExtensions(): Extension {
    return [
      EditorState.readOnly.of(this.readOnly),
      EditorView.editable.of(!this.readOnly),
    ];
  }

  private diffExtension(): Extension {
    if (!this.diffKind || this.diffLines.length === 0) {
      return [];
    }
    return EditorView.decorations.compute(['doc'], (state) => Decoration.set(
      this.diffLines
        .filter((lineNumber) => lineNumber >= 1 && lineNumber <= state.doc.lines)
        .map((lineNumber) => Decoration.line({
          class: `cm-diff-line cm-diff-${this.diffKind}`,
        }).range(state.doc.line(lineNumber).from)),
    ));
  }

  private applyDiagnostics(): void {
    if (!this.view) {
      return;
    }
    const mapped: Diagnostic[] = this.diagnostics.map((diagnostic) => {
      const lineNumber = Math.max(1, Math.min(diagnostic.line, this.view!.state.doc.lines));
      const line = this.view!.state.doc.line(lineNumber);
      const from = Math.min(line.to, line.from + Math.max(0, (diagnostic.column ?? 1) - 1));
      const endLineNumber = Math.max(1, Math.min(diagnostic.endLine ?? diagnostic.line, this.view!.state.doc.lines));
      const endLine = this.view!.state.doc.line(endLineNumber);
      const to = Math.max(
        from + 1,
        Math.min(endLine.to, endLine.from + Math.max(0, (diagnostic.endColumn ?? (diagnostic.column ?? 1) + 1) - 1)),
      );
      return {
        from,
        to,
        severity: diagnostic.severity,
        message: diagnostic.source ? `[${diagnostic.source}] ${diagnostic.message}` : diagnostic.message,
      };
    });
    this.view.dispatch(setDiagnostics(this.view.state, mapped));
  }

  private readonly languageCompletionSource = async (context: CompletionContext): Promise<CompletionResult | null> => {
    if (!this.completionEnabled || !this.completionProvider || this.readOnly) {
      return null;
    }
    const match = context.matchBefore(/[\w.]*$/);
    if (!context.explicit && (!match || match.from === match.to)) {
      return null;
    }
    const line = context.state.doc.lineAt(context.pos);
    const result = await this.completionProvider({
      line: line.number,
      column: context.pos - line.from + 1,
    });
    if (!result.available || result.items.length === 0) {
      return null;
    }
    return {
      from: match?.from ?? context.pos,
      options: result.items.map((item) => ({
        label: item.label,
        type: item.kind || 'text',
        detail: item.detail,
        info: item.info,
        apply: item.apply,
      })),
      validFor: /^[\w.]*$/,
    };
  };

  private readonly languageHoverSource = async (view: EditorView, position: number): Promise<Tooltip | null> => {
    if (!this.hoverEnabled || !this.hoverProvider || this.readOnly) {
      return null;
    }
    const line = view.state.doc.lineAt(position);
    const result = await this.hoverProvider({
      line: line.number,
      column: position - line.from + 1,
    });
    if (!result.available || !result.contents.trim()) {
      return null;
    }
    return {
      pos: position,
      above: true,
      create() {
        const dom = document.createElement('div');
        dom.className = 'cm-codeyo-hover';
        dom.textContent = result.contents.slice(0, 2000);
        return { dom };
      },
    };
  };

  private requestDefinitionAtCursor(): boolean {
    if (!this.view || this.readOnly) {
      return false;
    }
    const position = this.view.state.selection.main.head;
    const line = this.view.state.doc.lineAt(position);
    this.definitionLookup.emit({
      line: line.number,
      column: position - line.from + 1,
    });
    return true;
  }

  private revealPosition(): void {
    if (!this.view || this.revealLine < 1) {
      return;
    }
    const lineNumber = Math.min(this.revealLine, this.view.state.doc.lines);
    const line = this.view.state.doc.line(lineNumber);
    const position = Math.min(line.to, line.from + Math.max(0, this.revealColumn - 1));
    this.view.dispatch({
      selection: { anchor: position },
      effects: EditorView.scrollIntoView(position, { y: 'center' }),
    });
    this.view.focus();
    this.emitCursorPosition();
  }

  private openSearch(): void {
    if (!this.view) {
      return;
    }
    openSearchPanel(this.view);
    this.view.focus();
  }

  private queueLayoutMeasure(): void {
    if (!this.view || this.layoutMeasureQueued) {
      return;
    }
    this.layoutMeasureQueued = true;
    const schedule = typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (callback: FrameRequestCallback) => window.setTimeout(() => callback(Date.now()), 0);
    schedule(() => {
      this.layoutMeasureQueued = false;
      if (this.destroyed || !this.view) {
        return;
      }
      this.view.requestMeasure();
    });
  }

  private emitCursorPosition(): void {
    if (!this.view) {
      return;
    }
    const position = this.view.state.selection.main.head;
    const line = this.view.state.doc.lineAt(position);
    this.pendingCursorPosition = {
      line: line.number,
      column: position - line.from + 1,
    };
    if (this.cursorEmitQueued) {
      return;
    }
    this.cursorEmitQueued = true;
    queueMicrotask(() => {
      this.cursorEmitQueued = false;
      if (this.destroyed || !this.pendingCursorPosition) {
        return;
      }
      this.cursorChange.emit(this.pendingCursorPosition);
    });
  }
}

const editorialEditorTheme = EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: 'var(--codeyo-editor-bg, #1a1a1a)',
    color: 'var(--codeyo-editor-fg, #fff1bf)',
    fontFamily: 'var(--codeyo-editor-font-family, "JetBrains Mono", monospace)',
    fontSize: 'var(--codeyo-editor-font-size, 13.5px)',
  },
  '.cm-scroller': {
    fontFamily: 'var(--codeyo-editor-font-family, "JetBrains Mono", monospace)',
    overflow: 'auto',
    lineHeight: 'var(--codeyo-editor-line-height, 21px)',
  },
  '.cm-content': {
    caretColor: 'var(--codeyo-editor-accent, #e8c547)',
    fontFamily: 'var(--codeyo-editor-font-family, "JetBrains Mono", monospace)',
    padding: 'var(--codeyo-editor-y-padding, 9px) 0',
  },
  '.cm-line': {
    fontFamily: 'var(--codeyo-editor-font-family, "JetBrains Mono", monospace)',
    lineHeight: 'var(--codeyo-editor-line-height, 21px)',
    minHeight: 'var(--codeyo-editor-line-height, 21px)',
    paddingLeft: '7px',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--codeyo-editor-gutter-bg, #111111)',
    borderRight: '1px solid var(--codeyo-editor-accent, #e8c547)',
    color: 'var(--codeyo-editor-gutter-fg, #d8bd4b)',
    fontFamily: 'var(--codeyo-editor-font-family, "JetBrains Mono", monospace)',
    paddingTop: '0',
  },
  '.cm-gutterElement': {
    boxSizing: 'border-box',
    lineHeight: 'var(--codeyo-editor-line-height, 21px)',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    alignItems: 'center',
    boxSizing: 'border-box',
    display: 'flex',
    fontWeight: '800',
    justifyContent: 'flex-end',
    minWidth: '18px',
    padding: '0 2px 0 3px',
    textAlign: 'right',
  },
  '.cm-lineNumbers .cm-gutterElement:not([style*="height: 0px"])': {
    height: 'var(--codeyo-editor-line-height, 21px) !important',
    minHeight: 'var(--codeyo-editor-line-height, 21px) !important',
  },
  '.cm-foldGutter .cm-gutterElement': {
    boxSizing: 'border-box',
    color: 'var(--codeyo-editor-gutter-fg, #d8bd4b)',
    minWidth: '8px',
    padding: '0 1px',
    width: '8px',
  },
  '.cm-foldGutter .cm-gutterElement:not([style*="height: 0px"])': {
    height: 'var(--codeyo-editor-line-height, 21px) !important',
    minHeight: 'var(--codeyo-editor-line-height, 21px) !important',
  },
  '.cm-activeLine, .cm-activeLineGutter': {
    backgroundColor: 'var(--codeyo-editor-active-line-bg, rgba(255, 229, 142, 0.12))',
  },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: 'var(--codeyo-editor-selection-bg, #e8c547) !important',
    color: 'var(--codeyo-editor-selection-fg, #1a1a1a)',
  },
  '.cm-cursor': {
    borderLeftColor: 'var(--codeyo-editor-accent, #e8c547)',
  },
  '.cm-searchMatch': {
    backgroundColor: 'var(--codeyo-editor-search-bg, #faeab5)',
    color: 'var(--codeyo-editor-search-fg, #1a1a1a)',
    outline: '1px solid var(--codeyo-editor-accent, #e8c547)',
  },
  '.cm-diagnostic-error': {
    borderLeftColor: 'var(--codeyo-editor-error, #ff7a5c)',
  },
  '.cm-diagnostic-warning': {
    borderLeftColor: 'var(--codeyo-editor-warning, #e8c547)',
  },
  '.cm-line.cm-diff-added': {
    backgroundColor: 'var(--codeyo-editor-diff-added-bg, rgba(232, 197, 71, 0.17))',
    boxShadow: 'inset 3px 0 0 var(--codeyo-editor-accent, #e8c547)',
  },
  '.cm-line.cm-diff-removed': {
    backgroundColor: 'var(--codeyo-editor-diff-removed-bg, rgba(255, 122, 92, 0.18))',
    boxShadow: 'inset 3px 0 0 var(--codeyo-editor-error, #ff7a5c)',
  },
  '.cm-panels': {
    backgroundColor: 'var(--codeyo-editor-panel-bg, #f7f1e3)',
    color: 'var(--codeyo-editor-panel-fg, #1a1a1a)',
    fontFamily: 'var(--codeyo-editor-font-family, "JetBrains Mono", monospace)',
    textTransform: 'uppercase',
  },
  '.cm-tooltip .cm-codeyo-hover': {
    backgroundColor: 'var(--codeyo-editor-panel-bg, #f7f1e3)',
    border: '1px solid var(--codeyo-editor-tooltip-border, #2a2620)',
    color: 'var(--codeyo-editor-panel-fg, #1a1a1a)',
    fontFamily: 'var(--codeyo-editor-font-family, "JetBrains Mono", monospace)',
    fontSize: '12px',
    lineHeight: '1.45',
    maxWidth: '420px',
    padding: '8px 10px',
    textTransform: 'none',
    whiteSpace: 'pre-wrap',
  },
});

const editorialHighlightStyle = HighlightStyle.define([
  {
    tag: [tags.keyword, tags.controlKeyword, tags.definitionKeyword, tags.moduleKeyword],
    color: 'var(--codeyo-syntax-keyword, #ff73d7)',
    fontWeight: '800',
  },
  {
    tag: [tags.definition(tags.variableName), tags.function(tags.variableName), tags.function(tags.propertyName)],
    color: 'var(--codeyo-syntax-function, #4ea5ff)',
    fontWeight: '800',
  },
  {
    tag: [tags.variableName, tags.propertyName, tags.name],
    color: 'var(--codeyo-syntax-variable, #fff1bf)',
  },
  {
    tag: [tags.string, tags.character, tags.attributeValue],
    color: 'var(--codeyo-syntax-string, #ff766c)',
  },
  {
    tag: [tags.number, tags.integer, tags.float, tags.bool],
    color: 'var(--codeyo-syntax-number, #45d08d)',
    fontWeight: '800',
  },
  {
    tag: [tags.operator, tags.operatorKeyword, tags.punctuation, tags.bracket],
    color: 'var(--codeyo-syntax-operator, #ffe18e)',
  },
  {
    tag: [tags.comment, tags.lineComment, tags.blockComment, tags.docComment],
    color: 'var(--codeyo-syntax-comment, #6a9955)',
    fontStyle: 'italic',
  },
  {
    tag: tags.meta,
    color: 'var(--codeyo-syntax-meta, #9de07f)',
    fontStyle: 'normal',
  },
  {
    tag: tags.invalid,
    color: 'var(--codeyo-syntax-invalid, #ffb39c)',
    textDecoration: 'underline',
  },
]);
