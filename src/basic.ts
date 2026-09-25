import type { Palette, RunnableApp } from './types';

interface GraphicCmd {
  type: 'LINE' | 'RECT';
  args: number[];
  color: string;
}

interface VarInfo {
  type: string;
  value: any;
  isArray: boolean;
  minIndex?: number;
  maxIndex?: number;
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
  private vars: Map<string, VarInfo> = new Map();
  private userFuncs: Map<string, { argName: string, body: string }> = new Map(); 
  private graphicsBuffer: GraphicCmd[] = [];
  private keyBuffer: string[] = []; // Буфер для INKEY$
  
  private currentGraphicsColor: string;
  private readonly shades = ['#000000', '#242424', '#494949', '#6D6D6D', '#929292', '#B6B6B6', '#DBDBDB', '#FFFFFF'];

  private static virtualTape: Map<string, Map<number, string>> = new Map();
  
  private execState = {
    running: false,
    headless: false,
    lineKeys: [] as number[],
    currentIndex: 0,
    stmtIndex: 0,
    currentStmtIndex: 0,
    jumped: false,
    waitingForInput: null as string | null,
    callStack: [] as Array<{ lineIndex: number, stmtIndex: number }>,
    forStack: [] as Array<{
      varName: string,
      endValue: number,
      stepValue: number,
      loopLineIndex: number,
      loopStmtIndex: number
    }>,
    ifStack: [] as Array<{ matched: boolean, executing: boolean }>,
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

    // ПЕРЕХВАТ КЛАВИШ ДЛЯ INKEY$ ВО ВРЕМЯ РАБОТЫ ПРОГРАММЫ
    if (this.execState.running && !this.execState.waitingForInput) {
      if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
        this.keyBuffer.push(e.key);
      }
      return; 
    }

    if (e.key === 'Enter') {
      const input = this.currentInput.trim();
      
      if (input) {
        this.history.push(input);
        this.historyIndex = this.history.length;
      }

      if (this.execState.waitingForInput) {
        this.lines[this.lines.length - 1] += input; 
        const val = isNaN(Number(input)) ? input : Number(input);
        
        const arrayMatch = this.execState.waitingForInput.match(/^([A-Z_][A-Z0-9_$]*)\s*\(([^)]+)\)$/i);
        if (arrayMatch) {
          const arrName = arrayMatch[1].toUpperCase();
          const index = Math.floor(this.evalExpr(arrayMatch[2]));
          this.assignVar(arrName, val, index);
        } else {
          this.assignVar(this.execState.waitingForInput, val);
        }
        
        this.currentInput = '';
        this.cursorPos = 0;
        this.execState.waitingForInput = null;
        this.execState.currentIndex++;
        this.execState.stmtIndex = 0;
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
    } else if (e.key === 'Tab') {
      e.preventDefault(); 
      const spaces = '    ';
      this.currentInput = this.currentInput.slice(0, this.cursorPos) + spaces + this.currentInput.slice(this.cursorPos);
      this.cursorPos += 4;
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

  public getGraphicsBuffer() {
    return this.graphicsBuffer;
  }

  private stripComments(line: string): { code: string, comment: string } {
    let inString = false;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"') inString = !inString;
      if (!inString) {
        if (line[i] === "'") {
          return { code: line.substring(0, i), comment: line.substring(i) };
        }
        if (line.substring(i, i + 3).toUpperCase() === 'REM' && 
           (i === 0 || line[i - 1] === ' ' || line[i - 1] === ':')) {
          return { code: line.substring(0, i), comment: line.substring(i) };
        }
      }
    }
    return { code: line, comment: '' };
  }

  private splitStatements(code: string): string[] {
    const stmts: string[] = [];
    let current = '';
    let inString = false;
    for (let i = 0; i < code.length; i++) {
      if (code[i] === '"') inString = !inString;
      if (code[i] === ':' && !inString) {
        stmts.push(current);
        current = '';
      } else {
        current += code[i];
      }
    }
    stmts.push(current);
    return stmts;
  }

