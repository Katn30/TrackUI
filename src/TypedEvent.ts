export class TypedEvent<T> {
  private readonly _handlers: ((event: T) => void)[] = [];

  public subscribe(handler: (event: T) => void): () => void {
    this._handlers.push(handler);
    return () => this.unsubscribe(handler);
  }

  public unsubscribe(handler: (event: T) => void): void {
    const index = this._handlers.indexOf(handler);
    if (index >= 0) {
      this._handlers.splice(index, 1);
    }
  }

  public emit(event: T): void {
    this._handlers.forEach((h) => h(event));
  }
}
