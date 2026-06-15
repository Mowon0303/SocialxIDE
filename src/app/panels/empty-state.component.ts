import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'codeyo-empty-state',
  standalone: true,
  template: `
    <article class="empty-state" [class.warning]="variant === 'warning'" [class.danger]="variant === 'danger'">
      <span>{{ label }}</span>
      <h3>{{ title }}</h3>
      <p>{{ message }}</p>
      @if (details) {
        <small>{{ details }}</small>
      }
      @if (actionLabel) {
        <button type="button" (click)="action.emit()">{{ actionLabel }}</button>
      }
    </article>
  `,
  styles: [`
    .empty-state {
      border: 1px solid var(--el-hairline-strong, rgba(250, 234, 181, 0.42));
      display: grid;
      gap: 7px;
      margin: 10px;
      max-width: 560px;
      padding: 12px 14px;
    }

    .empty-state span,
    .empty-state small,
    .empty-state button {
      font-family: "JetBrains Mono", monospace;
      font-size: 9px;
      font-weight: 900;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .empty-state span {
      color: var(--el-amber-deep, #e8c547);
    }

    .empty-state h3 {
      color: var(--el-ink, #faeab5);
      font-family: "Fraunces", Georgia, serif;
      font-size: 28px;
      font-weight: 500;
      line-height: 1;
      margin: 0;
    }

    .empty-state p,
    .empty-state small {
      color: var(--el-ink-2, rgba(250, 234, 181, 0.78));
      margin: 0;
    }

    .empty-state button {
      background: var(--el-amber, #e8c547);
      border: 1px solid var(--el-amber, #e8c547);
      color: var(--el-ink, #211f1c);
      cursor: pointer;
      justify-self: start;
      min-height: 30px;
      padding: 0 12px;
    }

    .empty-state.warning {
      border-color: var(--el-peach, #ff8d74);
    }

    .empty-state.danger span {
      color: var(--el-danger, #ff8d74);
    }

    :host-context(.console-surface) .empty-state,
    :host-context(codeyo-terminal) .empty-state {
      border-color: rgba(250, 234, 181, 0.42);
    }

    :host-context(.console-surface) .empty-state h3,
    :host-context(codeyo-terminal) .empty-state h3 {
      color: #faeab5;
    }

    :host-context(.console-surface) .empty-state p,
    :host-context(.console-surface) .empty-state small,
    :host-context(codeyo-terminal) .empty-state p,
    :host-context(codeyo-terminal) .empty-state small {
      color: rgba(250, 234, 181, 0.78);
    }
  `],
})
export class EmptyStateComponent {
  @Input() label = 'State';
  @Input() title = 'Nothing here';
  @Input() message = '';
  @Input() details = '';
  @Input() actionLabel = '';
  @Input() variant: 'default' | 'warning' | 'danger' = 'default';
  @Output() action = new EventEmitter<void>();
}
