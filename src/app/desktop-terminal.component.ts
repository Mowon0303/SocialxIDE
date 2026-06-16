import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  ElementRef,
  Input,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import type { FitAddon as XtermFitAddon } from '@xterm/addon-fit';
import type { Terminal as XtermTerminal } from '@xterm/xterm';
import { TerminalSession, WorkspaceHandle } from './desktop-api';
import { EmptyStateComponent } from './panels/empty-state.component';

interface VisibleSession extends TerminalSession {
  buffer: string;
  exitCode?: number;
}

@Component({
  selector: 'codeyo-terminal',
  standalone: true,
  imports: [EmptyStateComponent],
  template: `
    <div class="terminal-session-bar">
      @for (session of sessions; track session.id) {
        <div
          class="terminal-tab"
          [class.active]="activeSessionId === session.id"
          [class.exited]="session.status === 'exited'"
        >
          @if (renamingSessionId === session.id) {
            <form class="terminal-rename" (submit)="commitRename(session.id); $event.preventDefault()">
              <input
                type="text"
                aria-label="Rename terminal tab"
                autofocus
                [value]="renameDraft"
                (input)="updateRenameDraft($event)"
                (keydown.escape)="cancelRename(); $event.preventDefault()"
              />
              <button type="submit">ok</button>
            </form>
          } @else {
            <button
              class="terminal-tab-main"
              type="button"
              [attr.data-testid]="session.id.startsWith('task-') ? 'terminal-task-tab' : 'terminal-shell-tab'"
              (click)="activate(session.id)"
              (dblclick)="startRename(session)"
            >
              <span>{{ session.title }}</span>
              <small>{{ sessionStatusLabel(session) }}</small>
            </button>
            <button class="terminal-tab-action" type="button" [attr.aria-label]="'Rename ' + session.title" (click)="startRename(session)">r</button>
            <button class="terminal-tab-action" type="button" [attr.aria-label]="'Close ' + session.title" (click)="close(session.id)">x</button>
          }
        </div>
      }
      <button class="terminal-new" type="button" [disabled]="!enabled || creatingSession" (click)="newSession()">+</button>
    </div>
    <div class="terminal-status-strip" data-testid="terminal-status" [class.disabled]="!enabled">
      <span>{{ terminalModeLabel }}</span>
      <span>shell {{ terminalShellLabel }}</span>
      <span>cwd {{ terminalCwdLabel }}</span>
      <span>{{ terminalStateLabel }}</span>
    </div>
    @if (terminalNotice) {
      <div class="terminal-notice">{{ terminalNotice }}</div>
    }
    @if (!enabled) {
      <codeyo-empty-state
        label="Terminal"
        [title]="workspace ? 'Workspace not trusted' : 'No workspace'"
        [message]="workspace ? 'Trust this folder before starting an interactive shell.' : 'Open a trusted workspace before starting a terminal session.'"
        [details]="workspace?.rootPath || 'Terminal is disabled outside Electron workspace mode.'"
        variant="warning"
      />
    }
    <div #host class="desktop-terminal-host" data-testid="terminal-host" [class.is-disabled]="!enabled"></div>
  `,
  styleUrl: './desktop-terminal.component.css',
})
export class DesktopTerminalComponent implements AfterViewInit, OnChanges, OnDestroy {
  @ViewChild('host', { static: true }) private host?: ElementRef<HTMLDivElement>;
  @Input() workspace: WorkspaceHandle | null = null;
  @Input() enabled = false;
  @Input() taskTitle = '';
  @Input() taskTranscript: string[] = [];
  @Input() taskSequence = 0;
  @Input() visible = true;

  sessions: VisibleSession[] = [];
  activeSessionId = '';
  renamingSessionId = '';
  renameDraft = '';
  terminalNotice = '';
  creatingSession = false;

  private terminal?: XtermTerminal;
  private fitAddon?: XtermFitAddon;
  private removeDataListener?: () => void;
  private removeExitListener?: () => void;
  private removeWindowResizeListener?: () => void;
  private renderedTaskSequence = 0;
  private readonly maxVisibleSessionBuffer = 200000;

  constructor(private readonly changeDetector: ChangeDetectorRef) {}

  get activeSession(): VisibleSession | undefined {
    return this.sessions.find((session) => session.id === this.activeSessionId);
  }

