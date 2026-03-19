# TrackUI

A TypeScript library for frontend state management — undo/redo, dirty tracking, validation, and server-assigned ID handling.

Built on the **TC39 decorator standard** (Stage 3). Requires TypeScript 5+ with `experimentalDecorators` **not** set.

## Installation

```bash
npm install trackui
```

```json
// tsconfig.json — no experimentalDecorators needed
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"]
  }
}
```

---

## Quick Start

```typescript
import {
  Tracker,
  TrackedObject,
  InitializeTracked,
  Tracked,
  TrackedCollection,
} from 'trackui';

const tracker = new Tracker();

@InitializeTracked
class InvoiceModel extends TrackedObject {
  @Tracked()
  accessor status: string = '';

  @Tracked((self, value) => !value ? 'Status is required' : undefined)
  accessor total: number = 0;

  readonly lines: TrackedCollection<string>;

  constructor(tracker: Tracker) {
    super(tracker);
    this.lines = new TrackedCollection(tracker);
  }
}

const invoice = new InvoiceModel(tracker);

invoice.status = 'draft';     // recorded
invoice.total = 100;          // recorded
invoice.lines.push('item-1'); // recorded

tracker.isDirty;   // true
tracker.canUndo;   // true

tracker.undo();    // reverts lines.push
tracker.undo();    // reverts total
tracker.undo();    // reverts status

tracker.isDirty;   // false
```

---

## Concepts

### Undo/redo strategy

The two common patterns for implementing undo/redo are:

- **Command** — every change stores a `redoAction` and an `undoAction` closure pair. Undoing calls the inverse function; redoing calls the original. No state is copied.
- **Memento** — the entire state (or a relevant slice) is snapshotted before each change and restored on undo. Simpler to implement because no inverse logic is required, but carries memory and copying overhead on every change.

TrackUI uses the **Command pattern** because, once correctly implemented, it is strictly more efficient: no memory overhead, no copying, and undo granularity is exactly as fine or coarse as designed.

### How undo steps are created

Every tracked write — a `@Tracked()` property assignment or a `TrackedCollection` mutation — becomes its own undo step **unless** it fires as a synchronous side-effect of another tracked write that is already in progress.

```
invoice.status = 'void'          → undo step A
invoice.lines.clear()            → undo step B   (independent)
```

If a `TrackedCollection.changed` listener updates a `@Tracked()` property synchronously, both the collection mutation and the property update land in the **same** undo step:

```
order.items.push('x')            → undo step A
  └─ changed listener: order.itemCount = 1   (nested, same step A)

tracker.undo()  →  items back to [], itemCount back to 0
```

This nesting is detected automatically. No extra API is needed.

### String and number aggregation

Rapid consecutive writes to the same `string` or `number` property on the same model are merged into a single undo step when they fall within the `coalescingWindowMs` threshold passed to the `Tracker` constructor (default: `3000` ms). Pass `undefined` to disable coalescing entirely.

```typescript
```typescript
invoice.status = 'd';
invoice.status = 'dr';
invoice.status = 'dra';
invoice.status = 'draft';

tracker.undo(); // reverts all four at once → status = ''
```

`Date`, `boolean`, and `object` properties are never coalesced.

### Construction is always suppressed

`@InitializeTracked` wraps the constructor so that all property writes during construction are silently applied without creating undo entries. The tracker is clean and `canUndo` is `false` immediately after `new Model(tracker)`.

---

## API Reference

### `Tracker`

The central coordinator. Create one per page or form context and pass it to every model and collection.

```typescript
const tracker = new Tracker();                  // coalescing enabled, 3 second window
const tracker = new Tracker(5000);              // coalesce writes within 5 seconds
const tracker = new Tracker(undefined);         // coalescing disabled
```

**State properties**

| Property | Type | Description |
|---|---|---|
| `isDirty` | `boolean` | `true` when uncommitted changes exist |
| `canUndo` | `boolean` | `true` when there is at least one undo step |
| `canRedo` | `boolean` | `true` when there are undone steps to redo |
| `isValid` | `boolean` | `true` when every registered model and collection passes validation |
| `canCommit` | `boolean` | `true` when `isDirty && isValid` — ready to submit to the server |
| `isDirtyChanged` | `TypedEvent<boolean>` | Fires whenever `isDirty` changes |
| `isValidChanged` | `TypedEvent<boolean>` | Fires whenever `isValid` changes |
| `canCommitChanged` | `TypedEvent<boolean>` | Fires whenever `canCommit` changes |
| `tracked` | `TrackedObject[]` | All registered models |
| `trackedCollections` | `TrackedCollection<any>[]` | All registered collections |

**Undo / redo**

```typescript
tracker.undo();  // reverts the last undo step
tracker.redo();  // re-applies the last undone step
```

Calling `undo()` or `redo()` when the respective flag is `false` is a no-op.

**Commit lifecycle**

```typescript
tracker.afterCommit();           // mark current state as committed — isDirty → false
tracker.afterCommit(keys);       // same, plus swap placeholder IDs for real server IDs
tracker.beforeCommit();          // assign temporary negative IDs to new models before committing
```

`afterCommit()` also resets the placeholder ID counter to `-1` so the next commit cycle starts fresh.

**Tracking suppression**

```typescript
// Callback form — preferred
tracker.withTrackingSuppressed(() => {
  model.field = 'silent';   // applied but not recorded, not dirty
});

