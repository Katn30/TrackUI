import { ITracked } from "./ITracked";
import { Tracker } from "./Tracker";
import { OperationProperties } from "./OperationProperties";
import { PropertyType } from "./PropertyType";
import { TypedEvent } from "./TypedEvent";
import { TrackedObjectBase } from "./TrackedObjectBase";

export class TrackedCollection<T> implements Array<T>, ITracked {
  private _collection: T[];
  private _isDirty: boolean;
  private _isValid: boolean;
  private _dirtyCounter: number = 0;
  private _error: string | undefined;

  public get dirtyCounter(): number {
    return this._dirtyCounter;
  }
  private set dirtyCounter(value: number) {
    this._dirtyCounter = value;
  }

  public get isDirty(): boolean {
    return this._isDirty;
  }
  private set isDirty(value: boolean) {
    this._isDirty = value;
  }

  public get isValid(): boolean {
    return this._isValid;
  }
  private set isValid(value: boolean) {
    this._isValid = value;
  }

  public get length(): number {
    return this.collection.length;
  }

  public get lastItemIndex(): number | undefined {
    return this.collection.length > 0 ? this.collection.length - 1 : undefined;
  }

  public get collection(): T[] {
    return this._collection;
  }
  private set collection(value: T[]) {
    this._collection = value;
  }

  public get [Symbol.iterator]() {
    return this.collection[Symbol.iterator].bind(this.collection);
  }

  public get [Symbol.unscopables]() {
    return this.collection[Symbol.unscopables];
  }

  public readonly changed: TypedEvent<TrackedCollectionChanged<T>> =
    new TypedEvent<TrackedCollectionChanged<T>>();

  [n: number]: T;

  public get error(): string | undefined {
    return this._error;
  }
  public set error(value: string | undefined) {
    this._error = value;
  }

  public constructor(
    public readonly tracker: Tracker,
    items?: T[],
    private readonly _validator?: (value: T[]) => string | undefined,
  ) {
    this._isValid = true;
    this._isDirty = false;
    this._collection = items ? [...items] : [];
    this.validate();
    this.tracker.trackCollection(this);
  }

  public validate(): void {
    this.error = this._validator ? this._validator(this.collection) : undefined;
    this.isValid = this.error === undefined;
  }

  public splice(start: number, deleteCount: number, ...items: T[]): T[] {
    let removed: T[];

    this.tracker.doAndTrack(
      () => {
        if (removed !== undefined) {
          this.doSplice(start, deleteCount, items, removed);
        } else {
          removed = this.doSplice(start, deleteCount, items);
        }
        this.trackRemovedObjectDeletions(removed);
      },
      () => this.undoSplice(start, items, removed),
      new OperationProperties(this, undefined, PropertyType.Collection),
    );

    return removed!;
  }

  private doSplice(
    start: number,
    deleteCount: number,
    items: T[],
    reusedRemoved?: T[],
  ): T[] {
    let removed: T[];
    let event: TrackedCollectionChanged<T>;

    this.tracker.withTrackingSuppressed(() => {
      removed = this.collection.splice(start, deleteCount, ...items);
      this.collection = [...this.collection];
      event = new TrackedCollectionChanged<T>(items, removed, this.collection);
    });

    this.changed.emit(event!);

    return reusedRemoved ?? removed!;
  }

  private trackRemovedObjectDeletions(removed: T[]): void {
    for (const item of removed) {
      if (item instanceof TrackedObjectBase) {
        item.markDeletion();
      }
    }
  }

  private undoSplice(start: number, items: T[], removed: T[]): void {
    this.tracker.withTrackingSuppressed(() => {
      this.collection.splice(start, items?.length ?? 0, ...removed);
      this.collection = [...this.collection];
      const event = new TrackedCollectionChanged<T>(
        removed,
        items,
        this.collection,
      );
      this.changed.emit(event);
    });
  }

  public reset(newItems: T[]): void {
    this.splice(0, this.collection.length, ...newItems);
  }

  public reverse(): T[] {
    this.collection.reverse();
    return this.collection;
  }

  public sort(compareFn?: (a: T, b: T) => number): this {
    if (this.length === 0) {
      return this;
    }
    this.collection.sort(compareFn);
    return this;
  }

