import { describe, it, expect } from 'vitest';
import {
  parseKeyInput,
  getKeysym,
  charNeedsShift,
  getUnshiftedChar,
} from '../vnc/keyboard.js';

describe('parseKeyInput', () => {
  it('should parse single key without modifiers', () => {
    expect(parseKeyInput('a')).toEqual({ modifiers: [], key: 'a' });
    expect(parseKeyInput('Enter')).toEqual({ modifiers: [], key: 'Enter' });
    expect(parseKeyInput('F1')).toEqual({ modifiers: [], key: 'F1' });
  });

  it('should parse key combination with one modifier', () => {
    expect(parseKeyInput('Ctrl+c')).toEqual({ modifiers: ['Ctrl'], key: 'c' });
    expect(parseKeyInput('Alt+F4')).toEqual({ modifiers: ['Alt'], key: 'F4' });
    expect(parseKeyInput('Shift+Tab')).toEqual({ modifiers: ['Shift'], key: 'Tab' });
  });

  it('should parse key combination with multiple modifiers', () => {
    const result = parseKeyInput('Ctrl+Alt+Delete');
    expect(result).toEqual({ modifiers: ['Ctrl', 'Alt'], key: 'Delete' });
  });

  it('should parse three-modifier combination', () => {
    const result = parseKeyInput('Ctrl+Shift+Escape');
    expect(result).toEqual({ modifiers: ['Ctrl', 'Shift'], key: 'Escape' });
  });

  it('should trim whitespace around parts', () => {
    expect(parseKeyInput('Ctrl + c')).toEqual({ modifiers: ['Ctrl'], key: 'c' });
    expect(parseKeyInput('Ctrl + Alt + Delete')).toEqual({
      modifiers: ['Ctrl', 'Alt'],
      key: 'Delete',
    });
  });
});

describe('getKeysym', () => {
  it('should return correct keysym for letters', () => {
    expect(getKeysym('a')).toBe(0x0061);
    expect(getKeysym('z')).toBe(0x007a);
    expect(getKeysym('A')).toBe(0x0041);
    expect(getKeysym('Z')).toBe(0x005a);
  });

  it('should return correct keysym for numbers', () => {
    expect(getKeysym('0')).toBe(0x0030);
    expect(getKeysym('5')).toBe(0x0035);
    expect(getKeysym('9')).toBe(0x0039);
  });

  it('should return correct keysym for special keys (case insensitive)', () => {
    expect(getKeysym('Enter')).toBe(0xff0d);
    expect(getKeysym('enter')).toBe(0xff0d);
    expect(getKeysym('Return')).toBe(0xff0d);
    expect(getKeysym('Tab')).toBe(0xff09);
    expect(getKeysym('Escape')).toBe(0xff1b);
    expect(getKeysym('Esc')).toBe(0xff1b);
    expect(getKeysym('Space')).toBe(0x0020);
    expect(getKeysym(' ')).toBe(0x0020);
  });

  it('should return correct keysym for arrow keys', () => {
    expect(getKeysym('Up')).toBe(0xff52);
    expect(getKeysym('Down')).toBe(0xff54);
    expect(getKeysym('Left')).toBe(0xff51);
    expect(getKeysym('Right')).toBe(0xff53);
  });

  it('should return correct keysym for function keys', () => {
    expect(getKeysym('F1')).toBe(0xffbe);
    expect(getKeysym('F12')).toBe(0xffc9);
  });

  it('should return correct keysym for modifier keys', () => {
    expect(getKeysym('Ctrl')).toBe(0xffe3);
    expect(getKeysym('Shift')).toBe(0xffe1);
    expect(getKeysym('Alt')).toBe(0xffe9);
    expect(getKeysym('Super')).toBe(0xffeb);
    expect(getKeysym('Meta')).toBe(0xffe7);
    expect(getKeysym('Cmd')).toBe(0xffe7);
  });

  it('should fall back to charCodeAt for unknown keys', () => {
    const charCode = 'ñ'.charCodeAt(0);
    expect(getKeysym('ñ')).toBe(charCode);
  });

  it('should return correct keysym for base symbols', () => {
    expect(getKeysym('-')).toBe(0x002d);
    expect(getKeysym('.')).toBe(0x002e);
    expect(getKeysym('/')).toBe(0x002f);
  });

  it('should return correct keysym for shifted symbols', () => {
    expect(getKeysym('!')).toBe(0x0021);
    expect(getKeysym('@')).toBe(0x0040);
    expect(getKeysym('~')).toBe(0x007e);
  });
});

describe('charNeedsShift', () => {
  it('should return true for uppercase letters (handled separately)', () => {
    // Note: uppercase is handled via unshifted + Shift in typeCharacter,
    // but charNeedsShift checks the explicit shift chars list
    expect(charNeedsShift('!')).toBe(true);
    expect(charNeedsShift('@')).toBe(true);
    expect(charNeedsShift('~')).toBe(true);
    expect(charNeedsShift('_')).toBe(true);
    expect(charNeedsShift('"')).toBe(true);
  });

  it('should return false for lowercase letters', () => {
    expect(charNeedsShift('a')).toBe(false);
    expect(charNeedsShift('z')).toBe(false);
  });

  it('should return false for numbers', () => {
    expect(charNeedsShift('1')).toBe(false);
    expect(charNeedsShift('9')).toBe(false);
  });
});

describe('getUnshiftedChar', () => {
  it('should map shifted chars to their unshifted variants', () => {
    expect(getUnshiftedChar('!')).toBe('1');
    expect(getUnshiftedChar('@')).toBe('2');
    expect(getUnshiftedChar('#')).toBe('3');
    expect(getUnshiftedChar('$')).toBe('4');
    expect(getUnshiftedChar('%')).toBe('5');
    expect(getUnshiftedChar('^')).toBe('6');
    expect(getUnshiftedChar('&')).toBe('7');
    expect(getUnshiftedChar('*')).toBe('8');
    expect(getUnshiftedChar('(')).toBe('9');
    expect(getUnshiftedChar(')')).toBe('0');
    expect(getUnshiftedChar('_')).toBe('-');
    expect(getUnshiftedChar('+')).toBe('=');
    expect(getUnshiftedChar('~')).toBe('`');
    expect(getUnshiftedChar('"')).toBe("'");
    expect(getUnshiftedChar(':')).toBe(';');
    expect(getUnshiftedChar('<')).toBe(',');
    expect(getUnshiftedChar('>')).toBe('.');
    expect(getUnshiftedChar('?')).toBe('/');
  });

  it('should return same char for non-shifted chars', () => {
    expect(getUnshiftedChar('a')).toBe('a');
    expect(getUnshiftedChar('1')).toBe('1');
    expect(getUnshiftedChar(' ')).toBe(' ');
  });
});