  get terminalModeLabel(): string {
    if (!this.workspace) {
      return 'NO WORKSPACE';
    }
    if (!this.enabled) {
      return 'TERMINAL DISABLED';
    }
    return this.activeSession?.id.startsWith('task-') ? 'RUN OUTPUT' : 'REAL TERMINAL';
  }

  get terminalShellLabel(): string {
    const shell = this.activeSession?.shell;
    if (!shell) {
      return this.enabled ? 'starting' : 'locked';
    }
    if (shell === 'task') {
      return 'task';
    }
    const normalized = shell.replace(/\\/g, '/');
    return normalized.split('/').pop() || shell;
  }

  get terminalCwdLabel(): string {
    const cwd = this.activeSession?.cwd || this.workspace?.rootPath;
    return cwd ? this.compactPath(cwd) : 'none';
  }

  get terminalStateLabel(): string {
    const session = this.activeSession;
    if (!session) {
      return this.enabled ? 'NO SESSION' : 'UNTRUSTED';
    }
    if (session.status === 'exited') {
      return session.exitCode === undefined ? 'EXITED' : `EXIT ${session.exitCode}`;
    }
    return session.id.startsWith('task-') ? 'CAPTURED' : 'RUNNING';
  }

  ngAfterViewInit(): void {
    if (!this.host) {
      return;
    }
    void this.setupTerminal().catch((error) => {
      this.reportTerminalFailure(error, 'TERMINAL VIEW FAILED');
    });
  }

  private async setupTerminal(): Promise<void> {
    if (!this.host) {
      return;
    }
    const [{ Terminal }, { FitAddon }] = await Promise.all([
      import('@xterm/xterm'),
      import('@xterm/addon-fit'),
    ]);
    this.terminal = new Terminal({
      convertEol: true,
      cursorBlink: true,
      cursorStyle: 'bar',
      fontFamily: '"JetBrains Mono", monospace',
      fontSize: 11,
      lineHeight: 1.35,
      theme: {
        background: '#1a1a1a',
        foreground: '#e8c547',
        cursor: '#faeab5',
        selectionBackground: '#e8c54755',
      },
    });
    this.fitAddon = new FitAddon();
    this.terminal.loadAddon(this.fitAddon);
    this.terminal.open(this.host.nativeElement);
    this.fitAddon.fit();
    this.syncActiveTerminalSize();
    const resizeListener = () => {
      this.fitAddon?.fit();
      this.syncActiveTerminalSize();
    };
    window.addEventListener('resize', resizeListener);
    this.removeWindowResizeListener = () => window.removeEventListener('resize', resizeListener);
    this.terminal.onData((data) => {
      if (this.workspace?.id && this.activeSessionId && !this.activeSessionId.startsWith('task-')) {
        void this.writeActiveSession(data);
      }
    });
    this.removeDataListener = window.codeyo?.terminal.onData(({ sessionId, data }) => {
      const session = this.sessions.find((candidate) => candidate.id === sessionId);
      if (!session) {
        return;
      }
      this.appendSessionBuffer(session, data);
      if (sessionId === this.activeSessionId) {
        this.terminal?.write(data);
      }
    });
    this.removeExitListener = window.codeyo?.terminal.onExit(({ sessionId, exitCode }) => {
      const session = this.sessions.find((candidate) => candidate.id === sessionId);
      if (session) {
        session.status = 'exited';
        session.exitCode = exitCode;
        this.appendSessionBuffer(session, `\r\n[PROCESS EXITED ${exitCode}]\r\n`);
        this.terminalNotice = `${session.title} EXITED WITH ${exitCode}`;
        if (sessionId === this.activeSessionId) {
          this.terminal?.write(`\r\n[PROCESS EXITED ${exitCode}]\r\n`);
        }
        this.changeDetector.markForCheck();
      }
    });
    if (this.enabled) {
      void this.restoreWorkspaceSessions(!this.taskTranscript.length);
    }
    this.renderTaskOutput();
  }

  ngOnChanges(changes: SimpleChanges): void {
    const switchedWorkspace = changes['workspace'] && !changes['workspace'].firstChange &&
      changes['workspace'].previousValue?.id !== changes['workspace'].currentValue?.id;
    if (switchedWorkspace) {
      const previousWorkspaceId = changes['workspace'].previousValue?.id;
      for (const session of this.sessions) {
        if (previousWorkspaceId && !session.id.startsWith('task-')) {
          void this.killRemoteSession(previousWorkspaceId, session.id);
        }
      }
      this.sessions = [];
      this.activeSessionId = '';
      this.renderedTaskSequence = 0;
      this.terminal?.reset();
      if (this.enabled && this.terminal) {
        void this.newSession();
      }
    }
    if (!switchedWorkspace && changes['enabled'] && this.enabled && this.terminal && this.sessions.length === 0) {
      void this.restoreWorkspaceSessions();
    }
    if (changes['taskSequence']) {
      this.renderTaskOutput();
    }
    if (changes['visible'] && this.visible) {
      queueMicrotask(() => {
        this.fitAddon?.fit();
        this.syncActiveTerminalSize();
      });
    }
  }

