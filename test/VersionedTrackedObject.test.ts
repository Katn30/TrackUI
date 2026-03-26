import { describe, it, expect } from "vitest";
import { VersionedTrackedObject } from "../src/VersionedTrackedObject";
import { VersionedObjectState } from "../src/VersionedObjectState";
import { Tracker } from "../src/Tracker";
import { InitializeTracked } from "../src/InitializeTracked";
import { Tracked } from "../src/Tracked";
import { TrackedCollection } from "../src/TrackedCollection";
import { ExternallyAssigned, ExternalAssignment } from "../src/ExternallyAssigned";

// ---- Models ----

@InitializeTracked
class OrderModel extends VersionedTrackedObject {
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

@InitializeTracked
class ProductModel extends VersionedTrackedObject {
  @ExternallyAssigned
  id: number = 0;

  @Tracked()
  accessor name: string = "";

  constructor(tracker: Tracker, initialName = "") {
    super(tracker);
    this.name = initialName;
  }
}

// ---- Helper ----

function makeUnchangedOrder(tracker: Tracker, description = "Widget"): OrderModel {
  let obj!: OrderModel;
  tracker.withTrackingSuppressed(() => {
    obj = new OrderModel(tracker);
    obj._committedState = VersionedObjectState.Unchanged;
    (obj as any).description = description;
  });
  return obj;
}

// ---- dirtyCounter ----

describe("VersionedTrackedObject – dirty state (isDirty / dirtyCounter)", () => {
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

  it("onCommit() resets isDirty on all tracked objects", () => {
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

// ---- Initial states ----

describe("VersionedTrackedObject – initial states", () => {
  it("new object has state New", () => {
    const tracker = new Tracker();
    const order = new OrderModel(tracker);
    expect(order.state).toBe(VersionedObjectState.New);
  });

  it("object with _committedState set to Unchanged has state Unchanged when clean", () => {
    const tracker = new Tracker();
    const order = makeUnchangedOrder(tracker);
    expect(order.state).toBe(VersionedObjectState.Unchanged);
  });

  it("New object with property changes still has state New, not Edited", () => {
    const tracker = new Tracker();
    const order = new OrderModel(tracker);
    order.description = "changed";
    expect(order.state).toBe(VersionedObjectState.New);
  });
});

// ---- Edited derived state ----

describe("VersionedTrackedObject – Edited derived state", () => {
  it("Unchanged object with a property change has state Edited", () => {
    const tracker = new Tracker();
    const order = makeUnchangedOrder(tracker);
    order.description = "changed";
    expect(order.state).toBe(VersionedObjectState.Edited);
  });

  it("Edited state reverts to Unchanged when the property change is undone", () => {
    const tracker = new Tracker();
    const order = makeUnchangedOrder(tracker);
    order.description = "changed";

    tracker.undo();

    expect(order.state).toBe(VersionedObjectState.Unchanged);
  });

  it("Unchanged object with no changes has state Unchanged", () => {
    const tracker = new Tracker();
    const order = makeUnchangedOrder(tracker);
    expect(order.state).toBe(VersionedObjectState.Unchanged);
    expect(order.isDirty).toBe(false);
  });

  it("Edited → Edited: further prop change while Edited keeps state Edited", () => {
    const tracker = new Tracker();
    const order = makeUnchangedOrder(tracker);
    order.description = "first change";
    order.amount = 99;
    expect(order.state).toBe(VersionedObjectState.Edited);
  });
});

// ---- onCommit() on New ----

describe("VersionedTrackedObject – onCommit() on New object (insert)", () => {
  it("sets state to Unchanged", () => {
    const tracker = new Tracker();
    const order = new OrderModel(tracker);
    order.description = "new order";
    tracker.onCommit();
    expect(order.state).toBe(VersionedObjectState.Unchanged);
  });

  it("undo sets state to InsertReverted", () => {
    const tracker = new Tracker();
    const order = new OrderModel(tracker);
    order.description = "new order";
    tracker.onCommit();

    tracker.undo();

    expect(order.state).toBe(VersionedObjectState.InsertReverted);
  });

  it("redo after undo sets state back to Unchanged", () => {
    const tracker = new Tracker();
    const order = new OrderModel(tracker);
    order.description = "new order";
    tracker.onCommit();
    tracker.undo();

    tracker.redo();

    expect(order.state).toBe(VersionedObjectState.Unchanged);
  });

  it("onCommit does not add a spurious extra undo step", () => {
    const tracker = new Tracker();
    const order = new OrderModel(tracker);
    order.description = "new order";
    tracker.onCommit();

    tracker.undo();
    expect(tracker.canUndo).toBe(false);
    expect(order.state).toBe(VersionedObjectState.InsertReverted);
  });
});

// ---- onCommit() on Edited ----

describe("VersionedTrackedObject – onCommit() on Edited object", () => {
  it("sets state to Unchanged", () => {
    const tracker = new Tracker();
    const order = makeUnchangedOrder(tracker);
    order.description = "updated";
    tracker.onCommit();
    expect(order.state).toBe(VersionedObjectState.Unchanged);
  });

  it("undo sets state to EditReverted", () => {
    const tracker = new Tracker();
    const order = makeUnchangedOrder(tracker);
    order.description = "updated";
    tracker.onCommit();

    tracker.undo();

    expect(order.state).toBe(VersionedObjectState.EditReverted);
  });

  it("redo after undo sets state back to Unchanged", () => {
    const tracker = new Tracker();
    const order = makeUnchangedOrder(tracker);
    order.description = "updated";
    tracker.onCommit();
    tracker.undo();

    tracker.redo();

    expect(order.state).toBe(VersionedObjectState.Unchanged);
  });

  it("onCommit does not add a spurious extra undo step", () => {
    const tracker = new Tracker();
    const order = makeUnchangedOrder(tracker);
    order.description = "updated";
    tracker.onCommit();

    tracker.undo();
    expect(tracker.canUndo).toBe(false);
    expect(order.state).toBe(VersionedObjectState.EditReverted);
  });
});

// ---- onCommit() on Deleted ----

describe("VersionedTrackedObject – onCommit() on Deleted object", () => {
  it("sets state to Unchanged", () => {
    const tracker = new Tracker();
    const order = makeUnchangedOrder(tracker);
    const collection = new TrackedCollection<OrderModel>(tracker, [order]);
    collection.remove(order);
    tracker.onCommit();
    expect(order.state).toBe(VersionedObjectState.Unchanged);
  });

  it("undo sets state to DeleteReverted", () => {
    const tracker = new Tracker();
    const order = makeUnchangedOrder(tracker);
    const collection = new TrackedCollection<OrderModel>(tracker, [order]);
    collection.remove(order);
    tracker.onCommit();

    tracker.undo();

    expect(order.state).toBe(VersionedObjectState.DeleteReverted);
  });
});

// ---- onCommit() on *Reverted states ----

describe("VersionedTrackedObject – onCommit() on *Reverted states", () => {
  it("InsertReverted → onCommit() → Unchanged", () => {
    const tracker = new Tracker();
    const order = new OrderModel(tracker);
    order.description = "new order";
    tracker.onCommit();
    tracker.undo();
    expect(order.state).toBe(VersionedObjectState.InsertReverted);

    tracker.onCommit();

    expect(order.state).toBe(VersionedObjectState.Unchanged);
  });

  it("EditReverted → onCommit() → Unchanged", () => {
    const tracker = new Tracker();
    const order = makeUnchangedOrder(tracker);
    order.description = "updated";
    tracker.onCommit();
    tracker.undo();
    expect(order.state).toBe(VersionedObjectState.EditReverted);

    tracker.onCommit();

    expect(order.state).toBe(VersionedObjectState.Unchanged);
  });

  it("DeleteReverted → onCommit() → Unchanged", () => {
    const tracker = new Tracker();
    const order = makeUnchangedOrder(tracker);
    const collection = new TrackedCollection<OrderModel>(tracker, [order]);
    collection.remove(order);
    tracker.onCommit();
    tracker.undo();
    expect(order.state).toBe(VersionedObjectState.DeleteReverted);

    tracker.onCommit();

    expect(order.state).toBe(VersionedObjectState.Unchanged);
  });

  it("DeleteReverted → redo → Unchanged", () => {
    const tracker = new Tracker();
    const order = makeUnchangedOrder(tracker);
    const collection = new TrackedCollection<OrderModel>(tracker, [order]);
    collection.remove(order);
    tracker.onCommit();
    tracker.undo();
    expect(order.state).toBe(VersionedObjectState.DeleteReverted);

    tracker.redo();

    expect(order.state).toBe(VersionedObjectState.Unchanged);
    expect(collection.length).toBe(0);
  });
});

// ---- onCommit() on multiple objects ----

describe("VersionedTrackedObject – onCommit() on multiple objects", () => {
  it("transitions all New objects to Unchanged atomically", () => {
    const tracker = new Tracker(undefined);
    const order1 = new OrderModel(tracker, "a");
    const order2 = new OrderModel(tracker, "b");
    tracker.onCommit();
    expect(order1.state).toBe(VersionedObjectState.Unchanged);
    expect(order2.state).toBe(VersionedObjectState.Unchanged);
  });

  it("undo of onCommit reverts all state changes atomically", () => {
    const tracker = new Tracker(undefined);
    const order1 = makeUnchangedOrder(tracker, "a");
    const order2 = makeUnchangedOrder(tracker, "b");
    order1.description = "a-updated";
    order2.description = "b-updated";
    tracker.onCommit();

    tracker.undo();

    expect(order1.state).toBe(VersionedObjectState.EditReverted);
    expect(order2.state).toBe(VersionedObjectState.EditReverted);
  });
});

// ---- Collection removal ----

describe("VersionedTrackedObject – Deleted on collection removal", () => {
  it("removing an Unchanged object from a collection sets its state to Deleted", () => {
    const tracker = new Tracker();
    const order = makeUnchangedOrder(tracker);
    const collection = new TrackedCollection<OrderModel>(tracker, [order]);

    collection.remove(order);

    expect(order.state).toBe(VersionedObjectState.Deleted);
  });

  it("undo of collection removal restores state to Unchanged", () => {
    const tracker = new Tracker();
    const order = makeUnchangedOrder(tracker);
    const collection = new TrackedCollection<OrderModel>(tracker, [order]);
    collection.remove(order);

    tracker.undo();

    expect(order.state).toBe(VersionedObjectState.Unchanged);
    expect(collection.length).toBe(1);
  });

  it("removing a New object sets its state to Unchanged (never persisted)", () => {
    const tracker = new Tracker();
    const order = new OrderModel(tracker);
    const collection = new TrackedCollection<OrderModel>(tracker, [order]);

    collection.remove(order);

    expect(order.state).toBe(VersionedObjectState.Unchanged);
  });

  it("undo of removing a New object restores state to New", () => {
    const tracker = new Tracker();
    const order = new OrderModel(tracker);
    const collection = new TrackedCollection<OrderModel>(tracker, [order]);
    collection.remove(order);

    tracker.undo();

    expect(order.state).toBe(VersionedObjectState.New);
  });

  it("removing an Edited object sets its state to Deleted", () => {
    const tracker = new Tracker();
    const order = makeUnchangedOrder(tracker);
    const collection = new TrackedCollection<OrderModel>(tracker, [order]);
    order.description = "changed";
    collection.remove(order);
    expect(order.state).toBe(VersionedObjectState.Deleted);
  });

  it("undo of removing an Edited object restores state to Edited", () => {
    const tracker = new Tracker();
    const order = makeUnchangedOrder(tracker);
    const collection = new TrackedCollection<OrderModel>(tracker, [order]);
    order.description = "changed";
    collection.remove(order);

    tracker.undo();

    expect(order.state).toBe(VersionedObjectState.Edited);
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

// ---- Full save/undo/redo cycle ----

describe("VersionedTrackedObject – full save/undo/redo cycle", () => {
  it("maintains correct state through insert → edit → edit → delete → undo×4 (saving) → redo×4 (saving)", () => {
    const tracker = new Tracker(undefined);
    const order = new OrderModel(tracker);
    const collection = new TrackedCollection<OrderModel>(tracker, [order]);

    order.description = "v1";
    expect(order.state).toBe(VersionedObjectState.New);
    tracker.onCommit();
    expect(order.state).toBe(VersionedObjectState.Unchanged);

    order.description = "v2";
    tracker.onCommit();
    expect(order.state).toBe(VersionedObjectState.Unchanged);

    order.description = "v3";
    tracker.onCommit();
    expect(order.state).toBe(VersionedObjectState.Unchanged);

    collection.remove(order);
    tracker.onCommit();
    expect(order.state).toBe(VersionedObjectState.Unchanged);

    tracker.undo();
    expect(order.state).toBe(VersionedObjectState.DeleteReverted);
    tracker.onCommit();
    expect(order.state).toBe(VersionedObjectState.Unchanged);

    tracker.undo();
    expect(order.state).toBe(VersionedObjectState.DeleteReverted);
    expect(order.description).toBe("v2");
    tracker.onCommit();

    tracker.undo();
    expect(order.description).toBe("v1");
    tracker.onCommit();

    tracker.undo();
    expect(order.description).toBe("");
    tracker.onCommit();
    expect(tracker.canUndo).toBe(false);
    expect(tracker.canRedo).toBe(true);

    tracker.redo();
    expect(order.state).toBe(VersionedObjectState.Edited);
    expect(order.description).toBe("v1");
    tracker.onCommit();
    expect(order.state).toBe(VersionedObjectState.Unchanged);

    tracker.redo();
    expect(order.description).toBe("v2");
    tracker.onCommit();

    tracker.redo();
    expect(order.description).toBe("v3");
    tracker.onCommit();

    tracker.redo();
    expect(collection.length).toBe(0);
    tracker.onCommit();
    expect(tracker.canRedo).toBe(false);
  });
});

// ---- @ExternallyAssigned ----

describe("VersionedTrackedObject – @ExternallyAssigned / beforeCommit / onCommit", () => {
  describe("beforeCommit()", () => {
    it("assigns a negative placeholder ID to a new model with no ID", () => {
      const tracker = new Tracker();
      const product = new ProductModel(tracker, "Widget");
      tracker.beforeCommit();
      expect(product.id).toBeLessThan(0);
    });

    it("assigns distinct placeholder IDs to multiple new models", () => {
      const tracker = new Tracker();
      const p1 = new ProductModel(tracker, "A");
      const p2 = new ProductModel(tracker, "B");
      tracker.beforeCommit();
      expect(p1.id).toBeLessThan(0);
      expect(p2.id).toBeLessThan(0);
      expect(p1.id).not.toBe(p2.id);
    });

    it("does not overwrite a model that already has a positive ID", () => {
      const tracker = new Tracker();
      const product = new ProductModel(tracker, "Widget");
      tracker.withTrackingSuppressed(() => { product.id = 42; });
      tracker.beforeCommit();
      expect(product.id).toBe(42);
    });
  });

  describe("onCommit(keys)", () => {
    it("replaces placeholder IDs with real IDs from the server", () => {
      const tracker = new Tracker();
      const product = new ProductModel(tracker, "Widget");
      tracker.beforeCommit();
      const placeholder = product.id;

      tracker.onCommit([{ placeholder, value: 101 }]);

      expect(product.id).toBe(101);
    });

    it("replaces placeholder IDs for multiple models independently", () => {
      const tracker = new Tracker();
      const p1 = new ProductModel(tracker, "A");
      const p2 = new ProductModel(tracker, "B");
      tracker.beforeCommit();
      const ph1 = p1.id;
      const ph2 = p2.id;

      tracker.onCommit([
        { placeholder: ph1, value: 10 },
        { placeholder: ph2, value: 20 },
      ]);

      expect(p1.id).toBe(10);
      expect(p2.id).toBe(20);
    });

    it("onCommit() without keys does not change IDs", () => {
      const tracker = new Tracker();
      const product = new ProductModel(tracker, "Widget");
      tracker.withTrackingSuppressed(() => { product.id = 42; });
      tracker.onCommit();
      expect(product.id).toBe(42);
    });

    it("onCommit() marks tracker as not dirty", () => {
      const tracker = new Tracker();
      const product = new ProductModel(tracker);
      product.name = "Widget";
      tracker.beforeCommit();
      tracker.onCommit([]);
      expect(tracker.isDirty).toBe(false);
    });

    it("leaves ID unchanged when placeholder is not found in keys array", () => {
      const tracker = new Tracker();
      const product = new ProductModel(tracker, "Widget");
      tracker.beforeCommit();
      const placeholder = product.id;

      tracker.onCommit([{ placeholder: -999, value: 101 }]);

      expect(product.id).toBe(placeholder);
    });

    it("undo of onCommit restores id to the placeholder, not 0", () => {
      const tracker = new Tracker(undefined);
      const product = new ProductModel(tracker, "Widget");
      tracker.beforeCommit();
      const placeholder = product.id;
      product.name = "Widget v2";
      tracker.onCommit([{ placeholder, value: 42 }]);
      expect(product.id).toBe(42);

      tracker.undo();

      expect(product.id).toBe(placeholder);
      expect(product.id).toBeLessThan(0);
    });

    it("beforeCommit reassigns a fresh placeholder after undo (id is negative placeholder)", () => {
      const tracker = new Tracker(undefined);
      const product = new ProductModel(tracker, "Widget");
      tracker.beforeCommit();
      const ph1 = product.id;
      product.name = "Widget v2";
      tracker.onCommit([{ placeholder: ph1, value: 42 }]);
      tracker.undo();

      tracker.beforeCommit();

      expect(product.id).toBeLessThan(0);
      expect(product.id).not.toBe(ph1);
    });

    it("placeholder IDs are unique across save cycles", () => {
      const tracker = new Tracker();
      const p1 = new ProductModel(tracker);
      tracker.beforeCommit();
      const ph1 = p1.id;
      tracker.onCommit([{ placeholder: ph1, value: 1 }]);

      const p2 = new ProductModel(tracker);
      tracker.beforeCommit();

      expect(p2.id).toBeLessThan(0);
      expect(p2.id).not.toBe(ph1);
    });
  });
});