  private splitElse(code: string): string[] {
    let inString = false;
    for (let i = 0; i < code.length - 3; i++) {
      if (code[i] === '"') inString = !inString;
      if (!inString) {
        const substr = code.substring(i, i + 4).toUpperCase();
        if (substr === 'ELSE') {
          const prev = i === 0 ? ' ' : code[i - 1];
          const next = i + 4 === code.length ? ' ' : code[i + 4];
          if (/[ \t:]/.test(prev) && /[ \t:]/.test(next)) {
            return [code.substring(0, i), code.substring(i + 4)];
          }
        }
      }
    }
    return [code];
  }

  private isExecuting(): boolean {
    return this.execState.ifStack.every(s => s.executing);
  }

  private evalExpr(expr: string): any {
    let parsed = expr;

    parsed = parsed.replace(/<>/g, '!=='); 
    parsed = parsed.replace(/([^<>=!])=([^=])/g, '$1===$2'); 
    parsed = parsed.replace(/^=/, '==='); 
    parsed = parsed.replace(/\bAND\b/gi, '&&');
    parsed = parsed.replace(/\bOR\b/gi, '||');
    parsed = parsed.replace(/\bNOT\b/gi, '!');
    
    parsed = parsed.replace(/([A-Z_][A-Z0-9_$]*)\s*\(([^)]+)\)/gi, (_, p1, p2) => {
      const name = p1.toUpperCase();
      const v = this.vars.get(name);
      if (v && v.isArray) return `${name}[${p2}]`;
      return `${name}(${p2})`;
    });

    const keys: string[] = [];
    const values: any[] = [];
    
    this.vars.forEach((v, k) => {
      if (/^[A-Z_][A-Z0-9_$]*$/i.test(k)) {
        keys.push(k);
        values.push(v.value);
      }
    });

    this.userFuncs.forEach((fnObj, k) => {
      keys.push(k);
      values.push((argVal: any) => {
        const prev = this.vars.get(fnObj.argName);
        this.vars.set(fnObj.argName, { type: typeof argVal === 'string' ? 'STRING' : 'DOUBLE', value: argVal, isArray: false });
        const result = this.evalExpr(fnObj.body);
        if (prev) this.vars.set(fnObj.argName, prev);
        else this.vars.delete(fnObj.argName);
        return result;
      });
    });

    // ДОПОЛНЕННЫЕ ВСТРОЕННЫЕ ФУНКЦИИ
    const builtIns = {
      SIN: Math.sin, COS: Math.cos, TAN: Math.tan, ATN: Math.atan,
      EXP: Math.exp, LOG: Math.log, ABS: Math.abs, SGN: Math.sign, SQR: Math.sqrt,
      INT: Math.floor, FIX: Math.trunc,
      RND: () => Math.random(),
      LEN: (s: string) => String(s).length,
      CHR$: (x: number) => String.fromCharCode(Math.max(0, Math.min(255, x))),
      ASC: (s: string) => String(s).charCodeAt(0) || 0,
      STR$: (x: number) => String(x),
      VAL: (s: string) => Number(s) || 0,
      FRE: () => 32768, 
      BIN$: (x: number) => Math.floor(x).toString(2),
      OCT$: (x: number) => Math.floor(x).toString(8),
      HEX$: (x: number) => Math.floor(x).toString(16).toUpperCase(),
      STRING$: (n: number, char: any) => {
        const c = typeof char === 'number' ? String.fromCharCode(char) : String(char).charAt(0);
        return c.repeat(Math.max(0, n));
      },
      MID$: (s: string, h: number, k?: number) => {
        const str = String(s);
        return k === undefined ? str.substring(h - 1) : str.substring(h - 1, h - 1 + k);
      },
      POINT: (x: number, y: number) => {
        if (this.execState.headless || !this.ctx) return -1;
        try {
          const p = this.ctx.getImageData(x, y, 1, 1).data;
          return p[3] === 0 ? 0 : 1; 
        } catch(e) { return -1; }
      },
      INKEY$: () => {
        return this.keyBuffer.length > 0 ? this.keyBuffer.shift()! : "";
      }
    };
    
    for (const [k, v] of Object.entries(builtIns)) {
      keys.push(k);
      values.push(v);
    }
    
