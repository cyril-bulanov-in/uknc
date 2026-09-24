import type { Palette, RunnableApp } from './types';

interface GraphicCmd {
  type: 'LINE' | 'RECT';
  args: number[];
  color: string;
}

export class BasicInterpreter implements RunnableApp {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private palette: Palette;
  private exitCallback: (() => void) | null = null;

  public lines: string[] = ['Ok'];
  private currentInput: string = '';
  private cursorVisible: boolean = true;
  private currentLang: string = 'ЛАТ';
  
  private cursorPos: number = 0;
  private history: string[] = [];
  private historyIndex: number = -1;
  private lastLayerText: string = '';
  
  private programMemory: Map<number, string> = new Map();
  private vars: Map<string, any> = new Map();
  private graphicsBuffer: GraphicCmd[] = [];
  
  private currentGraphicsColor: string;
  private readonly shades = ['#000000', '#242424', '#494949', '#6D6D6D', '#929292', '#B6B6B6', '#DBDBDB', '#FFFFFF'];

  private static virtualTape: Map<string, Map<number, string>> = new Map();
  
  private execState = {
    running: false,
    headless: false,
    lineKeys: [] as number[],
    currentIndex: 0,
    jumped: false, // Флаг для отслеживания прыжков по коду
    waitingForInput: null as string | null,
    callStack: [] as number[],
    dataBuffer: [] as any[],
  };

  constructor(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, palette: Palette) {
    this.canvas = canvas;
    this.ctx = ctx;
    this.palette = palette;
    this.currentGraphicsColor = palette.text; 
  }

  public onExit(callback: () => void) {
    this.exitCallback = callback;
  }

  public toggleCursor() {
    this.cursorVisible = !this.cursorVisible;
  }

  public handlePaste(text: string) {
    const pastedLines = text.split(/\r?\n/);
    for (const line of pastedLines) {
      if (line.trim()) this.processCommand(line.trim());
    }
    if (!this.execState.headless) this.draw();
  }

  public handleKey(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c') {
      const selection = window.getSelection()?.toString();
      if (!selection) {
        const sortedKeys = Array.from(this.programMemory.keys()).sort((a, b) => a - b);
        const code = sortedKeys.map(k => `${k} ${this.programMemory.get(k)}`).join('\n');
        navigator.clipboard.writeText(code).then(() => {
          this.lines.push('?COPIED ENTIRE PROGRAM TO CLIPBOARD');
          this.draw();
        });
        return;
      }
    }
    
    if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Meta' || e.key === 'Alt') return;

    if (e.key === 'Enter') {
      const input = this.currentInput.trim();
      
      if (input) {
        this.history.push(input);
        this.historyIndex = this.history.length;
      }

      if (this.execState.waitingForInput) {
        this.lines[this.lines.length - 1] += input; 
        const val = isNaN(Number(input)) ? input : Number(input);
        
        const arrayMatch = this.execState.waitingForInput.match(/^([A-Z_][A-Z0-9_]*)\s*\(([^)]+)\)$/i);
        if (arrayMatch) {
          const arrName = arrayMatch[1].toUpperCase();
          const index = Math.floor(this.evalExpr(arrayMatch[2]));
          const arr = this.vars.get(arrName);
          if (Array.isArray(arr)) {
            arr[index] = val;
          }
        } else {
          this.vars.set(this.execState.waitingForInput, val);
        }
        
        this.currentInput = '';
        this.cursorPos = 0;
        this.execState.waitingForInput = null;
        this.execState.currentIndex++;
        this.step();
        return;
      }

      this.processCommand(input);
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
      if (/[а-яА-ЯёЁ]/.test(e.key)) this.currentLang = 'РУС';
      else if (/[a-zA-Z]/.test(e.key) || e.key.toLowerCase() !== e.key.toUpperCase()) this.currentLang = 'ЛАТ';
      
