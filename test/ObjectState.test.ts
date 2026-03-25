import { describe, it, expect } from "vitest";
import { TrackedObject } from "../src/TrackedObject";
import { Tracker } from "../src/Tracker";
import { InitializeTracked } from "../src/InitializeTracked";
import { Tracked } from "../src/Tracked";
import { TrackedCollection } from "../src/TrackedCollection";
import { ObjectState } from "../src/ObjectState";

// ---- Model ----

@InitializeTracked
class OrderModel extends TrackedObject {
  @Tracked()
  accessor description: string = "";

  @Tracked()
  accessor amount: number = 0;

  constructor(tracker: Tracker, description = "", amount = 0) {
    super(tracker);
    this.description = description;
    this.amount = amount;
  }
}

// ---- Helper ----

function makeUnchangedOrder(tracker: Tracker, description = "Widget"): OrderModel {
  let obj!: OrderModel;
  tracker.withTrackingSuppressed(() => {
    obj = new OrderModel(tracker);
    obj._committedState = ObjectState.Unchanged;
    (obj as any).description = description;
  });
  return obj;
}

// ---- Tests ----

describe("TrackedObject — dirty state (isDirty / dirtyCounter)", () => {
  it("is not dirty initially", () => {
    const tracker = new Tracker();
    const order = new OrderModel(tracker);
    expect(order.isDirty).toBe(false);
    expect(order.dirtyCounter).toBe(0);
  });

  it("becomes dirty after a property change", () => {
    const tracker = new Tracker();
    const order = new OrderModel(tracker);
    order.description = "Alice";
    expect(order.isDirty).toBe(true);
    expect(order.dirtyCounter).toBe(1);
  });

  it("increments dirtyCounter for each property change", () => {
    const tracker = new Tracker();
    const order = new OrderModel(tracker);
    order.description = "Alice";
    order.amount = 30;
    expect(order.dirtyCounter).toBe(2);
  });

  it("undo decrements dirtyCounter", () => {
    const tracker = new Tracker();
    const order = new OrderModel(tracker);
    order.description = "Alice";
    order.amount = 30;
    tracker.undo();
    expect(order.dirtyCounter).toBe(1);
  });

  it("resets dirtyCounter to 0 after onCommitted()", () => {
    const tracker = new Tracker();
    const order = new OrderModel(tracker);
    order.description = "Alice";
    order.onCommitted();
    expect(order.isDirty).toBe(false);
    expect(order.dirtyCounter).toBe(0);
  });

  it("does not mark dirty when setting the same value", () => {
    const tracker = new Tracker();
    const order = new OrderModel(tracker);
    order.description = "";
    expect(order.isDirty).toBe(false);
  });

  it("afterCommit() resets isDirty on all tracked objects", () => {
    const tracker = new Tracker();
    const order1 = new OrderModel(tracker, "a");
    const order2 = new OrderModel(tracker, "b");
    order1.description = "a-updated";
    order2.description = "b-updated";
    tracker.onCommit();
    expect(order1.isDirty).toBe(false);
    expect(order2.isDirty).toBe(false);
  });
});

describe("ObjectState — initial states", () => {
  it("new object has state New", () => {
    const tracker = new Tracker();
    const order = new OrderModel(tracker);
    expect(order.state).toBe(ObjectState.New);
  });

  it("object with _committedState set to Unchanged has state Unchanged when clean", () => {
    const tracker = new Tracker();
    const order = makeUnchangedOrder(tracker);
    expect(order.state).toBe(ObjectState.Unchanged);
  });

  it("New object with property changes still has state New, not Edited", () => {
    const tracker = new Tracker();
    const order = new OrderModel(tracker);
    order.description = "changed";
    expect(order.state).toBe(ObjectState.New);
  });
});

describe("ObjectState — Edited derived state", () => {
  it("Unchanged object with a property change has state Edited", () => {
    const tracker = new Tracker();
    const order = makeUnchangedOrder(tracker);
    order.description = "changed";
    expect(order.state).toBe(ObjectState.Edited);
  });

  it("Edited state reverts to Unchanged when the property change is undone", () => {
    const tracker = new Tracker();
    const order = makeUnchangedOrder(tracker);
    order.description = "changed";

    tracker.undo();

    expect(order.state).toBe(ObjectState.Unchanged);
  });

  it("Unchanged object with no changes has state Unchanged", () => {
    const tracker = new Tracker();
    const order = makeUnchangedOrder(tracker);
    expect(order.state).toBe(ObjectState.Unchanged);
    expect(order.isDirty).toBe(false);
  });
});

