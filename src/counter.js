// 관객 번호 카운터. 새 세션마다 1씩 늘고, localStorage 에 남아 재시작 후에도 이어진다.
const LS_KEY = 'spacingout.counter';

export class Counter {
  constructor() {
    this.value = 0;
    try {
      this.value = parseInt(localStorage.getItem(LS_KEY) || '0', 10) || 0;
    } catch { /* noop */ }
  }
  next() {
    this.value++;
    this.save();
    return this.value;
  }
  set(v) {
    this.value = Math.max(0, v | 0);
    this.save();
  }
  save() {
    try {
      localStorage.setItem(LS_KEY, String(this.value));
    } catch { /* noop */ }
  }
}