  public clear(): void {
    if (this.length === 0) {
      return;
    }
    this.splice(0, this.length);
  }

  public remove(item: T): boolean {
    const itemIndex = this.collection.indexOf(item);
    if (itemIndex < 0) {
      return false;
    }

    this.splice(itemIndex, 1);

    return true;
  }

  public replace(item: T, replace: T): boolean {
    const itemIndex = this.collection.indexOf(item);
    if (itemIndex < 0) {
      return false;
    }

    this.splice(itemIndex, 1, replace);

    return true;
  }

  public replaceAt(index: number, replace: T): void {
    this.splice(index, 1, replace);
  }

  public pop(): T | undefined {
    return this.length === 0
      ? undefined
      : this.splice(this.collection.length - 1, 1)[0];
  }

  public push(...items: T[]): number {
    if (!items || items.length === 0) {
      return this.length;
    }
    this.splice((this.lastItemIndex ?? -1) + 1, 0, ...items);

    return this.length;
  }

  public concat(...items: (T | ConcatArray<T>)[]): T[] {
    return this.collection.concat(...items);
  }

  public join(separator?: string): string {
    return this.collection.join(separator);
  }

  public shift(): T | undefined {
    return this.length === 0 ? undefined : this.splice(0, 1)[0];
  }

  public slice(start?: number, end?: number): T[] {
    return this.collection.slice(start, end);
  }

  public unshift(...items: T[]): number {
    this.splice(0, 0, ...items);
    return this.length;
  }

  public indexOf(searchElement: T, fromIndex?: number): number {
    return this.collection.indexOf(searchElement, fromIndex);
  }

  public lastIndexOf(searchElement: T, fromIndex?: number): number {
    return fromIndex !== undefined
      ? this.collection.lastIndexOf(searchElement, fromIndex)
      : this.collection.lastIndexOf(searchElement);
  }

  public every<S extends T>(
    predicate: (value: T, index: number, array: T[]) => value is S,
    thisArg?: any,
  ): this is S[];
  public every(
    predicate: (value: T, index: number, array: T[]) => unknown,
    thisArg?: any,
  ): boolean;
  public every(
    predicate: (value: T, index: number, array: T[]) => unknown,
    thisArg?: any,
  ): boolean {
    return this.collection.every(predicate as any, thisArg);
  }

  public some(
    predicate: (value: T, index: number, array: T[]) => unknown,
    thisArg?: any,
  ): boolean {
    return this.collection.some(predicate, thisArg);
  }

  public forEach(
    callbackfn: (value: T, index: number, array: T[]) => void,
    thisArg?: any,
  ): void {
    this.collection.forEach(callbackfn, thisArg);
  }

  public map<U>(
    callbackfn: (value: T, index: number, array: T[]) => U,
    thisArg?: any,
  ): U[] {
    return this.collection.map(callbackfn, thisArg);
  }

  public filter(
    predicate: (value: T, index: number, array: T[]) => unknown,
    thisArg?: any,
  ): T[] {
    return this.collection.filter(predicate, thisArg);
  }

  public find(
    predicate: (value: T, index: number, obj: T[]) => unknown,
    thisArg?: any,
  ): T | undefined {
    return this.collection.find(predicate, thisArg);
  }

  public findIndex(
    predicate: (value: T, index: number, obj: T[]) => unknown,
    thisArg?: any,
  ): number {
    return this.collection.findIndex(predicate, thisArg);
  }

  public flatMap<U, This = undefined>(
    callback: (
      this: This,
      value: T,
      index: number,
      array: T[],
    ) => U | ReadonlyArray<U>,
    thisArg?: This,
  ): U[] {
    return this.collection.flatMap(callback, thisArg);
  }

  public includes(searchElement: T, fromIndex?: number): boolean {
    return this.collection.includes(searchElement, fromIndex);
  }

  public toString(): string {
    return this.collection.toString();
  }

  public toLocaleString(): string {
    return this.collection.toLocaleString();
  }

  public entries(): ArrayIterator<[number, T]> {
    return this.collection.entries() as unknown as ArrayIterator<[number, T]>;
  }