describe("ObjectState — afterCommit() on New object (insert)", () => {
  it("sets state to Unchanged", () => {
    const tracker = new Tracker();
    const order = new OrderModel(tracker);
    order.description = "new order";

    tracker.onCommit();

    expect(order.state).toBe(ObjectState.Unchanged);
  });

  it("undo sets state to InsertReverted", () => {
    const tracker = new Tracker();
    const order = new OrderModel(tracker);
    order.description = "new order";
    tracker.onCommit();

    tracker.undo();

    expect(order.state).toBe(ObjectState.InsertReverted);
  });

  it("redo after undo sets state back to Unchanged", () => {
    const tracker = new Tracker();
    const order = new OrderModel(tracker);
    order.description = "new order";
    tracker.onCommit();
    tracker.undo();

    tracker.redo();

    expect(order.state).toBe(ObjectState.Unchanged);
  });

  it("afterCommit does not add a spurious extra undo step", () => {
    const tracker = new Tracker();
    const order = new OrderModel(tracker);
    order.description = "new order";
    // one undo step exists: the description change
    expect(tracker.canUndo).toBe(true);

    tracker.onCommit();

    // still only one undo step — state transition was appended, not a new operation
    tracker.undo();
    expect(tracker.canUndo).toBe(false);
    expect(order.state).toBe(ObjectState.InsertReverted);
  });
});

describe("ObjectState — afterCommit() on Edited object", () => {
  it("sets state to Unchanged", () => {
    const tracker = new Tracker();
    const order = makeUnchangedOrder(tracker);
    order.description = "updated";

    tracker.onCommit();

    expect(order.state).toBe(ObjectState.Unchanged);
  });

  it("undo sets state to EditReverted", () => {
    const tracker = new Tracker();
    const order = makeUnchangedOrder(tracker);
    order.description = "updated";
    tracker.onCommit();

    tracker.undo();

    expect(order.state).toBe(ObjectState.EditReverted);
  });

  it("redo after undo sets state back to Unchanged", () => {
    const tracker = new Tracker();
    const order = makeUnchangedOrder(tracker);
    order.description = "updated";
    tracker.onCommit();
    tracker.undo();

    tracker.redo();

    expect(order.state).toBe(ObjectState.Unchanged);
  });

  it("afterCommit does not add a spurious extra undo step", () => {
    const tracker = new Tracker();
    const order = makeUnchangedOrder(tracker);
    order.description = "updated";

    tracker.onCommit();

    tracker.undo();
    expect(tracker.canUndo).toBe(false);
    expect(order.state).toBe(ObjectState.EditReverted);
  });
});

describe("ObjectState — afterCommit() on Deleted object", () => {
  it("sets state to Unchanged", () => {
    const tracker = new Tracker();
    const order = makeUnchangedOrder(tracker);
    const collection = new TrackedCollection<OrderModel>(tracker, [order]);
    collection.remove(order);

    tracker.onCommit();

    expect(order.state).toBe(ObjectState.Unchanged);
  });

  it("undo sets state to DeleteReverted", () => {
    const tracker = new Tracker();
    const order = makeUnchangedOrder(tracker);
    const collection = new TrackedCollection<OrderModel>(tracker, [order]);
    collection.remove(order);
    tracker.onCommit();

    tracker.undo();

    expect(order.state).toBe(ObjectState.DeleteReverted);
  });
});

describe("ObjectState — afterCommit() on multiple objects", () => {
  it("transitions all New objects to Unchanged atomically", () => {
    const tracker = new Tracker(undefined);
    const order1 = new OrderModel(tracker, "a");
    const order2 = new OrderModel(tracker, "b");

    tracker.onCommit();

    expect(order1.state).toBe(ObjectState.Unchanged);
    expect(order2.state).toBe(ObjectState.Unchanged);
  });

  it("undo of afterCommit reverts all state changes atomically", () => {
    const tracker = new Tracker(undefined);
    const order1 = makeUnchangedOrder(tracker, "a");
    const order2 = makeUnchangedOrder(tracker, "b");
    order1.description = "a-updated";
    order2.description = "b-updated";

    tracker.onCommit();
    tracker.undo();

    expect(order1.state).toBe(ObjectState.EditReverted);
    expect(order2.state).toBe(ObjectState.EditReverted);
  });
});

