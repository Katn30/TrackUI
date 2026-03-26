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
invoice.status = 'd';
invoice.status = 'dr';
invoice.status = 'dra';
invoice.status = 'draft';

tracker.undo(); // reverts all four at once → status = ''
```

`Date`, `boolean`, and `object` properties are never coalesced.

To disable coalescing for a specific `string` or `number` property while leaving it enabled globally, pass `{ noCoalesce: true }` to `@Tracked()`:

```typescript
@Tracked(undefined, { noCoalesce: true })
accessor version: number = 0; // every increment is its own undo step
```

### Construction is always suppressed

`@InitializeTracked` wraps the constructor so that all property writes during construction are silently applied without creating undo entries. The tracker is clean and `canUndo` is `false` immediately after `new Model(tracker)`.

### Default state: Unchanged

Both `TrackedObject` and `VersionedTrackedObject` default to `Unchanged` at construction time. This matches the most common scenario — objects are loaded from the database and are already persisted.

```typescript
const item = new ItemModel(tracker); // state: Unchanged (DB-loaded default)
```

To create a **new** item that needs to be inserted, add it to a `TrackedCollection` via `push`. The collection is responsible for transitioning the object to `New`:

```typescript
const item = new ItemModel(tracker);
items.push(item);          // state: New  — tracked, undoable
tracker.undo();            // state: Unchanged, removed from collection
```

Items passed to the `TrackedCollection` **constructor** are treated as already-persisted rows and are **not** marked as `New`:

```typescript
const items = new TrackedCollection<ItemModel>(tracker, [dbItem]); // dbItem stays Unchanged
```

When you need a `New` object outside of a collection, pass the initial state explicitly:

```typescript
const item = new ItemModel(tracker, ItemState.New);
```

### Bulk construction

After each constructor, `@InitializeTracked` calls `tracker.revalidate()` to roll up validation state. For a single object this is fine, but constructing many objects in a loop means one full revalidation pass per object — O(n²) total.

To keep bulk creation O(n), wrap the loop in `tracker.withTrackingSuppressed()` and call `tracker.revalidate()` once afterward. `@InitializeTracked` detects that suppression is already active and skips its own `revalidate()` call:

```typescript
tracker.withTrackingSuppressed(() => {
  for (const row of serverRows) {
    const item = new ItemModel(tracker);
    item._committedState = VersionedObjectState.Unchanged;
    item.name = row.name;
  }
});
tracker.revalidate(); // one pass over all objects
```

> **Contract:** when you suppress tracking around bulk construction, you take responsibility for calling `tracker.revalidate()` once after the loop. Omitting it leaves `tracker.isValid` stale.

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
| `trackedObjects` | `TrackedObjectBase[]` | All registered models |
| `trackedCollections` | `TrackedCollection<any>[]` | All registered collections |

**Undo / redo**

```typescript
tracker.undo();  // reverts the last undo step
tracker.redo();  // re-applies the last undone step
```

Calling `undo()` or `redo()` when the respective flag is `false` is a no-op.

**Commit lifecycle**

```typescript
tracker.onCommit();           // mark current state as committed — isDirty → false
tracker.onCommit(keys);       // same, plus swap placeholder IDs for real server IDs
tracker.beforeCommit();       // assign temporary negative IDs to new models before committing
```

`onCommit()` automatically transitions every tracked object's `state` to `Unchanged` and appends the state change into the existing last undo operation — so undo atomically reverts both the user's edits and the committed state together (no spurious extra undo steps).

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

`TrackedObject` is the abstract base class for all trackable models in **non-versioned (standard CRUD) databases**. For versioned (temporal) databases see [`VersionedTrackedObject`](#versionedtrackedobject) below.

Every subclass must also be decorated with `@InitializeTracked`.

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
- Triggers a tracker-wide `revalidate()` — **unless** the caller has already suppressed tracking (see [Bulk construction](#bulk-construction) above)

**Model properties and methods**

| Member | Type | Description |
|---|---|---|
| `tracker` | `Tracker` | The tracker this model belongs to (set via `super(tracker)`) |
| `isDirty` | `boolean` | `true` when this model has uncommitted changes |
| `dirtyCounter` | `number` | Net number of tracked changes since last save. Increments on every tracked write, decrements on undo |
| `isValid` | `boolean` | `true` when all `@Tracked()` validators pass |
| `validationMessages` | `Map<string, string>` | Maps property name → error message for each failing validator |
| `state` | `ObjectState` | Computed DB operation required at save time |
| `_committedState` | `ObjectState` | The persisted state. Defaults to `Unchanged`. Pass `initialState` to the constructor to override |
| `destroy()` | `void` | Removes this model from the tracker |
| `onCommitted()` | `void` | Called automatically by `tracker.onCommit()` — resets `dirtyCounter` to `0` |

---

### `ObjectState`

Used by `TrackedObject` for non-versioned CRUD databases. Read via `obj.state`.

```typescript
import { ObjectState } from 'trackui';
```

| Value | Meaning | Required DB operation |
|---|---|---|
| `New` | Created by user, never saved | INSERT |
| `Unchanged` | Loaded from DB or just saved — no pending action | — |
| `Edited` | `Unchanged` + unsaved property changes (derived) | UPDATE |
| `Deleted` | Removed from a `TrackedCollection` | DELETE |

`Edited` is **derived**: when `_committedState === Unchanged` and the object has unsaved property changes (`isDirty === true`), `state` returns `Edited`. It is never stored directly.

**Loading from DB:**

Objects default to `Unchanged`, so no extra setup is needed. Property values set inside the constructor are suppressed by `@InitializeTracked`:

```typescript
@InitializeTracked
class InvoiceModel extends TrackedObject {
  @Tracked() accessor status: string = '';
  constructor(tracker: Tracker, data?: { status: string }) {
    super(tracker); // initialState defaults to Unchanged
    if (data) this.status = data.status; // suppressed — not tracked
  }
}