    try {
      const fn = new Function(...keys, `return (${parsed});`);
      return fn(...values);
    } catch (e) {
      return 0; 
    }
  }

  private castValue(val: any, type: string): any {
    if (type === 'STRING') return String(val);
    if (type === 'BOOLEAN') return Boolean(val) ? 1 : 0;
    if (type === 'DATE') return String(val);

    if (typeof val === 'string' && val.trim() !== '') {
        const num = Number(val);
        if (isNaN(num)) throw new Error('TYPE MISMATCH ERROR');
    }
    
    const num = Number(val);
    if (isNaN(num)) throw new Error('TYPE MISMATCH ERROR');
    
    switch (type) {
        case 'INTEGER':
        case 'LONG':
            return Math.trunc(num);
        case 'BYTE':
            return Math.max(0, Math.min(255, Math.trunc(num)));
        default: 
            return num;
    }
  }

  private assignVar(varName: string, value: any, index?: number) {
    try {
      const existing = this.vars.get(varName);
      if (existing) {
        if (existing.isArray) {
          if (index === undefined) throw new Error('TYPE MISMATCH ERROR'); 
          if (index < existing.minIndex! || index > existing.maxIndex!) throw new Error('SUBSCRIPT OUT OF RANGE');
          existing.value[index] = this.castValue(value, existing.type);
        } else {
          if (index !== undefined) throw new Error('DIM ERROR (NOT AN ARRAY)');
          existing.value = this.castValue(value, existing.type);
        }
      } else {
        if (index !== undefined) throw new Error('DIM ERROR (UNDECLARED ARRAY)');
        const inferredType = typeof value === 'string' ? 'STRING' : 'DOUBLE';
        this.vars.set(varName, { type: inferredType, value: value, isArray: false });
      }
    } catch (e: any) {
      this.lines.push(`?${e.message}`);
      this.execState.running = false;
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
      this.userFuncs.clear();
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
      this.execState.stmtIndex = 0;
      this.execState.callStack = [];
      this.execState.forStack = [];
      this.execState.ifStack = [];
      this.keyBuffer = []; // Очищаем буфер клавиш перед стартом
      this.execState.dataBuffer = [];
      this.execState.running = true;
      
      for (const k of this.execState.lineKeys) {
        const rawCode = this.programMemory.get(k) || '';
        const { code } = this.stripComments(rawCode);
        const stmts = this.splitStatements(code);
        
        for (const c of stmts) {
          const trimmed = c.trim();
          if (trimmed.toUpperCase().startsWith('DATA ')) {
            const items = trimmed.substring(5).split(',').map(s => {
              const val = s.trim();
              return isNaN(Number(val)) ? val : Number(val);
            });
            this.execState.dataBuffer.push(...items);
          }
        }
      }
      this.step();
    } else {
      const { code } = this.stripComments(cmd);
      if (code.trim() !== '') {
        const stmts = this.splitStatements(code);
        for (const stmt of stmts) {
          if (stmt.trim() !== '') {
            this.executeStatement(stmt);
            if (!this.execState.running || this.execState.waitingForInput) break;
          }
        }
      }
      if (!this.execState.running && !this.execState.waitingForInput && !upperCmd.startsWith('EDIT') && !this.execState.headless) {
        this.lines.push('Ok');
      }
    }
  }

  private step() {
    if (!this.execState.running) return;

    const opsLimit = 2000;
    let ops = 0;

    while (this.execState.currentIndex < this.execState.lineKeys.length) {
      const currentLineNum = this.execState.lineKeys[this.execState.currentIndex];
      const rawCode = this.programMemory.get(currentLineNum) || '';
      const { code } = this.stripComments(rawCode);
      
      this.execState.jumped = false; 
      
      if (code.trim() !== '') {
        const stmts = this.splitStatements(code);
        for (let i = this.execState.stmtIndex; i < stmts.length; i++) {
          const stmt = stmts[i];
          if (stmt.trim() !== '') {
            this.execState.currentStmtIndex = i;
            this.executeStatement(stmt);
            if (!this.execState.running || this.execState.waitingForInput || this.execState.jumped) {
              break;
            }
          }
        }
      }
      
      if (!this.execState.running || this.execState.waitingForInput) {
        if (!this.execState.headless) this.draw();
        return; 
      }
      
      if (!this.execState.jumped) {
        this.execState.currentIndex++;
        this.execState.stmtIndex = 0;
      }

      ops++;
      if (ops >= opsLimit && !this.execState.headless) {
        this.draw(); 
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
      this.execState.stmtIndex = 0; 
      this.execState.jumped = true; 
    } else {
      this.lines.push('?LINE NOT FOUND ERROR');
      this.execState.running = false;
    }
  }

  private executeStatement(code: string) {
    const stmt = code.trim();
    const upper = stmt.toUpperCase();

    if (upper.startsWith('IF ')) {
      const match = stmt.match(/^IF\s+(.+?)\s+THEN(.*)$/i);
      if (match) {
        const rest = match[2].trim();
        const isBlock = rest === '';

        if (!this.isExecuting()) {
          if (isBlock) this.execState.ifStack.push({ matched: true, executing: false });
          return;
        }

        if (isBlock) {
          const cond = Boolean(this.evalExpr(match[1]));
          this.execState.ifStack.push({ matched: cond, executing: cond });
        } else {
          const cond = Boolean(this.evalExpr(match[1]));
          const parts = this.splitElse(rest);
          const trueAction = parts[0];
          const falseAction = parts.length > 1 ? parts[1] : undefined;

          if (cond) {
            if (trueAction) {
              if (/^\d+$/.test(trueAction.trim())) this.executeStatement(`GOTO ${trueAction.trim()}`);
              else {
                const stmts = this.splitStatements(trueAction);
                for (const s of stmts) {
                  if (s.trim() !== '') this.executeStatement(s);
                  if (!this.execState.running || this.execState.waitingForInput || this.execState.jumped) break;
                }
              }
            }
          } else {
            if (falseAction) {
              if (/^\d+$/.test(falseAction.trim())) this.executeStatement(`GOTO ${falseAction.trim()}`);
              else {
                const stmts = this.splitStatements(falseAction);
                for (const s of stmts) {
                  if (s.trim() !== '') this.executeStatement(s);
                  if (!this.execState.running || this.execState.waitingForInput || this.execState.jumped) break;
                }
              }
            }
          }
        }
        return;
      }
    } else if (upper.startsWith('ELSEIF ')) {
      const match = stmt.match(/^ELSEIF\s+(.+?)\s+THEN(.*)$/i);
      if (match) {
        if (this.execState.ifStack.length === 0) {
          this.lines.push('?ELSEIF WITHOUT IF ERROR');
          this.execState.running = false;
          return;
        }
        const top = this.execState.ifStack[this.execState.ifStack.length - 1];
        const parentExecuting = this.execState.ifStack.slice(0, -1).every(s => s.executing);

        if (parentExecuting) {
          if (top.matched) top.executing = false;
          else {
            const cond = Boolean(this.evalExpr(match[1]));
            if (cond) {
              top.matched = true;
              top.executing = true;
            } else top.executing = false;
          }
        } else top.executing = false;
      }
      return;
    } else if (upper === 'ELSE') {
      if (this.execState.ifStack.length === 0) {
        this.lines.push('?ELSE WITHOUT IF ERROR');
        this.execState.running = false;
        return;
      }
      const top = this.execState.ifStack[this.execState.ifStack.length - 1];
      const parentExecuting = this.execState.ifStack.slice(0, -1).every(s => s.executing);

      if (parentExecuting) {
        if (top.matched) top.executing = false;
        else {
          top.matched = true;
          top.executing = true;
        }
      }
      return;
    } else if (upper === 'END IF') {
      if (this.execState.ifStack.length === 0) {
        this.lines.push('?END IF WITHOUT IF ERROR');
        this.execState.running = false;
        return;
      }
      this.execState.ifStack.pop();
      return;
    }

    if (!this.isExecuting()) return;

    if (upper.startsWith('DEF FN')) {
      const match = stmt.match(/^DEF\s+(FN[A-Z0-9_$]*)\s*\(([^)]+)\)\s*=\s*(.+)$/i);
      if (match) {
        this.userFuncs.set(match[1].toUpperCase(), { argName: match[2].trim().toUpperCase(), body: match[3].trim() });
      } else {
        this.lines.push('?SYNTAX ERROR IN DEF FN');
        this.execState.running = false;
      }
      return;
    }

    // ПОДДЕРЖКА ПРИСВОЕНИЯ MID$(A$, H, K) = "TEXT"
    const midMatch = stmt.match(/^MID\$\s*\(\s*([A-Z_][A-Z0-9_$]*)\s*,\s*([^,]+)(?:,\s*(.+))?\s*\)\s*=\s*(.+)$/i);
    if (midMatch) {
       const varName = midMatch[1].toUpperCase();
       const start = Math.floor(this.evalExpr(midMatch[2]));
       const lenExpr = midMatch[3];
       const replacement = String(this.evalExpr(midMatch[4]));
       
       const existing = this.vars.get(varName);
       if (existing && existing.type === 'STRING') {
           let str = String(existing.value);
           const len = lenExpr ? Math.floor(this.evalExpr(lenExpr)) : str.length - start + 1;
           const repl = replacement.substring(0, len);
           const before = str.substring(0, start - 1);
           const after = str.substring(start - 1 + repl.length);
           existing.value = before + repl + after;
       } else {
           this.lines.push('?TYPE MISMATCH OR UNDEFINED ERROR');
           this.execState.running = false;
       }
       return;
    }

    const arrayMatch = stmt.match(/^(?:LET\s+)?([A-Z_][A-Z0-9_$]*)\s*\(([^)]+)\)\s*=\s*(.+)$/i);
    if (arrayMatch) {
      const varName = arrayMatch[1].toUpperCase();
      const index = Math.floor(this.evalExpr(arrayMatch[2]));
      const value = this.evalExpr(arrayMatch[3]);
      this.assignVar(varName, value, index);
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
      const dimStr = upper.substring(4).trim();
      const dimRegex = /^([A-Z_][A-Z0-9_$]*)\s*(?:\(([^)]+)\))?(?:\s+AS\s+([A-Z]+))?$/;
      const match = dimStr.match(dimRegex);
      
      if (match) {
          const varName = match[1];
          const boundsStr = match[2];
          const typeStr = match[3] || 'DOUBLE';
          
          if (boundsStr) {
              let min = 0, max = 0;
              if (boundsStr.includes(' TO ')) {
                  const parts = boundsStr.split(' TO ');
                  min = Math.floor(this.evalExpr(parts[0]));
                  max = Math.floor(this.evalExpr(parts[1]));
              } else max = Math.floor(this.evalExpr(boundsStr));
              
              const safeMax = Math.max(0, max);
              const defVal = typeStr === 'STRING' ? '' : 0;
              const jsArray = new Array(safeMax + 1).fill(defVal);
              this.vars.set(varName, { type: typeStr, value: jsArray, isArray: true, minIndex: min, maxIndex: max });
          } else {
              const defVal = typeStr === 'STRING' ? '' : 0;
              this.vars.set(varName, { type: typeStr, value: defVal, isArray: false });
          }
      } else {
          this.lines.push('?SYNTAX ERROR');
          this.execState.running = false;
      }
    }
    else if (upper.startsWith('FOR ')) {
      const forMatch = upper.match(/^FOR\s+([A-Z_][A-Z0-9_$]*)\s*=\s*(.+?)\s+TO\s+(.+?)(?:\s+STEP\s+(.+))?$/);
      if (forMatch) {
        const varName = forMatch[1];
        const startVal = this.evalExpr(forMatch[2]);
        const endVal = this.evalExpr(forMatch[3]);
        const stepVal = forMatch[4] ? this.evalExpr(forMatch[4]) : 1;
        
        this.assignVar(varName, startVal);
        
        this.execState.forStack.push({
          varName,
          endValue: endVal,
          stepValue: stepVal,
          loopLineIndex: this.execState.currentIndex,
          loopStmtIndex: this.execState.currentStmtIndex + 1
        });
      } else {
        this.lines.push('?SYNTAX ERROR IN FOR');
        this.execState.running = false;
      }
    }
    else if (upper.startsWith('NEXT')) {
      const nextMatch = upper.match(/^NEXT(?:\s+([A-Z_][A-Z0-9_$]*))?$/);
      if (nextMatch) {
        const loopVar = nextMatch[1];
        if (this.execState.forStack.length === 0) {
          this.lines.push('?NEXT WITHOUT FOR ERROR');
          this.execState.running = false;
          return;
        }
        
        const loopState = this.execState.forStack[this.execState.forStack.length - 1];
        if (loopVar && loopVar !== loopState.varName) {
          this.lines.push('?NEXT VARIABLE MISMATCH ERROR');
          this.execState.running = false;
          return;
        }
        
        const existingVar = this.vars.get(loopState.varName);
        let currentVal = existingVar ? existingVar.value : 0;
        currentVal += loopState.stepValue;
        this.assignVar(loopState.varName, currentVal);
        
        const conditionMet = loopState.stepValue >= 0 
            ? currentVal <= loopState.endValue 
            : currentVal >= loopState.endValue;
            
        if (conditionMet) {
          this.execState.currentIndex = loopState.loopLineIndex;
          this.execState.stmtIndex = loopState.loopStmtIndex;
          this.execState.jumped = true;
        } else this.execState.forStack.pop();
      }
    }
    else if (upper.startsWith('READ ')) {
      const varName = upper.substring(5).trim();
      if (this.execState.dataBuffer.length > 0) {
        const arrMatch = varName.match(/^([A-Z_][A-Z0-9_$]*)\s*\(([^)]+)\)$/i);
        const dataVal = this.execState.dataBuffer.shift();
        
        if (arrMatch) {
          const arrName = arrMatch[1].toUpperCase();
          const index = Math.floor(this.evalExpr(arrMatch[2]));
          this.assignVar(arrName, dataVal, index);
        } else this.assignVar(varName, dataVal);
      } else {
        this.lines.push('?OUT OF DATA ERROR');
        this.execState.running = false;
      }
    }
    else if (upper === 'DATA' || upper.startsWith('DATA ')) {
      // Игнорируется
    }
    else if (upper.startsWith('LET ')) {
      const eqIndex = stmt.indexOf('=');
      if (eqIndex !== -1) {
        const varName = stmt.substring(4, eqIndex).trim().toUpperCase();
        this.assignVar(varName, this.evalExpr(stmt.substring(eqIndex + 1).trim()));
      }
    }
    else if (stmt.includes('=') && !upper.startsWith('IF ')) {
      const eqIndex = stmt.indexOf('=');
      if (eqIndex !== -1) {
        const varName = stmt.substring(0, eqIndex).trim().toUpperCase();
        this.assignVar(varName, this.evalExpr(stmt.substring(eqIndex + 1).trim()));
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
      this.execState.callStack.push({
        lineIndex: this.execState.currentIndex,
        stmtIndex: this.execState.currentStmtIndex + 1
      }); 
      this.executeGoto(targetLine);
    }
    else if (upper === 'RETURN') {
      if (this.execState.callStack.length > 0) {
        const ret = this.execState.callStack.pop()!;
        this.execState.currentIndex = ret.lineIndex;
        this.execState.stmtIndex = ret.stmtIndex;
        this.execState.jumped = true;
      } else {
        this.lines.push('?RETURN WITHOUT GOSUB ERROR');
        this.execState.running = false;
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
    if (this.execState.headless || !this.ctx) return;

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
      const { code, comment } = this.stripComments(wLine);
      
      if (comment && wLine.endsWith(comment) && !wLine.startsWith('? ')) {
        const codeWidth = this.ctx.measureText(code).width;
        this.ctx.fillText(code, padding, y);
        this.ctx.fillStyle = '#6D6D6D';
        this.ctx.fillText(comment, padding + codeWidth, y);
        this.ctx.fillStyle = this.palette.text;
      } else {
        this.ctx.fillText(wLine, padding, y);
      }
      
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