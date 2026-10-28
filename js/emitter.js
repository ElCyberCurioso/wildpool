export class Emitter {
  constructor() { this._h = new Map(); }
  on(ev, fn) {
    if (!this._h.has(ev)) this._h.set(ev, new Set());
    this._h.get(ev).add(fn);
    return () => this._h.get(ev)?.delete(fn);
  }
  emit(ev, ...args) {
    for (const fn of [...(this._h.get(ev) || [])]) {
      try { fn(...args); } catch (e) { console.error(e); }
    }
  }
  clear() { this._h.clear(); }
}