// Explicit begin/end — useful when the suppressed block spans async boundaries
tracker.beginSuppressTracking();
model.field = 'silent';
tracker.endSuppressTracking();
```

Suppression is **nestable** via a counter, so calling `beginSuppressTracking()` twice requires two `endSuppressTracking()` calls to resume tracking.

---

### `TrackedObject` + `@InitializeTracked`

`TrackedObject` is the abstract base class for all trackable models. Every subclass must also be decorated with `@InitializeTracked`.

```typescript
@InitializeTracked
class InvoiceModel extends TrackedObject {
  constructor(tracker: Tracker) {
    super(tracker); // registers the model with the tracker
  }
}
```

The `@InitializeTracked` decorator:
- Suppresses tracking for the entire constructor body
- Runs validators once after construction
- Triggers a tracker-wide revalidation

**Model properties and methods**

| Member | Type | Description |
|---|---|---|
| `tracker` | `Tracker` | The tracker this model belongs to (set via `super(tracker)`) |
| `isDirty` | `boolean` | `true` when this model has uncommitted changes |
| `dirtyCounter` | `number` | Net number of tracked changes since last save. Increments on every tracked write, decrements on undo |
| `isValid` | `boolean` | `true` when all `@Tracked()` validators pass |
| `validationMessages` | `Map<string, string>` | Maps property name → error message for each failing validator |
| `destroy()` | `void` | Removes this model from the tracker |
| `onCommitted()` | `void` | Called automatically by `tracker.afterCommit()` — resets `dirtyCounter` to `0` |

---

### `@Tracked()`

The property decorator. Intercepts every write, records an undo/redo pair, and optionally validates the new value. Works with both `accessor` fields and explicit `get`/`set` pairs. Place it on the **accessor** or the **setter**.

**With `accessor` (recommended):**

```typescript
@InitializeTracked
class ProductModel extends TrackedObject {
  @Tracked()
  accessor name: string = '';

  @Tracked()
  accessor price: number = 0;

  @Tracked()
  accessor active: boolean = true;

  @Tracked()
  accessor config: Record<string, unknown> = {};

  @Tracked()
  accessor createdAt: Date = new Date();

  constructor(tracker: Tracker) {
    super(tracker);
  }
}
```

**With `get`/`set`** — decorate the setter:

```typescript
@InitializeTracked
class ProductModel extends TrackedObject {
  private _name: string = '';

  get name(): string { return this._name; }

  @Tracked()
  set name(value: string) { this._name = value; }

  constructor(tracker: Tracker) {
    super(tracker);
  }
}
```

**With a validator:**

The validator receives the model instance and the incoming value. Return an error string to fail, `undefined` to pass.

```typescript
@InitializeTracked
class OrderModel extends TrackedObject {
  @Tracked((self, value) => !value ? 'Status is required' : undefined)
  accessor status: string = '';

  @Tracked((self, value) => value < 0 ? 'Price must be positive' : undefined)
  accessor price: number = 0;

  // Validator can inspect other properties of the model
  @Tracked((self: OrderModel, value) =>
    value > self.price ? 'Discount exceeds price' : undefined
  )
  accessor discount: number = 0;

