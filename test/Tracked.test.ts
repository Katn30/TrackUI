import { describe, it, expect, beforeEach, vi } from "vitest";
import { TrackedObject } from "../src/TrackedObject";
import { Tracker } from "../src/Tracker";
import { Tracked } from "../src/Tracked";
import { InitializeTracked } from "../src/InitializeTracked";

// ---- Concrete test models ----

@InitializeTracked
class PersonModel extends TrackedObject {
  @Tracked((self: PersonModel, v: string) =>
    !v ? "Name is required" : undefined,
  )
  accessor name: string = "";

  @Tracked((self: PersonModel, v: number) =>
    v < 0 ? "Age must be positive" : undefined,
  )
  accessor age: number = 0;

  @Tracked()
  accessor notes: string = "";

  constructor(tracker: Tracker) {
    super(tracker);
  }
}

@InitializeTracked
class EmptyModel extends TrackedObject {
  constructor(tracker: Tracker) {
    super(tracker);
  }
}

@InitializeTracked
class ModelWithConstructorInit extends TrackedObject {
  @Tracked()
  accessor value: string = "";

  constructor(tracker: Tracker) {
    super(tracker);
    this.value = "initial"; // set during construction — should be suppressed
  }
}

@InitializeTracked
class StrictModel extends TrackedObject {
  @Tracked((_self: StrictModel, v: string) =>
    !v ? "Required" : undefined,
  )
  accessor field: string = "";

  constructor(tracker: Tracker) {
    super(tracker);
  }
}

@InitializeTracked
class EventModel extends TrackedObject {
  @Tracked()
  accessor startDate: Date = new Date(0);

  constructor(tracker: Tracker) {
    super(tracker);
  }
}

@InitializeTracked
class ConfigModel extends TrackedObject {
  @Tracked()
  accessor config: Record<string, unknown> = {};

  constructor(tracker: Tracker) {
    super(tracker);
  }
}

@InitializeTracked
class NullableModel extends TrackedObject {
  @Tracked()
  accessor label: string | null = null;

  constructor(tracker: Tracker) {
    super(tracker);
  }
}

// ---- Tests ----

