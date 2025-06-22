// src/vnc/keyboard.ts
export function parseKeyInput(keyInput: string): { modifiers: string[], key: string } {
  // Handle key combinations like "Ctrl+Alt+Delete", "Alt+F4", etc.
  const parts = keyInput.split('+').map(part => part.trim());
  
  if (parts.length === 1) {
    // Single key
    return { modifiers: [], key: parts[0] };
  }
  
  // Multiple parts - last one is the main key, others are modifiers
  const key = parts[parts.length - 1];
  const modifiers = parts.slice(0, -1);
  
  return { modifiers, key };
}

export function getKeysym(key: string): number {
  const keyMap: { [key: string]: number } = {
    // Letters (lowercase)
    'a': 0x0061, 'b': 0x0062, 'c': 0x0063, 'd': 0x0064, 'e': 0x0065,
    'f': 0x0066, 'g': 0x0067, 'h': 0x0068, 'i': 0x0069, 'j': 0x006a,
    'k': 0x006b, 'l': 0x006c, 'm': 0x006d, 'n': 0x006e, 'o': 0x006f,
    'p': 0x0070, 'q': 0x0071, 'r': 0x0072, 's': 0x0073, 't': 0x0074,
    'u': 0x0075, 'v': 0x0076, 'w': 0x0077, 'x': 0x0078, 'y': 0x0079,
    'z': 0x007a,
    
    // Letters (uppercase)
    'A': 0x0041, 'B': 0x0042, 'C': 0x0043, 'D': 0x0044, 'E': 0x0045,
    'F': 0x0046, 'G': 0x0047, 'H': 0x0048, 'I': 0x0049, 'J': 0x004a,
    'K': 0x004b, 'L': 0x004c, 'M': 0x004d, 'N': 0x004e, 'O': 0x004f,
    'P': 0x0050, 'Q': 0x0051, 'R': 0x0052, 'S': 0x0053, 'T': 0x0054,
    'U': 0x0055, 'V': 0x0056, 'W': 0x0057, 'X': 0x0058, 'Y': 0x0059,
    'Z': 0x005a,
    
    // Numbers
    '0': 0x0030, '1': 0x0031, '2': 0x0032, '3': 0x0033, '4': 0x0034,
    '5': 0x0035, '6': 0x0036, '7': 0x0037, '8': 0x0038, '9': 0x0039,
    
    // Special keys
    'Return': 0xff0d, 'return': 0xff0d, 'Enter': 0xff0d, 'enter': 0xff0d, 
    'Tab': 0xff09, 'tab': 0xff09, 
    'BackSpace': 0xff08, 'Backspace': 0xff08, 'backspace': 0xff08,
    'Delete': 0xffff, 'delete': 0xffff,
    'Escape': 0xff1b, 'escape': 0xff1b, 'Esc': 0xff1b,
    'Space': 0x0020, 'space': 0x0020, ' ': 0x0020,
    
    // Navigation keys
    'Home': 0xff50, 'home': 0xff50,
    'End': 0xff57, 'end': 0xff57,
    'Page_Up': 0xff55, 'PageUp': 0xff55, 'pageup': 0xff55, 'Page Up': 0xff55,
    'Page_Down': 0xff56, 'PageDown': 0xff56, 'pagedown': 0xff56, 'Page Down': 0xff56,
    'Insert': 0xff63, 'insert': 0xff63,
    
    // Arrow keys
    'Up': 0xff52, 'up': 0xff52, 'Down': 0xff54, 'down': 0xff54, 
    'Left': 0xff51, 'left': 0xff51, 'Right': 0xff53, 'right': 0xff53,
    
    // Function keys
    'F1': 0xffbe, 'f1': 0xffbe, 'F2': 0xffbf, 'f2': 0xffbf, 
    'F3': 0xffc0, 'f3': 0xffc0, 'F4': 0xffc1, 'f4': 0xffc1,
    'F5': 0xffc2, 'f5': 0xffc2, 'F6': 0xffc3, 'f6': 0xffc3, 
    'F7': 0xffc4, 'f7': 0xffc4, 'F8': 0xffc5, 'f8': 0xffc5,
    'F9': 0xffc6, 'f9': 0xffc6, 'F10': 0xffc7, 'f10': 0xffc7, 
    'F11': 0xffc8, 'f11': 0xffc8, 'F12': 0xffc9, 'f12': 0xffc9,
    
    // Modifier keys
    'Ctrl': 0xffe3, 'ctrl': 0xffe3, 'Control': 0xffe3, 'control': 0xffe3,
    'Shift': 0xffe1, 'shift': 0xffe1, 'Alt': 0xffe9, 'alt': 0xffe9,
    'Super': 0xffeb, 'super': 0xffeb, 'Meta': 0xffe7, 'meta': 0xffe7, 
    'Cmd': 0xffe7, 'cmd': 0xffe7, 'Win': 0xffeb, 'win': 0xffeb,
    
    // Common symbols (base/unshifted characters)
    '-': 0x002d, '=': 0x003d, '[': 0x005b, ']': 0x005d,
    '\\': 0x005c, ';': 0x003b, "'": 0x0027, ',': 0x002c, 
    '.': 0x002e, '/': 0x002f, '`': 0x0060,
    
    // Special characters - direct keysym codes (bypassing Shift combinations)
    '!': 0x0021, '@': 0x0040, '#': 0x0023, '$': 0x0024, '%': 0x0025,
    '^': 0x005e, '&': 0x0026, '*': 0x002a, '(': 0x0028, ')': 0x0029,
    '_': 0x005f, '+': 0x002b, '{': 0x007b, '}': 0x007d, '|': 0x007c,
    ':': 0x003a, '"': 0x0022, '<': 0x003c, '>': 0x003e, '?': 0x003f,
    '~': 0x007e
  };

  return keyMap[key] || key.charCodeAt(0);
}

export function charNeedsShift(char: string): boolean {
  // Characters that typically require shift on standard keyboards
  const shiftChars = '~!@#$%^&*()_+{}|:"<>?';
  return shiftChars.includes(char);
}

export function getUnshiftedChar(char: string): string {
  // Mapping of shifted characters to their unshifted versions on standard US keyboard
  const shiftMap: Record<string, string> = {
    '~': '`', '!': '1', '@': '2', '#': '3', '$': '4', '%': '5', '^': '6',
    '&': '7', '*': '8', '(': '9', ')': '0', '_': '-', '+': '=', '{': '[',
    '}': ']', '|': '\\', ':': ';', '"': "'", '<': ',', '>': '.', '?': '/'
  };
  return shiftMap[char] || char;
}
