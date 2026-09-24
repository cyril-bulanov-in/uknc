import type { Palette, RunnableApp } from './types';
import { BasicInterpreter } from './basic';

export class Terminal {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private inputTarget: HTMLInputElement;
  private palette: Palette;
  
  private lines: string[] = [];
  private currentInput: string = '';
  private state: 'BOOT' | 'CLI' = 'BOOT';
  private cursorVisible: boolean = true;
  
  private cursorPos: number = 0;
  private history: string[] = [];
  private historyIndex: number = -1;
  private lastLayerText: string = '';

  private fileSystem = ['BASIC.SAV', 'KLAD.SAV', 'VERTO.SAV', 'TROPA.SAV'];
  private activeApp: RunnableApp | null = null;

  constructor(canvasId: string, inputId: string, palette: Palette) {
    this.canvas = document.getElementById(canvasId) as HTMLCanvasElement;
    this.ctx = this.canvas.getContext('2d')!;
    this.inputTarget = document.getElementById(inputId) as HTMLInputElement;
    this.palette = palette;

    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.initEvents();
    this.bootSequence();

    setInterval(() => {
      if (this.activeApp) {
        this.activeApp.toggleCursor();
        this.activeApp.draw();
      } else {
        this.cursorVisible = !this.cursorVisible;
        if (this.state === 'CLI') this.draw();
      }
    }, 500);
  }

  private resize() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
    this.ctx.imageSmoothingEnabled = false; 
    
