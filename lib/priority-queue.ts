/** Stable min-heap: selecting the next search state costs O(log n). */
export class PriorityQueue<T> {
  private values: { value: T; order: number }[] = [];
  private order = 0;
  constructor(private compare: (a: T, b: T) => number) {}
  get length() { return this.values.length; }
  private less(a: { value: T; order: number }, b: { value: T; order: number }) {
    return (this.compare(a.value, b.value) || a.order - b.order) < 0;
  }
  push(value: T) {
    const entry = { value, order: this.order++ };
    let index = this.values.length;
    this.values.push(entry);
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (!this.less(entry, this.values[parent])) break;
      this.values[index] = this.values[parent]; index = parent;
    }
    this.values[index] = entry;
  }
  shift(): T | undefined {
    if (!this.values.length) return undefined;
    const first = this.values[0];
    const last = this.values.pop()!;
    if (this.values.length) {
      let index = 0;
      while (index * 2 + 1 < this.values.length) {
        let child = index * 2 + 1;
        if (child + 1 < this.values.length && this.less(this.values[child + 1], this.values[child])) child++;
        if (!this.less(this.values[child], last)) break;
        this.values[index] = this.values[child]; index = child;
      }
      this.values[index] = last;
    }
    return first.value;
  }
}