  constructor(tracker: Tracker) {
    super(tracker);
  }
}
```

Validators are re-evaluated after every tracked write and after every undo/redo. Results are stored in `model.validationMessages` and rolled up into `tracker.isValid`.

**No-op detection**

Assigning the same value twice does not create an undo step and does not mark the model dirty. `null` and `undefined` are treated as equivalent to `''` for string properties.

```typescript
invoice.status = '';      // no-op (already '')
invoice.status = null;    // no-op (null ≡ '')
invoice.status = 'draft'; // recorded
invoice.status = 'draft'; // no-op
```

**Supported property types:** `string`, `number`, `boolean`, `Date`, `object`. Unsupported types throw at runtime.

---

### `TrackedCollection<T>`

A fully array-compatible tracked collection. All mutations are recorded and undoable. Implements `Array<T>` so it works anywhere an array is expected.

```typescript
const items = new TrackedCollection<string>(tracker);

// With initial items:
const items = new TrackedCollection<string>(tracker, ['a', 'b']);

// With a validator:
const items = new TrackedCollection<string>(
  tracker,
  [],
  (list) => list.length === 0 ? 'At least one item is required' : undefined,
);
```

**Tracked mutation methods**

All of these create undo steps:

| Method | Description |
|---|---|
| `push(...items)` | Appends one or more items |
| `pop()` | Removes and returns the last item |
| `shift()` | Removes and returns the first item |
| `unshift(...items)` | Prepends one or more items |
| `splice(start, deleteCount, ...items)` | Low-level insert/remove at a position |
| `remove(item)` | Removes a specific item by reference. Returns `false` if not found |
| `replace(item, replacement)` | Replaces a specific item by reference. Returns `false` if not found |
| `replaceAt(index, replacement)` | Replaces the item at a given index |
| `clear()` | Removes all items |
| `reset(newItems)` | Replaces the entire collection with a new array |
| `fill(value, start?, end?)` | Fills a range with a value |
| `copyWithin(target, start, end?)` | Copies a slice to another position |

**Read-only / non-mutating methods**

`indexOf`, `lastIndexOf`, `includes`, `find`, `findIndex`, `findLast`, `findLastIndex`, `every`, `some`, `forEach`, `map`, `filter`, `flatMap`, `reduce`, `reduceRight`, `concat`, `join`, `slice`, `at`, `entries`, `keys`, `values`, `flat`, `reverse`, `sort`, `toReversed`, `toSorted`, `toSpliced`, `with`, `toString`, `toLocaleString`

**Additional properties**

| Member | Description |
|---|---|
| `length` | Number of items |
| `isDirty` | `true` when the collection has unsaved mutations |
| `isValid` | `true` when the validator passes (or no validator was provided) |
| `error` | The current validation error message, or `undefined` |
| `changed` | `TypedEvent<TrackedCollectionChanged<T>>` — fires after every mutation |
| `first()` | Returns the first item, or `undefined` if empty |
| `destroy()` | Removes the collection from the tracker |

**The `changed` event**

`TrackedCollectionChanged<T>` carries:

| Property | Description |
|---|---|
| `added` | Items that were inserted |
| `removed` | Items that were removed |
| `newCollection` | The full collection after the mutation |

```typescript
items.changed.subscribe((e) => {
  console.log('added:', e.added);
  console.log('removed:', e.removed);
  console.log('now:', e.newCollection);
});
```

The `changed` event fires **outside** tracking suppression. This means a listener that writes to a `@Tracked()` property composes naturally with the collection mutation — both land in the same undo step:

```typescript
@InitializeTracked
class OrderModel extends TrackedObject {
  @Tracked()
  accessor itemCount: number = 0;

  readonly items: TrackedCollection<string>;

  constructor(tracker: Tracker) {
    super(tracker);
    this.items = new TrackedCollection(tracker);
    this.items.changed.subscribe(() => {
      this.itemCount = this.items.length; // composed into the same undo step
    });
  }
}

const order = new OrderModel(tracker);
order.items.push('x');  // itemCount becomes 1

