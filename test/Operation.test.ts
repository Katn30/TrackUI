import { describe, it, expect, vi } from "vitest";
import { Operation } from "../src/Operation";
import { OperationProperties } from "../src/OperationProperties";
import { PropertyType } from "../src/PropertyType";

const stubModel = {} as any;

function props(): OperationProperties {
  return new OperationProperties(stubModel, "prop", PropertyType.String);
}

describe("Operation", () => {
  describe("initial state", () => {
    it("hasActions is false", () => {
      expect(new Operation().hasActions).toBe(false);
    });

    it("actions array is empty", () => {
      expect(new Operation().actions).toHaveLength(0);
    });

    it("records the creation time", () => {
      const before = Date.now();
      const op = new Operation();
      expect(op.time.getTime()).toBeGreaterThanOrEqual(before);
    });
  });

  describe("add()", () => {
    it("stores the action", () => {
      const op = new Operation();
      op.add(vi.fn(), vi.fn(), props());
      expect(op.actions).toHaveLength(1);
    });

    it("sets hasActions to true", () => {
      const op = new Operation();
      op.add(vi.fn(), vi.fn(), props());
      expect(op.hasActions).toBe(true);
    });

    it("assigns sequential action numbers starting from 0", () => {
      const op = new Operation();
      op.add(vi.fn(), vi.fn(), props());
      op.add(vi.fn(), vi.fn(), props());
      op.add(vi.fn(), vi.fn(), props());
      expect(op.actions.map((a) => a.number)).toEqual([0, 1, 2]);
    });

    it("stores the supplied properties on the action", () => {
      const op = new Operation();
      const p = props();
      op.add(vi.fn(), vi.fn(), p);
      expect(op.actions[0].properties).toBe(p);
    });

    it("records a timestamp on each action", () => {
      const before = Date.now();
      const op = new Operation();
      op.add(vi.fn(), vi.fn(), props());
      expect(op.actions[0].time.getTime()).toBeGreaterThanOrEqual(before);
    });
  });

  describe("undo()", () => {
    it("calls every undoAction", () => {
      const op = new Operation();
      const u1 = vi.fn();
      const u2 = vi.fn();
      op.add(vi.fn(), u1, props());
      op.add(vi.fn(), u2, props());
      op.undo();
      expect(u1).toHaveBeenCalledOnce();
      expect(u2).toHaveBeenCalledOnce();
    });

    it("calls undoActions in reverse order of addition", () => {
      const op = new Operation();
      const order: number[] = [];
      op.add(vi.fn(), () => order.push(1), props());
      op.add(vi.fn(), () => order.push(2), props());
      op.add(vi.fn(), () => order.push(3), props());
      op.undo();
      expect(order).toEqual([3, 2, 1]);
    });

    it("does not call redoActions", () => {
      const op = new Operation();
      const r = vi.fn();
      op.add(r, vi.fn(), props());
      op.undo();
      expect(r).not.toHaveBeenCalled();
    });
  });

  describe("redo()  —  always called after undo()", () => {
    it("calls every redoAction", () => {
      const op = new Operation();
      const r1 = vi.fn();
      const r2 = vi.fn();
      op.add(r1, vi.fn(), props());
      op.add(r2, vi.fn(), props());
      op.undo();
      op.redo();
      expect(r1).toHaveBeenCalledOnce();
      expect(r2).toHaveBeenCalledOnce();
    });

    it("calls redoActions in the original order of addition", () => {
      const op = new Operation();
      const order: number[] = [];
      op.add(() => order.push(1), vi.fn(), props());
      op.add(() => order.push(2), vi.fn(), props());
      op.add(() => order.push(3), vi.fn(), props());
      op.undo();
      order.length = 0;
      op.redo();
      expect(order).toEqual([1, 2, 3]);
    });

    it("does not call undoActions", () => {
      const op = new Operation();
      const u = vi.fn();
      op.add(vi.fn(), u, props());
      op.undo();
      u.mockReset();
      op.redo();
      expect(u).not.toHaveBeenCalled();
    });
  });

  describe("undo → redo cycle", () => {
    it("correct actions are called across multiple alternations", () => {
      const op = new Operation();
      const order: string[] = [];
      op.add(
        () => order.push("redo-A"),
        () => order.push("undo-A"),
        props(),
      );
      op.add(
        () => order.push("redo-B"),
        () => order.push("undo-B"),
        props(),
      );

      op.undo();
      expect(order).toEqual(["undo-B", "undo-A"]);
      order.length = 0;

      op.redo();
      expect(order).toEqual(["redo-A", "redo-B"]);
      order.length = 0;

      op.undo();
      expect(order).toEqual(["undo-B", "undo-A"]);
    });
  });
});