describe("ObjectState — Deleted on collection removal", () => {
  it("removing a TrackedObject from a collection sets its state to Deleted", () => {
    const tracker = new Tracker();
    const order = makeUnchangedOrder(tracker);
    const collection = new TrackedCollection<OrderModel>(tracker, [order]);

    collection.remove(order);

    expect(order.state).toBe(ObjectState.Deleted);
  });

  it("undo of collection removal restores state to previous value", () => {
    const tracker = new Tracker();
    const order = makeUnchangedOrder(tracker);
    const collection = new TrackedCollection<OrderModel>(tracker, [order]);
    collection.remove(order);

    tracker.undo();

    expect(order.state).toBe(ObjectState.Unchanged);
    expect(collection.length).toBe(1);
  });

  it("removing a New TrackedObject sets its state to Unchanged (never persisted)", () => {
    const tracker = new Tracker();
    const order = new OrderModel(tracker);
    const collection = new TrackedCollection<OrderModel>(tracker, [order]);

    collection.remove(order);

    expect(order.state).toBe(ObjectState.Unchanged);
  });

  it("undo of removing a New TrackedObject restores state to New", () => {
    const tracker = new Tracker();
    const order = new OrderModel(tracker);
    const collection = new TrackedCollection<OrderModel>(tracker, [order]);
    collection.remove(order);

    tracker.undo();

    expect(order.state).toBe(ObjectState.New);
  });

  it("non-TrackedObject items in a collection are unaffected", () => {
    const tracker = new Tracker();
    const collection = new TrackedCollection<string>(tracker, ["a", "b"]);

    collection.remove("a");

    expect(collection.length).toBe(1);
  });

  it("removed object remains in tracker.trackedObjects", () => {
    const tracker = new Tracker();
    const order = makeUnchangedOrder(tracker);
    const collection = new TrackedCollection<OrderModel>(tracker, [order]);

    collection.remove(order);

    expect(tracker.trackedObjects).toContain(order);
  });
});

describe("ObjectState — full save/undo/redo cycle", () => {
  it("maintains correct state through insert → edit → edit → delete → undo×4 (saving) → redo×4 (saving)", () => {
    const tracker = new Tracker(undefined); // coalescing disabled
    const order = new OrderModel(tracker);
    const collection = new TrackedCollection<OrderModel>(tracker, [order]);

    // --- Phase 1: insert, edit, edit, delete — each followed by afterCommit ---

    order.description = "v1";
    expect(order.state).toBe(ObjectState.New);
    tracker.onCommit();
    expect(order.state).toBe(ObjectState.Unchanged);
    expect(tracker.isDirty).toBe(false);

    order.description = "v2";
    expect(order.state).toBe(ObjectState.Edited);
    tracker.onCommit();
    expect(order.state).toBe(ObjectState.Unchanged);

    order.description = "v3";
    expect(order.state).toBe(ObjectState.Edited);
    tracker.onCommit();
    expect(order.state).toBe(ObjectState.Unchanged);

    collection.remove(order);
    expect(order.state).toBe(ObjectState.Deleted);
    expect(collection.length).toBe(0);
    tracker.onCommit();
    expect(order.state).toBe(ObjectState.Unchanged);

    // --- Phase 2: undo × 4, saving after each ---
    //
    // Each undo reveals a *Reverted state. afterCommit() then appends the state
    // transition to the PREVIOUS operation via updateOrAdd, replacing its
    // earlier undo target. So every undo after the first carries DeleteReverted
    // (the cascade from the delete being the deepest change).

    tracker.undo(); // undo delete-save (Op4)
    expect(order.state).toBe(ObjectState.DeleteReverted);
    expect(collection.length).toBe(1); // restored to collection
    tracker.onCommit(); // appends DeleteReverted→Unchanged to Op3
    expect(order.state).toBe(ObjectState.Unchanged);

    tracker.undo(); // undo Op3 — its __saveState__ was replaced with DeleteReverted
    expect(order.state).toBe(ObjectState.DeleteReverted);
    expect(order.description).toBe("v2");
    tracker.onCommit(); // appends to Op2
    expect(order.state).toBe(ObjectState.Unchanged);

    tracker.undo(); // undo Op2
    expect(order.state).toBe(ObjectState.DeleteReverted);
    expect(order.description).toBe("v1");
    tracker.onCommit(); // appends to Op1
    expect(order.state).toBe(ObjectState.Unchanged);

    tracker.undo(); // undo Op1 (insert)
    expect(order.state).toBe(ObjectState.DeleteReverted);
    expect(order.description).toBe("");
    tracker.onCommit(); // lastOp is undefined — state applied with no undo support
    expect(order.state).toBe(ObjectState.Unchanged);
    expect(tracker.isDirty).toBe(false);
    expect(tracker.canUndo).toBe(false);
    expect(tracker.canRedo).toBe(true);

    // --- Phase 3: redo × 4, saving after each ---
    //
    // Each redo of a property change re-runs the closure that increments
    // dirtyCounter, so after redo the object is Edited (Unchanged + isDirty).
    // afterCommit() transitions it back to Unchanged and resets dirtyCounter.
    // Op4 (the delete) carries no dirtyCounter mutation for the order itself,
    // so after its redo the order is immediately Unchanged.

    tracker.redo(); // redo Op1
    expect(order.state).toBe(ObjectState.Edited); // dirtyCounter++ from description redo
    expect(order.description).toBe("v1");
    tracker.onCommit(); // Edited → Unchanged, resets dirtyCounter
    expect(order.state).toBe(ObjectState.Unchanged);
    expect(tracker.isDirty).toBe(false);

    tracker.redo(); // redo Op2
    expect(order.state).toBe(ObjectState.Edited);
    expect(order.description).toBe("v2");
    tracker.onCommit();
    expect(order.state).toBe(ObjectState.Unchanged);

    tracker.redo(); // redo Op3
    expect(order.state).toBe(ObjectState.Edited);
    expect(order.description).toBe("v3");
    tracker.onCommit();
    expect(order.state).toBe(ObjectState.Unchanged);

    tracker.redo(); // redo Op4 — splice removes order; no dirtyCounter change for order
    expect(order.state).toBe(ObjectState.Unchanged);
    expect(collection.length).toBe(0);
    tracker.onCommit(); // state=Unchanged → no new Change appended
    expect(order.state).toBe(ObjectState.Unchanged);
    expect(tracker.isDirty).toBe(false);
    expect(tracker.canRedo).toBe(false);
  });
});