const invoice = new InvoiceModel(tracker, { status: 'active' }); // state: Unchanged
```

**Saving:**

```typescript
for (const obj of tracker.trackedObjects) {
  if (!(obj instanceof InvoiceModel)) continue;
  switch (obj.state) {
    case ObjectState.New:       /* INSERT */ break;
    case ObjectState.Edited:    /* UPDATE */ break;
    case ObjectState.Deleted:   /* DELETE */ break;
    case ObjectState.Unchanged: break;
  }
}

await saveToServer();

tracker.onCommit(); // all objects → Unchanged; isDirty → false
```

---

### `VersionedTrackedObject`

Use this instead of `TrackedObject` when your database is **versioned (temporal)** — records are never modified in-place; edits close the current row and insert a new version, and deletes are soft.

`VersionedTrackedObject` is also the right choice even for standard CRUD databases if you need the `*Reverted` states — i.e., your app must react when the user undoes a previously committed save.

```typescript
import {
  VersionedTrackedObject,
  VersionedObjectState,
  ExternallyAssigned,
  InitializeTracked,
  Tracked,
} from 'trackui';

@InitializeTracked
class OrderModel extends VersionedTrackedObject {
  @ExternallyAssigned
  id: number = 0;

  @Tracked()
  accessor description: string = '';

  constructor(tracker: Tracker) {
    super(tracker);
  }
}
```

**Additional members** (on top of `TrackedObject`'s API)

| Member | Type | Description |
|---|---|---|
| `state` | `VersionedObjectState` | 7-state version of `ObjectState` (see below) |
| `_committedState` | `VersionedObjectState` | The persisted state |
| `pendingHardDeletes` | `Set<number>` | Real DB ids that must be hard-deleted on the server before the next insert of this object |

---

### `VersionedObjectState`

```typescript
import { VersionedObjectState } from 'trackui';
```

| Value | Meaning | Required DB operation |
|---|---|---|
| `New` | Created by user, never saved | INSERT |
| `Unchanged` | Loaded from DB or just saved — no pending action | — |
| `Edited` | `Unchanged` + unsaved property changes (derived) | Close current row + INSERT new version |
| `Deleted` | Removed from a `TrackedCollection` | SOFT DELETE |
| `InsertReverted` | A saved insert was undone | HARD DELETE the inserted row |
| `EditReverted` | A saved edit was undone | HARD DELETE new version + REOPEN previous version |
| `DeleteReverted` | A saved delete was undone | REOPEN (clear end date / restore) |

`Edited` is **derived**, exactly as in `ObjectState`.

The three `*Reverted` states arise when the user undoes a `tracker.onCommit()` call. Each encodes the fact that a row now exists in the database that the user has logically rolled back, requiring an explicit compensating write on the server.

**Loading from DB:**

Objects default to `Unchanged`. Set properties inside the constructor (suppressed by `@InitializeTracked`):

```typescript
@InitializeTracked
class OrderModel extends VersionedTrackedObject {
  @ExternallyAssigned id: number = 0;
  @Tracked() accessor description: string = '';
  constructor(tracker: Tracker, data?: { id: number; description: string }) {
    super(tracker); // initialState defaults to Unchanged
    if (data) {
      this.id = data.id;
      this.description = data.description;
    }
  }
}