  ngOnDestroy(): void {
    this.removeDataListener?.();
    this.removeExitListener?.();
    this.removeWindowResizeListener?.();
    for (const session of this.sessions) {
      if (this.workspace?.id && !session.id.startsWith('task-')) {
        void this.killRemoteSession(this.workspace.id, session.id);
      }
    }
    this.terminal?.dispose();
  }

  async newSession(activateOnCreate = true): Promise<void> {
    if (!this.enabled || !this.workspace || !window.codeyo) {
      return;
    }
    this.creatingSession = true;
    this.terminalNotice = '';
    try {
      const created = await window.codeyo.terminal.create(
        this.workspace.id,
        `Shell ${this.nextShellNumber()}`,
      );
      this.sessions.push({ ...created, buffer: this.boundedSessionBuffer(created.buffer ?? '') });
      if (activateOnCreate) {
        this.activate(created.id);
      }
    } catch (error) {
      this.terminalNotice = this.formatError(error, 'TERMINAL CREATE FAILED');
    } finally {
      this.creatingSession = false;
      this.changeDetector.markForCheck();
    }
  }

  async restoreWorkspaceSessions(activateOnRestore = true): Promise<void> {
    if (!this.enabled || !this.workspace || !window.codeyo) {
      return;
    }
    this.terminalNotice = '';
    try {
      const restored = await window.codeyo.terminal.list(this.workspace.id);
      this.sessions = restored.map((session) => ({
        ...session,
        buffer: this.boundedSessionBuffer(session.buffer ?? ''),
      }));
      if (this.sessions.length > 0) {
        if (activateOnRestore) {
          this.activate(this.sessions[0].id);
        }
        this.terminalNotice = `RESTORED ${this.sessions.length} TERMINAL SESSION${this.sessions.length === 1 ? '' : 'S'}`;
      } else {
        await this.newSession(activateOnRestore);
      }
    } catch (error) {
      this.terminalNotice = this.formatError(error, 'TERMINAL RESTORE FAILED');
      if (this.sessions.length === 0) {
        await this.newSession(activateOnRestore);
      }
    } finally {
      this.changeDetector.markForCheck();
    }
  }

  activate(sessionId: string): void {
    this.cancelRename();
    this.activeSessionId = sessionId;
    const session = this.sessions.find((candidate) => candidate.id === sessionId);
    this.terminal?.reset();
    if (session?.buffer) {
      this.terminal?.write(session.buffer);
    }
    this.fitAddon?.fit();
    this.syncActiveTerminalSize();
  }

  async close(sessionId: string): Promise<void> {
    if (this.renamingSessionId === sessionId) {
      this.cancelRename();
    }
    if (this.workspace?.id && !sessionId.startsWith('task-')) {
      const killed = await this.killRemoteSession(this.workspace.id, sessionId);
      if (!killed) {
        this.changeDetector.markForCheck();
        return;
      }
    }
    this.sessions = this.sessions.filter((candidate) => candidate.id !== sessionId);
    if (this.activeSessionId === sessionId) {
      this.activeSessionId = this.sessions[0]?.id ?? '';
      if (this.activeSessionId) {
        this.activate(this.activeSessionId);
      } else {
        this.terminal?.reset();
      }
    }
    this.changeDetector.markForCheck();
  }

  startRename(session: VisibleSession): void {
    this.renamingSessionId = session.id;
    this.renameDraft = session.title;
    this.activeSessionId = session.id;
    this.changeDetector.markForCheck();
  }

  updateRenameDraft(event: Event): void {
    this.renameDraft = (event.target as HTMLInputElement).value;
  }