  public keys(): ArrayIterator<number> {
    return this.collection.keys() as unknown as ArrayIterator<number>;
  }

  public values(): ArrayIterator<T> {
    return this.collection.values() as unknown as ArrayIterator<T>;
  }

  public at(index: number): T | undefined {
    return this.collection.at(index);
  }

  public fill(value: T, start?: number, end?: number): this {
    const len = this.length;
    const s =
      start === undefined
        ? 0
        : start < 0
          ? Math.max(len + start, 0)
          : Math.min(start, len);
    const e =
      end === undefined
        ? len
        : end < 0
          ? Math.max(len + end, 0)
          : Math.min(end, len);
    if (s >= e) return this;
    this.splice(s, e - s, ...new Array<T>(e - s).fill(value));
    return this;
  }

  public copyWithin(target: number, start: number, end?: number): this {
    const len = this.length;
    const t = target < 0 ? Math.max(len + target, 0) : Math.min(target, len);
    const s = start < 0 ? Math.max(len + start, 0) : Math.min(start, len);
    const e =
      end === undefined
        ? len
        : end < 0
          ? Math.max(len + end, 0)
          : Math.min(end, len);
    const itemsToCopy = this.collection.slice(s, e);
    const count = Math.min(itemsToCopy.length, len - t);
    if (count > 0) {
      this.splice(t, count, ...itemsToCopy.slice(0, count));
    }
    return this;
  }

  public reduce(
    callbackfn: (
      previousValue: T,
      currentValue: T,
      currentIndex: number,
      array: T[],
    ) => T,
    initialValue?: T,
  ): T {
    return initialValue !== undefined
      ? this.collection.reduce(callbackfn, initialValue)
      : this.collection.reduce(callbackfn);
  }

  public reduceRight(
    callbackfn: (
      previousValue: T,
      currentValue: T,
      currentIndex: number,
      array: T[],
    ) => T,
    initialValue?: T,
  ): T {
    return initialValue !== undefined
      ? this.collection.reduceRight(callbackfn, initialValue)
      : this.collection.reduceRight(callbackfn);
  }

  public flat<A, D extends number = 1>(this: A, depth?: D): FlatArray<A, D>[] {
    return ((this as any)._collection as any[]).flat(depth) as FlatArray<
      A,
      D
    >[];
  }

  public findLast(
    predicate: (value: T, index: number, array: T[]) => unknown,
    thisArg?: any,
  ): T | undefined {
    return this.collection.findLast(predicate, thisArg);
  }

  public findLastIndex(
    predicate: (value: T, index: number, array: T[]) => unknown,
    thisArg?: any,
  ): number {
    return this.collection.findLastIndex(predicate, thisArg);
  }

  public toReversed(): T[] {
    return this.collection.toReversed();
  }

  public toSorted(compareFn?: (a: T, b: T) => number): T[] {
    return this.collection.toSorted(compareFn);
  }

  public toSpliced(start: number, deleteCount: number, ...items: T[]): T[] {
    return this.collection.toSpliced(start, deleteCount, ...items);
  }

  public with(index: number, value: T): T[] {
    return this.collection.with(index, value);
  }

  public first(): T | undefined {
    return this.collection.length > 0 ? this.collection[0] : undefined;
  }

  public destroy(): void {
    this.tracker.untrackCollection(this);
  }
}

export class TrackedCollectionChanged<T> {
  constructor(
    public readonly added: T[],
    public readonly removed: T[],
    public readonly newCollection: T[],
  ) {}
}

declare global {
  interface ArrayIterator<T> extends IterableIterator<T> {
    map<U>(callback: (value: T) => U): ArrayIterator<U>;
    filter(predicate: (value: T) => boolean): ArrayIterator<T>;
    take(count: number): ArrayIterator<T>;
    drop(count: number): ArrayIterator<T>;
    flatMap<U>(callback: (value: T) => U[]): ArrayIterator<U>;
    reduce<U>(callback: (acc: U, value: T) => U, initialValue: U): U;
    toArray(): T[];
    forEach(callback: (value: T) => void): void;
    some(predicate: (value: T) => boolean): boolean;
    every(predicate: (value: T) => boolean): boolean;
    find(predicate: (value: T) => boolean): T | undefined;
  }
}