const order = new OrderModel(tracker, { id: 42, description: 'Widget' }); // state: Unchanged
```

**Creating a new item:**

```typescript
const item = new OrderModel(tracker);  // state: Unchanged
collection.push(item);                 // state: New — collection sets it
```

---

### Versioned save lifecycle

This is the complete pattern a client should follow when saving with `VersionedTrackedObject`. Three concerns must be handled: deciding what DB operations each object needs, managing placeholder IDs for new rows, and issuing hard deletes when an insert is undone.

#### Step 1 — read pending operations

Before sending anything to the server, iterate `tracker.trackedObjects` and read `state` and `pendingHardDeletes` on each `VersionedTrackedObject`:

```typescript
import { VersionedTrackedObject, VersionedObjectState } from 'trackui';

interface SavePayload {
  inserts:      { placeholder: number; data: unknown }[];
  updates:      { id: number;          data: unknown }[];
  softDeletes:  { id: number }[];
  hardDeletes:  { id: number }[];
  reopens:      { id: number }[];
}

function buildPayload(tracker: Tracker): SavePayload {
  const payload: SavePayload = {
    inserts: [], updates: [], softDeletes: [],
    hardDeletes: [], reopens: [],
  };

  // Assign placeholder IDs to all objects that need a new DB row
  tracker.beforeCommit();

  for (const obj of tracker.trackedObjects) {
    if (!(obj instanceof VersionedTrackedObject)) continue;

    // Hard deletes that must reach the server before the new insert
    for (const id of obj.pendingHardDeletes) {
      payload.hardDeletes.push({ id });
    }

    switch (obj.state) {
      case VersionedObjectState.New:
        // id is a negative placeholder assigned by beforeCommit()
        payload.inserts.push({ placeholder: obj.id, data: serialize(obj) });
        break;

      case VersionedObjectState.Edited:
        // Close current DB row + insert new version
        payload.softDeletes.push({ id: obj.id });
        payload.inserts.push({ placeholder: obj.id, data: serialize(obj) });
        break;

      case VersionedObjectState.Deleted:
        payload.softDeletes.push({ id: obj.id });
        break;

      case VersionedObjectState.InsertReverted:
        // pendingHardDeletes already added above; optionally re-insert
        payload.inserts.push({ placeholder: obj.id, data: serialize(obj) });
        break;

      case VersionedObjectState.EditReverted:
        // Hard delete new row + reopen the previous row
        // pendingHardDeletes already added above
        payload.reopens.push({ id: obj.previousId }); // your domain logic
        break;

      case VersionedObjectState.DeleteReverted:
        payload.reopens.push({ id: obj.id });
        break;

      case VersionedObjectState.Unchanged:
        break;
    }
  }

  return payload;
}
```

> **Order matters:** hard deletes in `pendingHardDeletes` must be sent to the server **before** (or in the same transaction as) the new insert for the same object, because the previous DB row for that id must not conflict with the incoming insert.

#### Step 2 — send to server and receive real IDs

```typescript
const payload = buildPayload(tracker);
const response = await api.save(payload);
// response.ids: Array<{ placeholder: number; value: number }>
```

#### Step 3 — apply real IDs and mark clean

```typescript
tracker.onCommit(response.ids);
// Every VersionedTrackedObject → state Unchanged
// Placeholder IDs replaced with real DB ids
// tracker.isDirty === false
```

After a successful `onCommit`, clear `pendingHardDeletes` on each object to avoid re-sending them on the next cycle:

```typescript
for (const obj of tracker.trackedObjects) {
  if (obj instanceof VersionedTrackedObject) {
    obj.pendingHardDeletes.clear();
  }
}
```

#### Step 4 — handling rollback

If the server returns an error, do **not** call `tracker.onCommit()`. The tracker remains dirty, `state` values are unchanged, and the user can continue editing or retry.

---

#### Complete versioned save example

```typescript
import {
  Tracker,
  VersionedTrackedObject,
  VersionedObjectState,
  InitializeTracked,
  Tracked,
  ExternallyAssigned,
  TrackedCollection,
} from 'trackui';

