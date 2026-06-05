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
import { cpp } from '@codemirror/lang-cpp';
import { python } from '@codemirror/lang-python';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { Diagnostic, setDiagnostics } from '@codemirror/lint';
import { Compartment, EditorState, Extension } from '@codemirror/state';
import { Decoration, EditorView } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { EditorDiagnostic, EditorLanguage } from './desktop-api';

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
  @Input() diffLines: number[] = [];
  @Input() diffKind: 'added' | 'removed' | null = null;
  @Output() readonly contentChange = new EventEmitter<string>();

  private view?: EditorView;
  private applyingExternalChange = false;
  private readonly languageCompartment = new Compartment();
  private readonly readOnlyCompartment = new Compartment();
  private readonly diffCompartment = new Compartment();

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
          this.languageCompartment.of(this.languageExtension()),
          this.readOnlyCompartment.of(this.readOnlyExtensions()),
          this.diffCompartment.of(this.diffExtension()),
          syntaxHighlighting(editorialHighlightStyle),
          editorialEditorTheme,
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !this.applyingExternalChange) {
              this.contentChange.emit(update.state.doc.toString());
            }
          }),
        ],
      }),
    });
    this.applyDiagnostics();
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
    if (changes['language']) {
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
  }

  ngOnDestroy(): void {
    this.view?.destroy();
  }

  private languageExtension(): Extension {
    if (this.language === 'python') {
      return python();
    }
    if (this.language === 'cpp') {
      return cpp();
    }
    return [];
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
      return {
        from,
        to: Math.min(line.to, from + 1),
        severity: diagnostic.severity,
        message: diagnostic.message,
      };
    });
    this.view.dispatch(setDiagnostics(this.view.state, mapped));
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
  }
}

const editorialEditorTheme = EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: '#1a1a1a',
    color: '#fff1bf',
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: 'var(--codeyo-editor-font-size, 13.5px)',
  },
  '.cm-scroller': {
    overflow: 'auto',
    lineHeight: 'var(--codeyo-editor-line-height, 21px)',
  },
  '.cm-content': {
    caretColor: '#e8c547',
    padding: 'var(--codeyo-editor-y-padding, 9px) 0',
  },
  '.cm-line': {
    lineHeight: 'var(--codeyo-editor-line-height, 21px)',
    minHeight: 'var(--codeyo-editor-line-height, 21px)',
    paddingLeft: '7px',
  },
  '.cm-gutters': {
    backgroundColor: '#111111',
    borderRight: '1px solid rgba(232, 197, 71, 0.82)',
    color: '#d8bd4b',
    paddingTop: '0',
  },
  '.cm-gutterElement': {
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
    minHeight: 'var(--codeyo-editor-line-height, 21px)',
  },
  '.cm-foldGutter .cm-gutterElement': {
    boxSizing: 'border-box',
    color: '#d8bd4b',
    minWidth: '8px',
    padding: '0 1px',
    width: '8px',
  },
  '.cm-foldGutter .cm-gutterElement:not([style*="height: 0px"])': {
    minHeight: 'var(--codeyo-editor-line-height, 21px)',
  },
  '.cm-activeLine, .cm-activeLineGutter': {
    backgroundColor: 'rgba(255, 229, 142, 0.12)',
  },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: '#e8c547 !important',
    color: '#1a1a1a',
  },
  '.cm-cursor': {
    borderLeftColor: '#e8c547',
  },
  '.cm-searchMatch': {
    backgroundColor: '#faeab5',
    color: '#1a1a1a',
    outline: '1px solid #e8c547',
  },
  '.cm-diagnostic-error': {
    borderLeftColor: '#ff7a5c',
  },
  '.cm-diagnostic-warning': {
    borderLeftColor: '#e8c547',
  },
  '.cm-line.cm-diff-added': {
    backgroundColor: 'rgba(232, 197, 71, 0.17)',
    boxShadow: 'inset 3px 0 0 #e8c547',
  },
  '.cm-line.cm-diff-removed': {
    backgroundColor: 'rgba(255, 122, 92, 0.18)',
    boxShadow: 'inset 3px 0 0 #ff7a5c',
  },
  '.cm-panels': {
    backgroundColor: '#f7f1e3',
    color: '#1a1a1a',
    fontFamily: '"JetBrains Mono", monospace',
    textTransform: 'uppercase',
  },
});

const editorialHighlightStyle = HighlightStyle.define([
  {
    tag: [tags.keyword, tags.controlKeyword, tags.definitionKeyword, tags.moduleKeyword],
    color: '#ff73d7',
    fontWeight: '800',
  },
  {
    tag: [tags.definition(tags.variableName), tags.function(tags.variableName), tags.function(tags.propertyName)],
    color: '#4ea5ff',
    fontWeight: '800',
  },
  {
    tag: [tags.variableName, tags.propertyName, tags.name],
    color: '#fff1bf',
  },
  {
    tag: [tags.string, tags.character, tags.attributeValue],
    color: '#ff766c',
  },
  {
    tag: [tags.number, tags.integer, tags.float, tags.bool],
    color: '#45d08d',
    fontWeight: '800',
  },
  {
    tag: [tags.operator, tags.operatorKeyword, tags.punctuation, tags.bracket],
    color: '#ffe18e',
  },
  {
    tag: [tags.meta, tags.comment],
    color: '#9de07f',
    fontStyle: 'normal',
  },
  {
    tag: tags.invalid,
    color: '#ffb39c',
    textDecoration: 'underline',
  },
]);
