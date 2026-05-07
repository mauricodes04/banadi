// Token bucket: capacity 5, refill 1 token / 6s.
// `acquire()` returns immediately if a token is free, otherwise queues
// behind the next refill tick. Single-flight FIFO queue, no shared mutex
// held across awaits.

export class TokenBucket {
  constructor({ capacity = 5, refillMs = 6000 } = {}) {
    this.capacity = capacity;
    this.refillMs = refillMs;
    this.tokens = capacity;
    this.lastRefill = Date.now();
    this.queue = [];
  }

  _refill() {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    if (elapsed <= 0) return;
    const gained = Math.floor(elapsed / this.refillMs);
    if (gained > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + gained);
      this.lastRefill += gained * this.refillMs;
    }
  }

  _drain() {
    while (this.queue.length > 0 && this.tokens > 0) {
      this.tokens -= 1;
      const resolve = this.queue.shift();
      resolve();
    }
    if (this.queue.length > 0) {
      const wait = Math.max(0, this.lastRefill + this.refillMs - Date.now());
      setTimeout(() => {
        this._refill();
        this._drain();
      }, wait + 1);
    }
  }

  acquire() {
    this._refill();
    if (this.tokens > 0 && this.queue.length === 0) {
      this.tokens -= 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.queue.push(resolve);
      this._drain();
    });
  }
}