tracker.undo();         // items back to [], itemCount back to 0
```

---

### `@ExternallyAssigned`

Marks a numeric ID property as assigned by an external system (e.g. a database). Enables the `beforeCommit` / `afterCommit` lifecycle for ID management.

```typescript
@InitializeTracked
class InvoiceModel extends TrackedObject {
  @ExternallyAssigned
  id: number = 0;

  @Tracked()
  accessor status: string = '';

  constructor(tracker: Tracker) {
    super(tracker);
  }
}
```

**Typical save flow:**

```typescript
const invoice = new InvoiceModel(tracker);
invoice.status = 'draft';

// 1. Just before sending to the server:
tracker.beforeCommit();
// invoice.id is now -1 (a temporary placeholder)
// Multiple new models get -1, -2, -3, ...

// 2. Send to server, receive real IDs back:
const serverIds = [{ placeholder: invoice.id, value: 42 }];

// 3. Apply real IDs and mark clean:
tracker.afterCommit(serverIds);
// invoice.id is now 42
// tracker.isDirty is false
```

`beforeCommit()` only assigns a placeholder if the property's current value is `0` (the default). Models that already have a positive ID are left untouched.

`afterCommit()` with no arguments (or an empty array) still marks the tracker as clean — it just skips the ID replacement step.

The placeholder counter resets to `-1` after each `afterCommit()`, so the next commit cycle always starts fresh.

---

### `TypedEvent<T>`

A lightweight, strongly-typed event emitter. Used internally for `tracker.isDirtyChanged`, `tracker.isValidChanged`, and `TrackedCollection.changed`, and available for your own use.

```typescript
const event = new TypedEvent<string>();

// subscribe returns an unsubscribe function
const unsubscribe = event.subscribe((value) => {
  console.log('received:', value);
});

event.emit('hello');  // → "received: hello"

unsubscribe();        // stop listening

event.emit('world');  // → (nothing)
```

| Method | Returns | Description |
|---|---|---|
| `subscribe(handler)` | `() => void` | Registers a listener. Returns an unsubscriber |
| `unsubscribe(handler)` | `void` | Removes a specific listener |
| `emit(value)` | `void` | Calls all registered listeners with the given value |

---

## Full example — form with undo, validation, and save lifecycle

```typescript
import {
  Tracker,
  TrackedObject,
  InitializeTracked,
  Tracked,
  TrackedCollection,
  ExternallyAssigned,
} from 'trackui';

const tracker = new Tracker();

@InitializeTracked
class LineItem extends TrackedObject {
  @ExternallyAssigned
  id: number = 0;

  @Tracked((_, v) => !v ? 'Description is required' : undefined)
  accessor description: string = '';

  @Tracked((_, v) => v <= 0 ? 'Quantity must be positive' : undefined)
  accessor quantity: number = 1;

  constructor(tracker: Tracker) {
    super(tracker);
  }
}

@InitializeTracked
class InvoiceModel extends TrackedObject {
  @ExternallyAssigned
  id: number = 0;

  @Tracked((_, v) => !v ? 'Status is required' : undefined)
  accessor status: string = '';

  readonly lines: TrackedCollection<LineItem>;

  constructor(tracker: Tracker) {
    super(tracker);
    this.lines = new TrackedCollection<LineItem>(
      tracker,
      [],
      (list) => list.length === 0 ? 'At least one line is required' : undefined,
    );
  }
}

// --- Usage ---

const invoice = new InvoiceModel(tracker);
const line1 = new LineItem(tracker);

invoice.status = 'draft';
line1.description = 'Widget';
line1.quantity = 5;
invoice.lines.push(line1);

tracker.isDirty;        // true
tracker.isValid;        // true

tracker.undo();         // removes line1 from invoice.lines
tracker.isValid;        // false — collection is now empty

tracker.redo();         // re-adds line1
tracker.isValid;        // true

// Before saving to the server:
tracker.beforeCommit();
// invoice.id === -1, line1.id === -2

const response = [
  { placeholder: -1, value: 100 },
  { placeholder: -2, value: 201 },
];
tracker.afterCommit(response);
// invoice.id === 100, line1.id === 201
// tracker.isDirty === false

// React to save-readiness changes:
tracker.canCommitChanged.subscribe((canCommit) => {
  saveButton.disabled = !canCommit;
});
```

---

## License

MIT — Nazario Mazzotti
