[Русский](README.ru.md) | [English](README.md)

# UKNC Web (Электроника МС 0511)

[![CI / Tests](https://github.com/ТВОЙ_АККАУНТ/uknc/actions/workflows/basic-ci.yml/badge.svg)](https://github.com/ТВОЙ_АККАУНТ/uknc/actions/workflows/basic-ci.yml)

A native browser-based recreation of the classic Soviet educational computer ecosystem — Elektronika UKNC (Электроника МС 0511) and BK series. 

Unlike traditional hardware emulators that require ROM images and complex setups, this project rebuilds the classic OS (RT-11) terminal and legendary retro games (like Treasure/Клад, Helicopter/Вертолет, and Oregon Trail) directly in TypeScript and HTML5 Canvas.

## Features
* **Cross-platform:** Runs smoothly on desktops, tablets, and smartphones.
* **No Emulation Overhead:** Pure TypeScript logic styled with a nostalgic 8-shade monochrome palette.
* **Touch-Friendly:** Native mobile keyboard support integrated directly with the canvas terminal.

## Development
This project uses [Vite](https://vitejs.dev/) and TypeScript.

```bash
# Install dependencies
npm install

# Start the local development server
npm run dev

# Build for production
npm run build
```