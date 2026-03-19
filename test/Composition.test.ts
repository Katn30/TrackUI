import { describe, it, expect } from "vitest";
import { TrackedObject } from "../src/TrackedObject";
import { Tracker } from "../src/Tracker";
import { InitializeTracked } from "../src/InitializeTracked";
import { Tracked } from "../src/Tracked";
import { TrackedCollection } from "../src/TrackedCollection";

// ---- Models ----

@InitializeTracked
class OrderModel extends TrackedObject {
  @Tracked()
  accessor itemCount: number = 0;

  readonly items: TrackedCollection<string>;

  constructor(tracker: Tracker) {
    super(tracker);
    this.items = new TrackedCollection<string>(tracker);
    this.items.changed.subscribe(() => {
      this.itemCount = this.items.length;
    });
  }
}

// ---- Tests ----

describe("Tracker – TrackedCollection + TrackedProperty composition via changed event", () => {
  it("collection mutation and listener property change compose into one undo step", () => {
    const tracker = new Tracker();
    const order = new OrderModel(tracker);

    order.items.push("item-1");

    expect(order.items.length).toBe(1);
    expect(order.itemCount).toBe(1);

    tracker.undo();

    expect(order.items.length).toBe(0);
    expect(order.itemCount).toBe(0);
    expect(tracker.canUndo).toBe(false);
  });

  it("redo restores both collection and property", () => {
    const tracker = new Tracker();
    const order = new OrderModel(tracker);

    order.items.push("item-1");
    tracker.undo();
    tracker.redo();

    expect(order.items.length).toBe(1);
    expect(order.itemCount).toBe(1);
  });

  it("multiple pushes each compose with their listener update separately", () => {
    const tracker = new Tracker();
    const order = new OrderModel(tracker);

    order.items.push("item-1");
    order.items.push("item-2");

    tracker.undo(); // reverts push("item-2") and its listener update
    expect(order.items.length).toBe(1);
    expect(order.itemCount).toBe(1);

    tracker.undo(); // reverts push("item-1") and its listener update
    expect(order.items.length).toBe(0);
    expect(order.itemCount).toBe(0);

    expect(tracker.canUndo).toBe(false);
  });
});
