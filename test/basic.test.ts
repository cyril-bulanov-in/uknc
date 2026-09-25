// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { BasicInterpreter } from '../src/basic';
import { MonochromePalette } from '../src/types';

describe('BasicInterpreter', () => {
    let interpreter: BasicInterpreter;

    beforeEach(() => {
        const canvas = document.createElement('canvas');
        interpreter = new BasicInterpreter(canvas, null as any, MonochromePalette);
    });

    it('Факториал', () => {
        const code = `
        10 REM Должен корректно вычислять факториал (рекурсия, GOSUB/RETURN)
        20 N = 4
        30 F = 1
        40 GOSUB 110
        50 PRINT F
        60 END
        110 IF N = 0 THEN 150
        120 F = F * N
        130 N = N - 1
        140 GOSUB 110
        150 RETURN`;
        
        const output = interpreter.runHeadless(code);
        expect(output).toEqual(['24']); 
    });

    it('Графика', () => {
        const code = `
        10 REM Должен парсить графические команды в буфер
        20 COLOR 7
        30 LINE 10, 20, 30, 40
        40 RECT 100, 100, 50, 50
        50 END`;
        
        interpreter.runHeadless(code);
        const gfx = interpreter.getGraphicsBuffer();
        
        expect(gfx).toHaveLength(2);
        expect(gfx[0]).toEqual({ type: 'LINE', args: [10, 20, 30, 40], color: '#FFFFFF' });
        expect(gfx[1]).toEqual({ type: 'RECT', args: [100, 100, 50, 50], color: '#FFFFFF' });
    });

    it('Пузырек', () => {
        const code = `
        10 REM Должен сортировать массив алгоритмом пузырька (DATA/READ/DIM)
        20 DIM A(3)
        30 DATA 99, 15, 42
        40 I = 0
        50 IF I = 3 THEN 90
        60 READ A(I)
        70 I = I + 1
        80 GOTO 50
        90 I = 0
        100 IF I = 2 THEN 210
        110 J = 0
        120 IF J = 2 - I THEN 190
        130 IF A(J) < A(J + 1) THEN 170
        140 TEMP = A(J)
        150 A(J) = A(J + 1)
        160 A(J + 1) = TEMP
        170 J = J + 1
        180 GOTO 120
        190 I = I + 1
        200 GOTO 100
        210 I = 0
        220 IF I = 3 THEN 260
        230 PRINT A(I)
        240 I = I + 1
        250 GOTO 220
        260 END`;
        
        const output = interpreter.runHeadless(code);
        expect(output).toEqual(['15', '42', '99']);
    });

    it('Комментарии', () => {
        const code = `
        10 REM Должен корректно обрабатывать комментарии (REM и апостроф) и двоеточие
        20 REM Это главный комментарий
        30 A = 5 ' Инициализация A
        40 B = 10 : REM Инициализация B
        50 PRINT "DON'T PANIC" ' Строка с апострофом внутри
        60 C = A + B : PRINT C
        70 END`;
        
        const output = interpreter.runHeadless(code);
        expect(output).toEqual(["DON'T PANIC", '15']);
    });

    it('Типизация', () => {
        const code = `
        10 REM Должен поддерживать жесткую типизацию (DIM AS) и отсекать дробную часть для INTEGER
        20 DIM A AS INTEGER
        30 DIM B AS STRING
        40 A = 3.1415
        50 B = "TEXT"
        60 PRINT A
        70 PRINT B
        80 END`;
        
        const output = interpreter.runHeadless(code);
        expect(output).toEqual(['3', 'TEXT']);
    });

    it('TYPE MISMATCH', () => {
        const code = `
        10 REM Должен выдавать ошибку TYPE MISMATCH при попытке записать строку в число
        20 DIM A AS INTEGER
        30 A = "ОШИБКА"
        40 PRINT A
        50 END`;
        
        const output = interpreter.runHeadless(code);
        expect(output[0]).toContain('?TYPE MISMATCH ERROR');
    });

    it('Массивы с TO', () => {
        const code = `
        10 REM Должен работать с массивами с заданным диапазоном (TO)
        20 DIM ARR(5 TO 10) AS INTEGER
        30 ARR(5) = 100
        40 ARR(10) = 200
        50 PRINT ARR(5)
        60 PRINT ARR(10)
        70 END`;
        
        const output = interpreter.runHeadless(code);
        expect(output).toEqual(['100', '200']);
    });

    it('FOR...NEXT с шагом', () => {
        const code = `
        10 REM Должен выполнять цикл FOR ... NEXT с заданным шагом
        20 DIM SUM AS INTEGER
        30 FOR I = 1 TO 10 STEP 2
        40 SUM = SUM + I
        50 NEXT I
        60 PRINT SUM
        70 END`;
        
        const output = interpreter.runHeadless(code);
        expect(output).toEqual(['25']);
    });

    it('Однострочный FOR...NEXT', () => {
        const code = `
        10 REM Должен поддерживать FOR ... NEXT в одну строку, прыгая по стейтментам
        20 FOR X = 10 TO 1 STEP -3 : PRINT X : NEXT X
        30 END`;
        
        const output = interpreter.runHeadless(code);
        expect(output).toEqual(['10', '7', '4', '1']);
    });

    it('Однострочный IF', () => {
        const code = `
        10 REM Должен выполнять однострочный IF ... THEN ... ELSE
        20 A = 15
        30 IF A > 10 THEN PRINT "High" ELSE PRINT "Low"
        40 A = 5
        50 IF A > 10 THEN PRINT "High" ELSE PRINT "Low"
        60 END`;
        
        const output = interpreter.runHeadless(code);
        expect(output).toEqual(['High', 'Low']);
    });

    it('Многострочный IF', () => {
        const code = `
        10 REM Должен выполнять многострочный IF / ELSEIF / ELSE / END IF
        20 DIM X AS INTEGER
        30 X = 85
        40 IF X >= 90 THEN
        50     PRINT "A"
        60 ELSEIF X >= 80 THEN
        70     PRINT "B"
        80 ELSE
        90     PRINT "C"
        100 END IF
        110 END`;
        
        const output = interpreter.runHeadless(code);
        expect(output).toEqual(['B']);
    });

    it('Вложенный IF', () => {
        const code = `
        10 REM Должен поддерживать вложенные многострочные IF
        20 X = 1
        30 Y = 2
        40 IF X = 1 THEN
        50     IF Y = 1 THEN
        60         PRINT "X1 Y1"
        70     ELSE
        80         PRINT "X1 Y2"
        90     END IF
        100 ELSE
        110    PRINT "X0"
        120 END IF
        130 END`;
        
        const output = interpreter.runHeadless(code);
        expect(output).toEqual(['X1 Y2']);
    });

    it('DEF FN', () => {
        const code = `
        10 REM Должен корректно объявлять и выполнять пользовательские функции (DEF FN)
        20 Z = 10
        30 DEF FNMS(X) = X * X + Z
        40 PRINT FNMS(5)
        50 END`;
        
        const output = interpreter.runHeadless(code);
        expect(output).toEqual(['35']);
    });

    it('Встроенные функции', () => {
        const code = `
        10 REM Должен вычислять встроенные математические и строковые функции
        20 PRINT INT(8.9)
        30 PRINT FIX(-8.9)
        40 PRINT SQR(16)
        50 PRINT LEN("HELLO")
        60 PRINT CHR$(65)
        70 PRINT STR$(123)
        80 END`;
        
        const output = interpreter.runHeadless(code);
        expect(output).toEqual(['8', '-8', '4', '5', 'A', '123']);
    });

    it('Редактор (Tab)', () => {
        // 10 REM Должен вставлять 4 пробела при нажатии на Tab в интерактивном режиме
        const type = (str: string) => {
            for (const char of str) {
                interpreter.handleKey(new KeyboardEvent('keydown', { key: char }));
            }
        };

        // Печатаем номер строки 
        type("10");
        
        // Нажимаем Tab (4 пробела)
        interpreter.handleKey(new KeyboardEvent('keydown', { key: 'Tab', cancelable: true }));
        
        // Допечатываем код и жмем Enter
        type("A=1");
        interpreter.handleKey(new KeyboardEvent('keydown', { key: 'Enter' }));
        
        // Вводим команду LIST
        type("LIST");
        interpreter.handleKey(new KeyboardEvent('keydown', { key: 'Enter' }));

        // Ищем в истории консоли строку, где после 10 идет ровно 4 пробела
        expect(interpreter.lines).toContain('10    A=1');
    });

    it('Специфичные функции БК', () => {
        const code = `
        10 REM Должен вычислять BIN$, HEX$, MID$, STRING$ и присваивать MID$
        20 PRINT BIN$(5)
        30 PRINT HEX$(255)
        40 PRINT STRING$(3, "A")
        50 A$ = "HELLO"
        60 PRINT MID$(A$, 2, 3)
        70 MID$(A$, 2, 2) = "XX"
        80 PRINT A$
        90 END`;
        
        const output = interpreter.runHeadless(code);
        // BIN$(5) = 101, HEX$(255) = FF, STRING$= AAA, MID$("HELLO",2,3) = ELL, замена -> HXXLO
        expect(output).toEqual(['101', 'FF', 'AAA', 'ELL', 'HXXLO']);
    });
});