    if (this.activeApp) {
      this.activeApp.draw();
    } else if (this.state !== 'BOOT') {
      this.draw();
    }
  }

  private initEvents() {
    document.addEventListener('click', () => {
      // Гениальный фикс: переводим фокус только если пользователь ничего не выделил!
      if (window.getSelection()?.toString() === '') {
        this.inputTarget.focus();
      }
    });
    
    document.addEventListener('keydown', (e) => this.handleKey(e));
    
    document.addEventListener('paste', (e) => {
      const text = e.clipboardData?.getData('text');
      if (text) {
        if (this.activeApp && this.activeApp.handlePaste) {
          this.activeApp.handlePaste(text);
        } else if (this.state === 'CLI') {
          this.currentInput = this.currentInput.slice(0, this.cursorPos) + text.replace(/\r?\n/g, ' ') + this.currentInput.slice(this.cursorPos);
          this.cursorPos += text.length;
          this.draw();
        }
      }
    });
  }

  private handleKey(e: KeyboardEvent) {
    if (this.activeApp) {
      this.activeApp.handleKey(e);
      return;
    }

    if (this.state !== 'CLI') return;
    if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Meta' || e.key === 'Alt') return;

    if (e.key === 'Enter') {
      const input = this.currentInput.trim();
      if (input) {
        this.history.push(input);
        this.historyIndex = this.history.length;
      }
      this.processCommand(input.toUpperCase());
      this.currentInput = '';
      this.cursorPos = 0;
    } else if (e.key === 'Backspace') {
      if (this.cursorPos > 0) {
        this.currentInput = this.currentInput.slice(0, this.cursorPos - 1) + this.currentInput.slice(this.cursorPos);
        this.cursorPos--;
      }
    } else if (e.key === 'Delete') {
      if (this.cursorPos < this.currentInput.length) {
        this.currentInput = this.currentInput.slice(0, this.cursorPos) + this.currentInput.slice(this.cursorPos + 1);
      }
    } else if (e.key === 'ArrowLeft') {
      if (this.cursorPos > 0) this.cursorPos--;
    } else if (e.key === 'ArrowRight') {
      if (this.cursorPos < this.currentInput.length) this.cursorPos++;
    } else if (e.key === 'ArrowUp') {
      if (this.historyIndex > 0) {
        this.historyIndex--;
        this.currentInput = this.history[this.historyIndex];
        this.cursorPos = this.currentInput.length;
      }
    } else if (e.key === 'ArrowDown') {
      if (this.historyIndex < this.history.length - 1) {
        this.historyIndex++;
        this.currentInput = this.history[this.historyIndex];
        this.cursorPos = this.currentInput.length;
      } else {
        this.historyIndex = this.history.length;
        this.currentInput = '';
        this.cursorPos = 0;
      }
    } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) { 
      this.currentInput = this.currentInput.slice(0, this.cursorPos) + e.key + this.currentInput.slice(this.cursorPos);
      this.cursorPos++;
    }
    this.draw();
  }

  private processCommand(cmd: string) {
    this.lines.push(`. ${cmd}`); 
    
    if (cmd === 'CLS') {
      this.lines = ['RT-11SJ (Y) V05.00', ''];
      return;
    } else if (cmd === 'DIR') {
      this.lines.push('');
      this.fileSystem.forEach(file => this.lines.push(`${file.padEnd(14, ' ')} 42  01-Oct-89`));
      this.lines.push('');
    } else if (cmd === 'RU BASIC.SAV' || cmd === 'RU BASIC' || cmd === 'RUN BASIC') {
      this.activeApp = new BasicInterpreter(this.canvas, this.ctx, this.palette);
      this.activeApp.onExit(() => {
        this.activeApp = null;
        this.lines.push('');
        this.draw();
      });
      this.activeApp.draw();
      return;
    } else if (cmd.startsWith('RU ')) {
      const fileName = cmd.split(' ')[1] + '.SAV';
      if (this.fileSystem.includes(fileName)) {
        this.lines.push(`Модуль ${fileName} пока не реализован.`);
      } else {
        this.lines.push('?KMON-F-File not found');
      }
    } else if (cmd !== '') {
      this.lines.push('?KMON-F-Invalid command');
    }
  }

  private wrapText(text: string, maxWidth: number): string[] {
    const wrappedLines: string[] = [];
    let currentLine = '';
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const testLine = currentLine + char;
      if (this.ctx.measureText(testLine).width > maxWidth && i > 0) {
        wrappedLines.push(currentLine);
        currentLine = char;
      } else {
        currentLine = testLine;
      }
    }
    wrappedLines.push(currentLine);
    return wrappedLines;
  }

  private draw() {
    this.ctx.fillStyle = this.palette.bg;
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    this.ctx.fillStyle = this.palette.text;
    this.ctx.font = '12px Monaco, "Courier New", monospace';
    this.ctx.textBaseline = 'top';

    const padding = 10;
    const lineHeight = 16;
    const maxWidth = this.canvas.width - padding * 2;
    const helpHeight = 22;
    const availableHeight = this.canvas.height - helpHeight - padding;
    
    let y = padding;
    const selectionLines: string[] = [];

    const maxVisibleLines = Math.floor(availableHeight / lineHeight) - 2; 
    const allWrappedLines: string[] = [];
    for (const line of this.lines) {
      allWrappedLines.push(...this.wrapText(line, maxWidth));
    }
    const visibleLines = allWrappedLines.slice(-maxVisibleLines);

    for (const wLine of visibleLines) {
      this.ctx.fillText(wLine, padding, y);
      selectionLines.push(wLine);
      y += lineHeight;
    }

    if (this.state === 'CLI') {
      const cursorStr = this.cursorVisible ? '_' : ' ';
      const cmdStrWithCursor = `. ${this.currentInput.slice(0, this.cursorPos)}${cursorStr}${this.currentInput.slice(this.cursorPos)}`;
      const cleanCmdStr = `. ${this.currentInput}`;

      const wrappedCmd = this.wrapText(cmdStrWithCursor, maxWidth);
      for (const wLine of wrappedCmd) {
        this.ctx.fillText(wLine, padding, y);
        y += lineHeight;
      }
      
      const wrappedClean = this.wrapText(cleanCmdStr, maxWidth);
      for (const wLine of wrappedClean) {
        selectionLines.push(wLine);
      }
    }

    const newLayerText = selectionLines.join('\n');
    if (this.lastLayerText !== newLayerText) {
      const layer = document.getElementById('selection-layer');
      if (layer) layer.textContent = newLayerText;
      this.lastLayerText = newLayerText;
    }

    const helpY = this.canvas.height - helpHeight;
    this.ctx.fillStyle = this.palette.text;
    this.ctx.fillRect(0, helpY, this.canvas.width, helpHeight);
    
    this.ctx.fillStyle = this.palette.bg;
    const helpText = "OS HELP:  DIR | CLS | RU BASIC | Select & Copy text enabled";
    this.ctx.fillText(helpText, padding, helpY + 4);
  }

  private bootSequence() {
    this.lines.push('  1. ЗАГРУЗКА ИЗ СЕТИ');
    this.lines.push('  2. ЗАГРУЗКА С ДИСКА');
    this.lines.push('');
    this.draw();

    setTimeout(() => {
      this.lines = ['RT-11SJ (Y) V05.00', ''];
      this.state = 'CLI';
      this.draw();
    }, 2000); 
  }
}