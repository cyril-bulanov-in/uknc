// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { BasicInterpreter } from '../src/basic';
import { MonochromePalette } from '../src/types';

describe('BasicInterpreter', () => {
  let interpreter: BasicInterpreter;

  beforeEach(() => {
    // Создаем фейковый Canvas и Context для JSDOM
    const canvas = document.createElement('canvas');
    // В Headless режиме Context не используется, поэтому можно передать null как any
    interpreter = new BasicInterpreter(canvas, null as any, MonochromePalette);
  });

  it('должен корректно вычислять факториал (рекурсия, GOSUB/RETURN)', () => {
    const code = `
    10 N = 4
    20 F = 1
    30 GOSUB 100
    40 PRINT F
    50 END
    100 IF N = 0 THEN 140
    110 F = F * N
    120 N = N - 1
    130 GOSUB 100
    140 RETURN`;
    
    const output = interpreter.runHeadless(code);
    expect(output).toEqual(['24']); // 4! = 24
  });

  it('должен парсить графические команды в буфер', () => {
    const code = `
    10 COLOR 7
    20 LINE 10, 20, 30, 40
    30 RECT 100, 100, 50, 50
    40 END`;
    
    interpreter.runHeadless(code);
    const gfx = interpreter.getGraphicsBuffer();
    
    expect(gfx).toHaveLength(2);
    expect(gfx[0]).toEqual({ type: 'LINE', args: [10, 20, 30, 40], color: '#FFFFFF' });
    expect(gfx[1]).toEqual({ type: 'RECT', args: [100, 100, 50, 50], color: '#FFFFFF' });
  });

  it('должен сортировать массив алгоритмом пузырька (DATA/READ/DIM)', () => {
    const code = `
    10 DIM A(3)
    20 DATA 99, 15, 42
    30 I = 0
    40 IF I = 3 THEN 80
    50 READ A(I)
    60 I = I + 1
    70 GOTO 40
    80 I = 0
    90 IF I = 2 THEN 200
    100 J = 0
    110 IF J = 2 - I THEN 180
    120 IF A(J) < A(J + 1) THEN 160
    130 TEMP = A(J)
    140 A(J) = A(J + 1)
    150 A(J + 1) = TEMP
    160 J = J + 1
    170 GOTO 110
    180 I = I + 1
    190 GOTO 90
    200 I = 0
    210 IF I = 3 THEN 250
    220 PRINT A(I)
    230 I = I + 1
    240 GOTO 210
    250 END`;
    
    const output = interpreter.runHeadless(code);
    expect(output).toEqual(['15', '42', '99']);
  });
});