/* Heal Earth modification, GPL-3.0-or-later. */
// Asyncify SQLite permits only one active asynchronous call per WASM instance.
export class OperationQueue {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation);
    this.tail = result.catch(() => undefined);
    return result;
  }
}
