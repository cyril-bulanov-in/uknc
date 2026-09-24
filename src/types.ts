export interface Palette {
  bg: string;
  text: string;
}

export const MonochromePalette: Palette = {
  bg: '#1a1a1a',
  text: '#DBDBDB',
};

export interface RunnableApp {
  handleKey(e: KeyboardEvent): void;
  handlePaste?(text: string): void;
  draw(): void;
  onExit(callback: () => void): void;
  toggleCursor(): void;
}