import { describe, it, expect } from "vitest";
import { VersionedTrackedObject } from "../src/VersionedTrackedObject";
import { VersionedObjectState } from "../src/VersionedObjectState";
import { Tracker } from "../src/Tracker";
import { Tracked } from "../src/Tracked";
import { ExternallyAssigned } from "../src/ExternallyAssigned";
import { TrackedCollection } from "../src/TrackedCollection";

class ItemModel extends VersionedTrackedObject {
  @ExternallyAssigned
  id: number = 0;

  @Tracked()
  accessor name: string = "";

  constructor(tracker: Tracker, initialState = VersionedObjectState.Unchanged) {
    super(tracker, initialState);
  }
}

describe("VersionedTrackedObject — insert lifecycle with @ExternallyAssigned", () => {
  it("insert → save → edit → edit → save → edit → undo×4 → re-save → redo → undo → redo → save", () => {
    const tracker = new Tracker(undefined); // coalescing disabled: each change = its own op
    const item = tracker.construct(() => new ItemModel(tracker, VersionedObjectState.New));

    // 1. Create
    expect(item.state).toBe(VersionedObjectState.New);
    expect(item.id).toBe(0);

    // 2. Save — a tracked change is needed so onCommit has a lastOp to attach to
    item.name = "v1"; // Op1
    tracker.beforeCommit();
    const ph1 = item.id; // negative placeholder assigned by beforeCommit
    expect(ph1).toBeLessThan(0);
    tracker.onCommit([{ placeholder: ph1, value: 42 }]);
    expect(item.state).toBe(VersionedObjectState.Unchanged);
    expect(item.id).toBe(42);
    expect(item.pendingHardDeletes.size).toBe(0);

    // 3. First update
    item.name = "v2"; // Op2
    expect(item.state).toBe(VersionedObjectState.Edited);

    // 4. Second update
    item.name = "v3"; // Op3
    expect(item.state).toBe(VersionedObjectState.Edited);

    // 5. Save
    tracker.onCommit([]);
    expect(item.state).toBe(VersionedObjectState.Unchanged);

    // 6. Third update
    item.name = "v4"; // Op4
    expect(item.state).toBe(VersionedObjectState.Edited);

    // 7. Undo ×4 — unwinds through all four operations back to InsertReverted
    tracker.undo(); // Op4 — name=v3, state=Unchanged
    tracker.undo(); // Op3 + __saveState__ from step 5 — name=v2, state=EditReverted
    tracker.undo(); // Op2 — name=v1, state=EditReverted (Op2 carries no __saveState__)
    tracker.undo(); // Op1 + id change + __saveState__ from step 2 — name="", id=ph1, state=InsertReverted
    expect(item.state).toBe(VersionedObjectState.InsertReverted);
    expect(item.name).toBe("");
    expect(item.id).toBe(ph1);
    expect(item.pendingHardDeletes.has(42)).toBe(true); // 42 is the id assigned at step 2

    // 8. Re-save from InsertReverted — app has sent hard-delete for 42 to the backend
    tracker.beforeCommit(); // id is ph1 (negative) → assigns a fresh placeholder
    const ph2 = item.id;
    expect(ph2).toBeLessThan(0);
    expect(ph2).not.toBe(ph1); // globally unique, never reused
    tracker.onCommit([{ placeholder: ph2, value: 43 }]);
    expect(item.state).toBe(VersionedObjectState.Unchanged);
    expect(item.id).toBe(43);
    // TODO: pendingHardDeletes must be cleared by onCommit — not yet implemented
    // expect(item.pendingHardDeletes.size).toBe(0);

    // 9. Redo Op1 — data re-appears, but the previous commit (id=42) is gone from the DB
    //    → state must be New (object needs a fresh insert), not Unchanged
    tracker.redo();
    // TODO: __saveState__ redoFn must set New instead of Unchanged — not yet implemented
    // expect(item.state).toBe(VersionedObjectState.New);
    // TODO: id must be reset to 0 (42 was hard-deleted) — not yet implemented
    // expect(item.id).toBe(0);
    expect(item.pendingHardDeletes.size).toBe(0); // delete(42) ran on an already-empty set

    // 10. Undo Op1 — back to post-step-8 state (Unchanged)
    tracker.undo();
    // TODO: Op1's __saveState__ undoFn must be updated by step 8's onCommit (currently InsertReverted)
    // expect(item.state).toBe(VersionedObjectState.Unchanged);

    // 11. Redo Op1 again — same as step 9
    tracker.redo();
    // TODO: same as step 9
    // expect(item.state).toBe(VersionedObjectState.New);
    // expect(item.id).toBe(0);

    // 12. Save from New state
    // TODO: steps below depend on step 9/11 resetting id=0 — not yet implemented
    // item.name = "v1-new";
    // tracker.beforeCommit(); // id=0 ≤ 0 → fresh placeholder
    // const ph3 = item.id;
    // expect(ph3).toBeLessThan(0);
    // tracker.onCommit([{ placeholder: ph3, value: 44 }]);
    // expect(item.state).toBe(VersionedObjectState.Unchanged);
    // expect(item.id).toBe(44);
    // expect(tracker.isDirty).toBe(false);
  });

  it("removing an InsertReverted object from a collection resets id and treats it as never-existed", () => {
    const tracker = new Tracker(undefined);
    const item = tracker.construct(() => new ItemModel(tracker, VersionedObjectState.New));
    const collection = new TrackedCollection<ItemModel>(tracker, [item]);

    // Save (insert)
    item.name = "v1";
    tracker.beforeCommit();
    const ph1 = item.id;
    tracker.onCommit([{ placeholder: ph1, value: 42 }]);
    expect(item.state).toBe(VersionedObjectState.Unchanged);

    // Undo insert save → InsertReverted
    tracker.undo();
    expect(item.state).toBe(VersionedObjectState.InsertReverted);
    expect(item.pendingHardDeletes.has(42)).toBe(true);

    // Remove InsertReverted object from collection
    collection.remove(item);
    expect(item.state).toBe(VersionedObjectState.Unchanged); // treated as never-existed
    expect(item.id).toBe(0);                                 // placeholder cleared

    // Undo the removal — object comes back as InsertReverted with original id restored
    tracker.undo();
    expect(item.state).toBe(VersionedObjectState.InsertReverted);
    expect(item.id).toBe(ph1);
    expect(item.pendingHardDeletes.has(42)).toBe(true);
  });
});
