// src/lab/aux-str/buffer.ts
import type { Point } from "../str-aux/types";

/**
 * Tick → ring of 40s points → circular (handled separately)
 * Here we offer a tiny in-memory ring for dev. Swap for your scheduler/bus later.
 */
export class RingBuffer {
  private buf: Point[] = [];
  private max: number;
  constructor(max: number) {
    this.max = Math.max(1, max);
  }
  push(p: Point) {
    this.buf.push(p);
    if (this.buf.length > this.max) this.buf.shift();
  }
  values() { return this.buf.slice(); }
  clear() { this.buf = []; }
}