describe("ObjectState — uncovered edges", () => {
  it("Edited → Edited: further prop change while Edited keeps state Edited", () => {
    const tracker = new Tracker();
    const order = makeUnchangedOrder(tracker);
    order.description = "first change";
    expect(order.state).toBe(ObjectState.Edited);

    order.amount = 99;

    expect(order.state).toBe(ObjectState.Edited);
  });

  it("Edited → Deleted: removing an Edited object sets state to Deleted", () => {
    const tracker = new Tracker();
    const order = makeUnchangedOrder(tracker);
    const collection = new TrackedCollection<OrderModel>(tracker, [order]);
    order.description = "changed";
    expect(order.state).toBe(ObjectState.Edited);

    collection.remove(order);

    expect(order.state).toBe(ObjectState.Deleted);
  });

  it("Deleted → Edited: undo of remove on a previously Edited object restores state to Edited", () => {
    const tracker = new Tracker();
    const order = makeUnchangedOrder(tracker);
    const collection = new TrackedCollection<OrderModel>(tracker, [order]);
    order.description = "changed";
    collection.remove(order);
    expect(order.state).toBe(ObjectState.Deleted);

    tracker.undo(); // undo remove
    expect(order.state).toBe(ObjectState.Edited);
    expect(collection.length).toBe(1);
  });

  it("InsertReverted → Unchanged: afterCommit() on InsertReverted sets state to Unchanged", () => {
    const tracker = new Tracker();
    const order = new OrderModel(tracker);
    order.description = "new order";
    tracker.onCommit();    // New → Unchanged
    tracker.undo();           // Unchanged → InsertReverted
    expect(order.state).toBe(ObjectState.InsertReverted);

    tracker.onCommit();

    expect(order.state).toBe(ObjectState.Unchanged);
  });

  it("EditReverted → Unchanged: afterCommit() on EditReverted sets state to Unchanged", () => {
    const tracker = new Tracker();
    const order = makeUnchangedOrder(tracker);
    order.description = "updated";
    tracker.onCommit();    // Edited → Unchanged
    tracker.undo();           // Unchanged → EditReverted
    expect(order.state).toBe(ObjectState.EditReverted);

    tracker.onCommit();

    expect(order.state).toBe(ObjectState.Unchanged);
  });

  it("DeleteReverted → Unchanged: afterCommit() on DeleteReverted sets state to Unchanged", () => {
    const tracker = new Tracker();
    const order = makeUnchangedOrder(tracker);
    const collection = new TrackedCollection<OrderModel>(tracker, [order]);
    collection.remove(order);
    tracker.onCommit();    // Deleted → Unchanged
    tracker.undo();           // Unchanged → DeleteReverted
    expect(order.state).toBe(ObjectState.DeleteReverted);

    tracker.onCommit();

    expect(order.state).toBe(ObjectState.Unchanged);
  });

  it("DeleteReverted → Unchanged: redo after undo of delete-save sets state to Unchanged", () => {
    const tracker = new Tracker();
    const order = makeUnchangedOrder(tracker);
    const collection = new TrackedCollection<OrderModel>(tracker, [order]);
    collection.remove(order);
    tracker.onCommit();    // Deleted → Unchanged
    tracker.undo();           // Unchanged → DeleteReverted
    expect(order.state).toBe(ObjectState.DeleteReverted);

    tracker.redo();

    expect(order.state).toBe(ObjectState.Unchanged);
    expect(collection.length).toBe(0);
  });
});