      this.currentInput = this.currentInput.slice(0, this.cursorPos) + e.key + this.currentInput.slice(this.cursorPos);
      this.cursorPos++;
    }
    this.draw();
  }

  public runHeadless(programCode: string): string[] {
    this.execState.headless = true;
    this.lines = [];
    this.programMemory.clear();
    
    programCode.split('\n').forEach(line => {
      if (line.trim()) this.processCommand(line.trim());
    });
    
    this.processCommand('RUN');
    
    while (this.execState.running && !this.execState.waitingForInput) {
      this.step();
    }
    
    this.execState.headless = false;
    return [...this.lines].filter(l => l !== 'Ok');
  }

  // Метод только для тестов
  public getGraphicsBuffer() {
    return this.graphicsBuffer;
  }

  private evalExpr(expr: string): any {
    let parsed = expr;

    parsed = parsed.replace(/<>/g, '!=='); 
    parsed = parsed.replace(/([^<>=!])=([^=])/g, '$1===$2'); 
    parsed = parsed.replace(/^=/, '==='); 
    parsed = parsed.replace(/\bAND\b/gi, '&&');
    parsed = parsed.replace(/\bOR\b/gi, '||');
    parsed = parsed.replace(/\bNOT\b/gi, '!');
    
    parsed = parsed.replace(/([A-Z_][A-Z0-9_]*)\s*\(([^)]+)\)/gi, '$1[$2]');

    const keys: string[] = [];
    const values: any[] = [];
    this.vars.forEach((v, k) => {
      if (/^[A-Z_][A-Z0-9_]*$/i.test(k)) {
        keys.push(k);
        values.push(v);
      }
    });
    
    try {
      const fn = new Function(...keys, `return (${parsed});`);
      return fn(...values);
    } catch (e) {
      return 0; 
    }
  }

  private processCommand(cmd: string) {
    if (!this.execState.running && !this.execState.headless) this.lines.push(cmd);
    if (!cmd) return;

    const lineNumMatch = cmd.match(/^(\d+)\s+(.*)$/);
    if (lineNumMatch) {
      const lineNum = parseInt(lineNumMatch[1], 10);
      this.programMemory.set(lineNum, lineNumMatch[2]);
      return;
    }

    const upperCmd = cmd.toUpperCase();
    
    if (upperCmd === 'SYSTEM' || upperCmd === 'BYE') {
      if (this.exitCallback) this.exitCallback();
    } else if (upperCmd === 'LIST') {
      Array.from(this.programMemory.keys()).sort((a, b) => a - b)
        .forEach(k => this.lines.push(`${k} ${this.programMemory.get(k)}`));
      if (!this.execState.headless) this.lines.push('Ok');
    } else if (upperCmd === 'NEW') {
      this.programMemory.clear();
      this.vars.clear();
      this.graphicsBuffer = [];
      if (!this.execState.headless) this.lines.push('Ok');
    } else if (upperCmd.startsWith('EDIT ')) {
      const targetLine = parseInt(upperCmd.substring(5).trim(), 10);
      const code = this.programMemory.get(targetLine);
      if (code !== undefined) {
        this.currentInput = `${targetLine} ${code}`;
        this.cursorPos = this.currentInput.length;
      } else {
        this.lines.push('?LINE NOT FOUND');
      }
    } else if (upperCmd.startsWith('SAVE ')) {
      const match = upperCmd.match(/^SAVE\s+"([^"]*)"$/);
      if (match) {
        BasicInterpreter.virtualTape.set(match[1], new Map(this.programMemory));
        if (!this.execState.headless) this.lines.push('Ok');
      } else {
        this.lines.push('?SYNTAX ERROR');
      }
    } else if (upperCmd.startsWith('LOAD ')) {
      const match = upperCmd.match(/^LOAD\s+"([^"]*)"$/);
      if (match) {
        const savedMap = BasicInterpreter.virtualTape.get(match[1]);
        if (savedMap) {
          this.programMemory = new Map(savedMap);
          if (!this.execState.headless) this.lines.push('Ok');
        } else {
          this.lines.push('?FILE NOT FOUND');
        }
      } else {
        this.lines.push('?SYNTAX ERROR');
      }
    } else if (upperCmd === 'RUN') {
      this.vars.clear();
      this.graphicsBuffer = [];
      this.execState.lineKeys = Array.from(this.programMemory.keys()).sort((a, b) => a - b);
      this.execState.currentIndex = 0;
      this.execState.callStack = [];
      this.execState.dataBuffer = [];
      this.execState.running = true;
      
      for (const k of this.execState.lineKeys) {
        const c = this.programMemory.get(k) || '';
        if (c.toUpperCase().startsWith('DATA ')) {
          const items = c.substring(5).split(',').map(s => {
            const val = s.trim();
            return isNaN(Number(val)) ? val : Number(val);
          });
          this.execState.dataBuffer.push(...items);
        }
      }
      
      this.step();
    } else {
      this.executeStatement(cmd);
      if (!this.execState.running && !this.execState.waitingForInput && !upperCmd.startsWith('EDIT') && !this.execState.headless) {
        this.lines.push('Ok');
      }
    }
  }

  // ТУРБО-ДВИЖОК: Выполняем пачку инструкций за один кадр
  private step() {
    if (!this.execState.running) return;

    const opsLimit = 2000;
    let ops = 0;

    while (this.execState.currentIndex < this.execState.lineKeys.length) {
      const currentLineNum = this.execState.lineKeys[this.execState.currentIndex];
      const code = this.programMemory.get(currentLineNum) || '';
      
      this.execState.jumped = false; // Сбрасываем флаг прыжка
      this.executeStatement(code);
      
      if (!this.execState.running || this.execState.waitingForInput) {
        if (!this.execState.headless) this.draw();
        return; 
      }
      
      // Инкрементируем, только если команда не вызвала прыжок
      if (!this.execState.jumped) {
        this.execState.currentIndex++;
      }

      ops++;
      // Отдаем управление браузеру раз в 2000 команд, чтобы не зависала вкладка
      if (ops >= opsLimit && !this.execState.headless) {
        this.draw(); // Отрисовываем промежуточный результат (например, PRINT в цикле)
        setTimeout(() => {
          if (this.execState.running) this.step();
        }, 0);
        return;
      }
    }
    
    this.execState.running = false;
    if (!this.execState.headless) {
      this.lines.push('Ok');
      this.draw();
    }
  }

  private executeGoto(targetLine: number) {
    const targetIndex = this.execState.lineKeys.indexOf(targetLine);
    if (targetIndex !== -1) {
      this.execState.currentIndex = targetIndex;
      this.execState.jumped = true; // Сообщаем циклу step(), что мы перепрыгнули
    } else {
      this.lines.push('?LINE NOT FOUND ERROR');
      this.execState.running = false;
    }
  }

  private executeStatement(code: string) {
    const stmt = code.trim();
    const upper = stmt.toUpperCase();

    const arrayMatch = stmt.match(/^(?:LET\s+)?([A-Z_][A-Z0-9_]*)\s*\(([^)]+)\)\s*=\s*(.+)$/i);
    if (arrayMatch) {
      const varName = arrayMatch[1].toUpperCase();
      const index = Math.floor(this.evalExpr(arrayMatch[2]));
      const value = this.evalExpr(arrayMatch[3]);
      
      const arr = this.vars.get(varName);
      if (Array.isArray(arr)) {
        arr[index] = value;
      } else {
        this.lines.push('?DIM ERROR');
        this.execState.running = false;
      }
      return; 
    }

    if (upper.startsWith('PRINT ')) {
      const expr = stmt.substring(6).trim();
      if (expr.startsWith('"') && expr.endsWith('"')) {
        this.lines.push(expr.slice(1, -1));
      } else {
        this.lines.push(String(this.evalExpr(expr)));
      }
    } 
    else if (upper.startsWith('DIM ')) {
      const match = upper.substring(4).match(/([A-Z_][A-Z0-9_]*)\s*\(([^)]+)\)/);
      if (match) {
        const varName = match[1];
        const size = Math.floor(this.evalExpr(match[2]));
        this.vars.set(varName, new Array(size + 1).fill(0)); 
      } else {
        this.lines.push('?SYNTAX ERROR');
      }
    }
    else if (upper.startsWith('READ ')) {
      const varName = upper.substring(5).trim();
      if (this.execState.dataBuffer.length > 0) {
        const arrayMatch = varName.match(/^([A-Z_][A-Z0-9_]*)\s*\(([^)]+)\)$/i);
        if (arrayMatch) {
          const arrName = arrayMatch[1].toUpperCase();
          const index = Math.floor(this.evalExpr(arrayMatch[2]));
          const arr = this.vars.get(arrName);
          if (Array.isArray(arr)) {
            arr[index] = this.execState.dataBuffer.shift();
          } else {
            this.lines.push('?DIM ERROR');
            this.execState.running = false;
          }
        } else {
          this.vars.set(varName, this.execState.dataBuffer.shift());
        }
      } else {
        this.lines.push('?OUT OF DATA ERROR');
        this.execState.running = false;
      }
    }
    else if (upper === 'DATA' || upper.startsWith('DATA ')) {
      // Игнорируем при исполнении, собрано на этапе RUN
    }
    else if (upper.startsWith('LET ')) {
      const eqIndex = stmt.indexOf('=');
      if (eqIndex !== -1) {
        const varName = stmt.substring(4, eqIndex).trim().toUpperCase();
        this.vars.set(varName, this.evalExpr(stmt.substring(eqIndex + 1).trim()));
      }
    }
    else if (stmt.includes('=') && !upper.startsWith('IF ')) {
      const eqIndex = stmt.indexOf('=');
      if (eqIndex !== -1) {
        const varName = stmt.substring(0, eqIndex).trim().toUpperCase();
        this.vars.set(varName, this.evalExpr(stmt.substring(eqIndex + 1).trim()));
      }
    }
    else if (upper.startsWith('INPUT ')) {
      const varName = upper.substring(6).trim();
      this.execState.waitingForInput = varName;
      this.lines.push('? ');
    }
    else if (upper.startsWith('GOTO ')) {
      this.executeGoto(parseInt(upper.substring(5).trim(), 10));
    }
    else if (upper.startsWith('GOSUB ')) {
      const targetLine = parseInt(upper.substring(6).trim(), 10);
      // Запоминаем следующую строку как точку возврата
      this.execState.callStack.push(this.execState.currentIndex + 1); 
      this.executeGoto(targetLine);
    }
    else if (upper === 'RETURN') {
      if (this.execState.callStack.length > 0) {
        this.execState.currentIndex = this.execState.callStack.pop()!;
        this.execState.jumped = true; // Сигнализируем о возврате
      } else {
        this.lines.push('?RETURN WITHOUT GOSUB ERROR');
        this.execState.running = false;
      }
    }
    else if (upper.startsWith('IF ')) {
      const match = upper.match(/^IF\s+(.+?)\s+THEN\s+(.+)$/);
      if (match) {
        if (this.evalExpr(match[1])) {
          const action = match[2].trim();
          if (/^\d+$/.test(action)) this.executeStatement(`GOTO ${action}`);
          else this.executeStatement(action);
        }
      }
    }
    else if (upper.startsWith('COLOR ')) {
      const colorIndex = Math.floor(this.evalExpr(upper.substring(6).trim()));
      const safeIndex = Math.max(0, Math.min(7, colorIndex));
      this.currentGraphicsColor = this.shades[safeIndex];
    }
    else if (upper.startsWith('LINE ')) {
      const args = stmt.substring(5).split(',').map(n => this.evalExpr(n.trim()));
      if (args.length === 4) this.graphicsBuffer.push({ type: 'LINE', args, color: this.currentGraphicsColor });
    }
    else if (upper.startsWith('RECT ')) {
      const args = stmt.substring(5).split(',').map(n => this.evalExpr(n.trim()));
      if (args.length === 4) this.graphicsBuffer.push({ type: 'RECT', args, color: this.currentGraphicsColor });
    }
    else if (upper === 'CLS') {
      this.graphicsBuffer = [];
      this.lines = [];
    }
    else if (upper === 'END') {
      this.execState.running = false;
    }
  }

  private wrapText(text: string, maxWidth: number): string[] {
    const wrappedLines: string[] = [];
    let currentLine = '';
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (this.ctx.measureText(currentLine + char).width > maxWidth && i > 0) {
        wrappedLines.push(currentLine);
        currentLine = char;
      } else {
        currentLine += char;
      }
    }
    wrappedLines.push(currentLine);
    return wrappedLines;
  }

  public draw() {
    if (this.execState.headless) return;

    this.ctx.fillStyle = this.palette.bg;
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    
    this.ctx.lineWidth = 2;
    for (const g of this.graphicsBuffer) {
      this.ctx.strokeStyle = g.color;
      if (g.type === 'LINE') {
        this.ctx.beginPath();
        this.ctx.moveTo(g.args[0], g.args[1]);
        this.ctx.lineTo(g.args[2], g.args[3]);
        this.ctx.stroke();
      } else if (g.type === 'RECT') {
        this.ctx.strokeRect(g.args[0], g.args[1], g.args[2], g.args[3]);
      }
    }

    this.ctx.fillStyle = this.palette.text;
    this.ctx.font = '12px Monaco, "Courier New", monospace';
    this.ctx.textBaseline = 'top';

    const padding = 10;
    const lineHeight = 16;
    const maxWidth = this.canvas.width - padding * 2;
    let y = padding;
    const selectionLines: string[] = [];

    this.ctx.fillText("С А Г Л Р Ц Ч С . Р", padding, y);
    const langWidth = this.ctx.measureText(this.currentLang).width;
    this.ctx.fillText(this.currentLang, this.canvas.width - padding - langWidth, y);
    selectionLines.push(`С А Г Л Р Ц Ч С . Р                                    ${this.currentLang}`);
    y += lineHeight;
    
    const lineChars = Math.floor(maxWidth / this.ctx.measureText("-").width);
    this.ctx.fillText("-".repeat(lineChars), padding, y);
    selectionLines.push("-".repeat(lineChars));
    y += lineHeight;
    
    this.ctx.fillText(" БЕЙСИК", padding, y);
    const now = new Date();
    const dateStr = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')}`;
    const versionText = `(ВИЛЬНЮС,${dateStr})`;
    this.ctx.fillText(versionText, this.canvas.width - padding - this.ctx.measureText(versionText).width, y);
    selectionLines.push(` БЕЙСИК                                       ${versionText}`);
    y += lineHeight * 2;
    selectionLines.push("");

    const helpHeight = 22;
    const availableHeight = this.canvas.height - y - helpHeight - lineHeight;
    const maxVisibleLines = Math.floor(availableHeight / lineHeight);
    
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

    const cursorStr = this.cursorVisible ? '█' : ' ';
    const cmdStrWithCursor = this.execState.waitingForInput 
        ? `${cursorStr}` 
        : this.currentInput.slice(0, this.cursorPos) + cursorStr + this.currentInput.slice(this.cursorPos);
        
    const cleanCmdStr = this.currentInput; 

    if (!this.execState.waitingForInput) {
      const wrappedCmd = this.wrapText(cmdStrWithCursor, maxWidth);
      for (const wLine of wrappedCmd) {
        this.ctx.fillText(wLine, padding, y);
        y += lineHeight;
      }
      
      const wrappedClean = this.wrapText(cleanCmdStr, maxWidth);
      for (const wLine of wrappedClean) {
        selectionLines.push(wLine);
      }
    } else {
      const lastLineY = y - lineHeight;
      const lastLineStr = visibleLines[visibleLines.length - 1];
      this.ctx.fillStyle = this.palette.bg;
      this.ctx.fillRect(padding, lastLineY, maxWidth, lineHeight);
      this.ctx.fillStyle = this.palette.text;
      
      const mergedStrWithCursor = lastLineStr + this.currentInput.slice(0, this.cursorPos) + cursorStr + this.currentInput.slice(this.cursorPos);
      this.ctx.fillText(mergedStrWithCursor, padding, lastLineY);
      
      selectionLines[selectionLines.length - 1] = lastLineStr + this.currentInput;
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
    const helpText = "BASIC: DIM A(N) | DATA | READ | EDIT N | GOSUB/RET | SAVE | LIST | RUN";
    this.ctx.fillText(helpText, padding, helpY + 4);
  }
}