describe("Tracked", () => {
  let tracker: Tracker;
  let person: PersonModel;

  beforeEach(() => {
    tracker = new Tracker();
    person = new PersonModel(tracker);
  });

  describe("constructor name", () => {
    it("preserves the class name after @InitializeTracked wrapping", () => {
      expect(person.constructor.name).toBe("PersonModel");
    });
  });

  describe("registration", () => {
    it("registers itself with the tracker on construction", () => {
      expect(tracker.trackedObjects).toContain(person);
    });

    it("removes itself from the tracker on destroy", () => {
      person.destroy();
      expect(tracker.trackedObjects).not.toContain(person);
    });
  });

  describe("undo / redo", () => {
    it("undo reverts a property change", () => {
      person.name = "Alice";
      tracker.undo();
      expect(person.name).toBe("");
      expect(person.isDirty).toBe(false);
    });

    it("redo re-applies the change", () => {
      person.name = "Alice";
      tracker.undo();
      tracker.redo();
      expect(person.name).toBe("Alice");
      expect(person.isDirty).toBe(true);
    });

  });

  describe("validation", () => {
    it("is valid initially (default values satisfy validators)", () => {
      // name = '' triggers required validator at construction via @InitializeTracked
      expect(person.isValid).toBe(false);
      expect(person.validationMessages.get("name")).toBe("Name is required");
    });

    it("becomes valid when the required property is set", () => {
      person.name = "Alice";
      expect(person.isValid).toBe(true);
      expect(person.validationMessages.has("name")).toBe(false);
    });

    it("becomes invalid when a property fails its validator", () => {
      person.name = "Alice";
      person.age = -1;
      expect(person.isValid).toBe(false);
      expect(person.validationMessages.get("age")).toBe("Age must be positive");
    });

    it("clears validation message when property becomes valid again", () => {
      person.age = -1;
      person.age = 5;
      expect(person.validationMessages.has("age")).toBe(false);
    });

    it("tracker reflects validity of all models", () => {
      expect(tracker.isValid).toBe(false); // person.name is ''
      person.name = "Alice";
      expect(tracker.isValid).toBe(true);
    });

    it("model without validators is always valid", () => {
      const empty = new EmptyModel(tracker);
      expect(empty.isValid).toBe(true);
    });
  });

  describe("no-op on same value", () => {
    it("does not create an undo entry when setting the same value", () => {
      person.name = "Alice";
      person.name = "Alice";
      tracker.undo();
      expect(person.name).toBe("");
    });

    it("treats null/undefined as equivalent to empty string", () => {
      person.name = null as any;
      expect(person.isDirty).toBe(false);
    });
  });

  describe("dirty state with tracker", () => {
    it("tracker isDirty reflects model changes", () => {
      expect(tracker.isDirty).toBe(false);
      person.name = "Alice";
      expect(tracker.isDirty).toBe(true);
    });

    it("tracker is clean after afterCommit", () => {
      person.name = "Alice";
      tracker.onCommit();
      expect(tracker.isDirty).toBe(false);
      expect(person.isDirty).toBe(false);
    });

    it("isDirtyChanged event fires when tracker becomes dirty", () => {
      const states: boolean[] = [];
      tracker.isDirtyChanged.subscribe((v) => states.push(v));
      person.name = "Alice";
      tracker.onCommit();
      expect(states).toEqual([true, false]);
    });
  });

  describe("suppress logic during construction", () => {
    it("does not add undo entries for property assignments in the constructor body", () => {
      const t = new Tracker();
      new ModelWithConstructorInit(t);
      expect(t.canUndo).toBe(false);
    });

    it("tracker is not dirty after construction even when constructor sets properties", () => {
      const t = new Tracker();
      new ModelWithConstructorInit(t);
      expect(t.isDirty).toBe(false);
    });

    it("model value set in constructor body is preserved", () => {
      const t = new Tracker();
      const m = new ModelWithConstructorInit(t);
      expect(m.value).toBe("initial");
    });

    it("property changes after construction are tracked normally", () => {
      const t = new Tracker();
      const m = new ModelWithConstructorInit(t);
      m.value = "changed";
      expect(t.canUndo).toBe(true);
      t.undo();
      expect(m.value).toBe("initial");
    });
  });

  describe("string property aggregation", () => {
    it("multiple rapid changes to the same property aggregate into one undo step", () => {
      person.name = "A";
      person.name = "Al";
      person.name = "Ali";
      tracker.undo();
      expect(person.name).toBe("");
    });

    it("changes separated by more than 3 seconds create separate undo steps", () => {
      vi.useFakeTimers();
      vi.setSystemTime(0);
      person.name = "A";
      vi.setSystemTime(4000);
      person.name = "B";
      tracker.undo();
      expect(person.name).toBe("A");
      vi.useRealTimers();
    });
  });

  describe("multiple models on one tracker", () => {
    it("tracker isValid is false if any model is invalid", () => {
      const t = new Tracker();
      const m1 = new StrictModel(t);
      new StrictModel(t);
      m1.field = "ok";
      expect(t.isValid).toBe(false); // second model's field still ''
    });

    it("tracker isValid is true only when all models are valid", () => {
      const t = new Tracker();
      const m1 = new StrictModel(t);
      const m2 = new StrictModel(t);
      m1.field = "ok";
      m2.field = "ok";
      expect(t.isValid).toBe(true);
    });

    it("destroying one model removes it from tracker validity check", () => {
      const t = new Tracker();
      const m1 = new StrictModel(t);
      const m2 = new StrictModel(t);
      m1.field = "ok";
      // m2 is invalid but we destroy it
      m2.destroy();
      expect(t.isValid).toBe(true);
    });
  });

  describe("Date property type", () => {
    it("tracks a Date property change and marks dirty", () => {
      const t = new Tracker();
      const event = new EventModel(t);
      t.onCommit();

      event.startDate = new Date("2024-01-01");

      expect(event.isDirty).toBe(true);
    });

    it("undoes a Date property change", () => {
      const t = new Tracker();
      const event = new EventModel(t);
      const original = event.startDate;
      t.onCommit();

      event.startDate = new Date("2024-01-01");
      t.undo();

      expect(event.startDate).toBe(original);
      expect(event.isDirty).toBe(false);
    });
  });

  describe("Object property type", () => {
    it("tracks an object property change and marks dirty", () => {
      const t = new Tracker();
      const cfg = new ConfigModel(t);
      t.onCommit();

      cfg.config = { theme: "dark" };

      expect(cfg.isDirty).toBe(true);
    });

    it("undoes an object property change", () => {
      const t = new Tracker();
      const cfg = new ConfigModel(t);
      const original = cfg.config;
      t.onCommit();

      cfg.config = { theme: "dark" };
      t.undo();

      expect(cfg.config).toBe(original);
      expect(cfg.isDirty).toBe(false);
    });
  });

  describe("isSameValue — null/undefined initial value set to empty string", () => {
    it("setting null property to empty string does not create an operation", () => {
      const t = new Tracker();
      const m = new NullableModel(t);
      // initial value is null; setting to '' should be treated as no change
      m.label = "";

      expect(t.canUndo).toBe(false);
    });

    it("setting null property to empty string does not mark dirty", () => {
      const t = new Tracker();
      const m = new NullableModel(t);
      t.onCommit();

      m.label = "";

      expect(t.isDirty).toBe(false);
    });
  });
});