  async commitRename(sessionId: string): Promise<void> {
    const session = this.sessions.find((candidate) => candidate.id === sessionId);
    const title = this.sanitizeTerminalTitle(this.renameDraft);
    if (session) {
      const previousTitle = session.title;
      session.title = title;
      this.terminalNotice = `RENAMED TERMINAL · ${session.title}`;
      if (this.workspace?.id && !session.id.startsWith('task-')) {
        try {
          const result = await window.codeyo?.terminal.rename(this.workspace.id, session.id, session.title);
          if (result?.title) {
            session.title = result.title;
            this.terminalNotice = `RENAMED TERMINAL · ${session.title}`;
          }
        } catch (error) {
          session.title = previousTitle;
          this.terminalNotice = this.formatError(error, 'TERMINAL RENAME FAILED');
        }
      }
    }
    this.cancelRename();
    this.changeDetector.markForCheck();
  }

  cancelRename(): void {
    this.renamingSessionId = '';
    this.renameDraft = '';
  }

  sessionStatusLabel(session: VisibleSession): string {
    if (session.status === 'exited') {
      return session.exitCode === undefined ? 'DONE' : `EXIT ${session.exitCode}`;
    }
    return 'RUNNING';
  }

  private renderTaskOutput(): void {
    if (!this.terminal || !this.workspace || this.taskSequence <= this.renderedTaskSequence || !this.taskTranscript.length) {
      return;
    }
    const id = `task-${this.taskSequence}`;
    this.sessions.push({
      id,
      title: `Task · ${this.taskTitle || 'Run'}`,
      cwd: this.workspace.rootPath,
      shell: 'task',
      status: 'exited',
      exitCode: 0,
      buffer: this.boundedSessionBuffer(`${this.taskTranscript.join('\r\n')}\r\n`),
    });
    this.renderedTaskSequence = this.taskSequence;
    this.activate(id);
    this.changeDetector.markForCheck();
  }

  private nextShellNumber(): number {
    return this.sessions.filter((session) => !session.id.startsWith('task-')).length + 1;
  }

  private syncActiveTerminalSize(): void {
    if (!this.workspace?.id || !this.terminal || !this.activeSessionId || this.activeSessionId.startsWith('task-')) {
      return;
    }
    void this.resizeActiveSession(this.terminal.cols, this.terminal.rows);
  }

  private async writeActiveSession(data: string): Promise<void> {
    if (!this.workspace?.id || !this.activeSessionId || this.activeSessionId.startsWith('task-') || !window.codeyo) {
      return;
    }
    try {
      await window.codeyo.terminal.write(this.workspace.id, this.activeSessionId, data);
    } catch (error) {
      this.reportTerminalFailure(error, 'TERMINAL WRITE FAILED');
    }
  }

  private async resizeActiveSession(cols: number, rows: number): Promise<void> {
    if (!this.workspace?.id || !this.activeSessionId || this.activeSessionId.startsWith('task-') || !window.codeyo) {
      return;
    }
    try {
      await window.codeyo.terminal.resize(this.workspace.id, this.activeSessionId, cols, rows);
    } catch (error) {
      this.reportTerminalFailure(error, 'TERMINAL RESIZE FAILED');
    }
  }

  private async killRemoteSession(workspaceId: string, sessionId: string): Promise<boolean> {
    if (!window.codeyo) {
      return true;
    }
    try {
      await window.codeyo.terminal.kill(workspaceId, sessionId);
      return true;
    } catch (error) {
      this.reportTerminalFailure(error, 'TERMINAL CLOSE FAILED');
      return false;
    }
  }

  private reportTerminalFailure(error: unknown, fallback: string): void {
    this.terminalNotice = this.formatError(error, fallback);
    this.changeDetector.markForCheck();
  }

  private appendSessionBuffer(session: VisibleSession, data: string): void {
    session.buffer = this.boundedSessionBuffer(`${session.buffer}${data}`);
  }

  private boundedSessionBuffer(buffer: string): string {
    return buffer.length > this.maxVisibleSessionBuffer
      ? buffer.slice(buffer.length - this.maxVisibleSessionBuffer)
      : buffer;
  }

  private sanitizeTerminalTitle(title: string): string {
    return (title.replace(/\s+/g, ' ').trim() || 'Shell').slice(0, 40);
  }

  private compactPath(value: string): string {
    const normalized = value.replace(/\\/g, '/');
    const parts = normalized.split('/').filter(Boolean);
    if (parts.length <= 3) {
      return value;
    }
    return `.../${parts.slice(-3).join('/')}`;
  }

  private formatError(error: unknown, fallback: string): string {
    const message = error instanceof Error ? error.message : String(error || fallback);
    return `${fallback} · ${message}`.toUpperCase();
  }
}
