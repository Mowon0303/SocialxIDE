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
import { Diagnostic, setDiagnostics } from '@codemirror/lint';
import { Compartment, EditorState, Extension } from '@codemirror/state';
import { Decoration, EditorView } from '@codemirror/view';
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
    color: '#faeab5',
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: '13.5px',
  },
  '.cm-scroller': {
    overflow: 'auto',
    lineHeight: '1.72',
  },
  '.cm-content': {
    caretColor: '#e8c547',
    padding: '14px 0',
  },
  '.cm-line': {
    paddingLeft: '16px',
  },
  '.cm-gutters': {
    backgroundColor: '#141414',
    borderRight: '1.5px solid #b89a2c',
    color: '#b89a2c',
    paddingTop: '14px',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    padding: '0 15px 0 16px',
    fontWeight: '800',
  },
  '.cm-activeLine, .cm-activeLineGutter': {
    backgroundColor: 'rgba(232, 197, 71, 0.09)',
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