const tracker = new Tracker();

@InitializeTracked
class OrderLine extends VersionedTrackedObject {
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
class OrderModel extends VersionedTrackedObject {
  @ExternallyAssigned
  id: number = 0;

  @Tracked((_, v) => !v ? 'Status is required' : undefined)
  accessor status: string = '';

  readonly lines: TrackedCollection<OrderLine>;

  constructor(tracker: Tracker) {
    super(tracker);
    this.lines = new TrackedCollection<OrderLine>(
      tracker,
      [],
      (list) => list.length === 0 ? 'At least one line is required' : undefined,
    );
  }
}

// ---- Create and edit ----

const order = new OrderModel(tracker);
const line1 = new OrderLine(tracker);

order.status = 'draft';
line1.description = 'Widget';
line1.quantity = 3;
order.lines.push(line1);

// ---- Save (insert) ----

tracker.beforeCommit();
// order.id === -1, line1.id === -2

const response1 = await api.save({
  inserts: [
    { placeholder: order.id, data: { status: order.status } },
    { placeholder: line1.id, data: { description: line1.description, quantity: line1.quantity } },
  ],
});
// response1.ids: [{ placeholder: -1, value: 10 }, { placeholder: -2, value: 20 }]

tracker.onCommit(response1.ids);
// order.id === 10, line1.id === 20, state === Unchanged

// ---- User edits and saves again ----

order.status = 'confirmed';

tracker.beforeCommit();
// order.id is already positive — untouched by beforeCommit

const response2 = await api.save({
  // Close row 10, open new version
  softDeletes: [{ id: order.id }],
  inserts: [{ placeholder: order.id, data: { status: order.status } }],
});

tracker.onCommit(response2.ids);

// ---- User undoes the second save ----

tracker.undo();
// order.state === EditReverted
// order.pendingHardDeletes contains the id of the new version that must be hard-deleted

// ---- Re-save from EditReverted ----

tracker.beforeCommit(); // reassigns a fresh placeholder (current id is negative placeholder)

const toHardDelete = [...order.pendingHardDeletes]; // ids to remove from DB

const response3 = await api.save({
  hardDeletes: toHardDelete.map(id => ({ id })),
  reopens: [{ id: 10 }], // reopen the previous version
});

tracker.onCommit(response3.ids);

// Clear pendingHardDeletes now that the server has processed them
for (const obj of tracker.trackedObjects) {
  if (obj instanceof VersionedTrackedObject) {
    obj.pendingHardDeletes.clear();
  }
}
```

---

### `@ExternallyAssigned`

Marks a numeric ID property as assigned by the server. Works with both `TrackedObject` and `VersionedTrackedObject`. Enables the `beforeCommit` / `onCommit` lifecycle for ID management.

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
tracker.onCommit(serverIds);
// invoice.id is now 42
// tracker.isDirty is false
```

`beforeCommit()` only assigns a placeholder if the property's current value is `≤ 0`. Models that already have a positive ID are left untouched.

`onCommit()` with no arguments (or an empty array) still marks the tracker as clean — it just skips the ID replacement step.

The placeholder counter never resets — each cycle continues from where it left off — so placeholder IDs are globally unique across the lifetime of the tracker and can never collide across save cycles.

**Undo restores the placeholder, not zero.** When the user undoes an `onCommit()`, the ID reverts to the negative placeholder that was active at save time (not `0`). This means `beforeCommit()` on the next cycle sees `id < 0` and correctly assigns a fresh unique placeholder.

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

**Options**

An optional second argument controls decorator behaviour:

```typescript
@Tracked(validator?, options?)
```

| Option | Type | Default | Description |
|---|---|---|---|
| `noCoalesce` | `boolean` | `false` | When `true`, rapid consecutive writes always create separate undo steps, even if they fall within the tracker's coalescing window |

```typescript
// Validator + noCoalesce together:
@Tracked((_, v) => v < 0 ? 'Must be positive' : undefined, { noCoalesce: true })
accessor quantity: number = 0;

// noCoalesce only (no validator):
@Tracked(undefined, { noCoalesce: true })
accessor version: number = 0;
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

## License

MIT — Nazario Mazzotti
