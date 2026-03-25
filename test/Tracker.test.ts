import { describe, it, expect } from "vitest";
import { TrackedObject } from "../src/TrackedObject";
import { Tracker } from "../src/Tracker";
import { InitializeTracked } from "../src/InitializeTracked";
import { Tracked } from "../src/Tracked";
import { TrackedCollection } from "../src/TrackedCollection";
import {
  ExternallyAssigned,
  ExternalAssignment,
} from "../src/ExternallyAssigned";

// ---- Models ----

@InitializeTracked
class InvoiceModel extends TrackedObject {
  @Tracked()
  accessor status: string = "";

  @Tracked()
  accessor note: string = "";

  readonly lines: TrackedCollection<string>;

  constructor(
    tracker: Tracker,
    initialStatus = "",
    initialLines: string[] = [],
    initialNote = "",
  ) {
    super(tracker);
    this.status = initialStatus;
    this.note = initialNote;
    this.lines = new TrackedCollection<string>(tracker, initialLines);
  }
}

// ---- Tests ----

describe("Tracker – sequential changes create separate undo steps", () => {
  it("two sequential property changes create two undo steps", () => {
    const tracker = new Tracker();
    const invoice = new InvoiceModel(tracker);

    invoice.status = "active";
    invoice.note = "hello";

    tracker.undo(); // reverts note only
    expect(invoice.note).toBe("");
    expect(invoice.status).toBe("active");

    tracker.undo(); // reverts status
    expect(invoice.status).toBe("");
  });

  it("a property change and a collection mutation create two undo steps", () => {
    const tracker = new Tracker();
    const invoice = new InvoiceModel(tracker, "active", ["line-1"]);
    tracker.onCommit();

    invoice.status = "void";
    invoice.lines.clear();

    tracker.undo(); // reverts clear only
    expect(invoice.lines.length).toBe(1);
    expect(invoice.status).toBe("void");

    tracker.undo(); // reverts status
    expect(invoice.status).toBe("active");
    expect(tracker.isDirty).toBe(false);
  });

  it("two sequential collection mutations create two undo steps", () => {
    const tracker = new Tracker();
    const invoice = new InvoiceModel(tracker, "", ["a", "b"]);
    tracker.onCommit();

    invoice.lines.push("c");
    invoice.lines.push("d");

    tracker.undo();
    expect(invoice.lines.length).toBe(3);

    tracker.undo();
    expect(invoice.lines.length).toBe(2);
    expect(tracker.isDirty).toBe(false);
  });
});

describe("Tracker – tracking suppression", () => {
  it("changes inside trackingSuppressed do not create undo entries", () => {
    const tracker = new Tracker();
    const invoice = new InvoiceModel(tracker);

    tracker.withTrackingSuppressed(() => {
      invoice.status = "draft";
      invoice.lines.push("line-1");
    });

    expect(tracker.canUndo).toBe(false);
  });

  it("changes inside trackingSuppressed do not mark the tracker dirty", () => {
    const tracker = new Tracker();
    const invoice = new InvoiceModel(tracker);

    tracker.withTrackingSuppressed(() => {
      invoice.status = "draft";
    });

    expect(tracker.isDirty).toBe(false);
  });

  it("values are still applied inside trackingSuppressed", () => {
    const tracker = new Tracker();
    const invoice = new InvoiceModel(tracker);

    tracker.withTrackingSuppressed(() => {
      invoice.status = "draft";
      invoice.lines.push("line-1", "line-2");
    });

    expect(invoice.status).toBe("draft");
    expect(invoice.lines.length).toBe(2);
  });

  it("changes after trackingSuppressed are tracked normally", () => {
    const tracker = new Tracker();
    const invoice = new InvoiceModel(tracker);

    tracker.withTrackingSuppressed(() => {
      invoice.status = "draft";
    });
    invoice.status = "active";

    expect(tracker.canUndo).toBe(true);
    tracker.undo();
    expect(invoice.status).toBe("draft");
  });

  it("beginSuppressTracking / endSuppressTracking behave identically", () => {
    const tracker = new Tracker();
    const invoice = new InvoiceModel(tracker);

    tracker.beginSuppressTracking();
    invoice.status = "draft";
    invoice.lines.push("line-1");
    tracker.endSuppressTracking();

    expect(tracker.canUndo).toBe(false);
    expect(invoice.status).toBe("draft");
    expect(invoice.lines.length).toBe(1);
  });
});

// ---- get/set decorator model ----

@InitializeTracked
class PersonModel extends TrackedObject {
  private _name: string = "";

  get name(): string {
    return this._name;
  }

  @Tracked()
  set name(value: string) {
    this._name = value;
  }

  constructor(tracker: Tracker, initialName = "") {
    super(tracker);
    this.name = initialName;
  }
}

describe("Tracker – @TrackedProperty on get/set", () => {
  it("change is tracked and undoable", () => {
    const tracker = new Tracker();
    const person = new PersonModel(tracker, "Alice");
    tracker.onCommit();

    person.name = "Bob";

    tracker.undo();
    expect(person.name).toBe("Alice");
    expect(tracker.isDirty).toBe(false);
  });

  it("undo then redo restores the change", () => {
    const tracker = new Tracker();
    const person = new PersonModel(tracker);

    person.name = "Bob";
    tracker.undo();
    tracker.redo();

    expect(person.name).toBe("Bob");
  });

  it("setting the same value does not create an undo step", () => {
    const tracker = new Tracker();
    const person = new PersonModel(tracker, "Alice");
    tracker.onCommit();

    person.name = "Alice";

    expect(tracker.canUndo).toBe(false);
    expect(tracker.isDirty).toBe(false);
  });

  it("changes inside trackingSuppressed are not tracked", () => {
    const tracker = new Tracker();
    const person = new PersonModel(tracker);

    tracker.withTrackingSuppressed(() => {
      person.name = "Bob";
    });

    expect(person.name).toBe("Bob");
    expect(tracker.canUndo).toBe(false);
  });
});

// ---- ExternallyAssigned model ----

@InitializeTracked
class ProductModel extends TrackedObject {
  @ExternallyAssigned
  id: number = 0;

  @Tracked()
  accessor name: string = "";

  constructor(tracker: Tracker, initialName = "") {
    super(tracker);
    this.name = initialName;
  }
}

describe("Tracker – @ExternallyAssigned / beforeCommit / afterCommit", () => {
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
      tracker.withTrackingSuppressed(() => {
        product.id = 42;
      });

      tracker.beforeCommit();

      expect(product.id).toBe(42);
    });
  });

  describe("afterCommit(keys)", () => {
    it("replaces placeholder IDs with real IDs from the server", () => {
      const tracker = new Tracker();
      const product = new ProductModel(tracker, "Widget");

      tracker.beforeCommit();
      const placeholder = product.id;

      const keys: ExternalAssignment[] = [{ placeholder, value: 101 }];
      tracker.onCommit(keys);

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

    it("afterCommit() without keys does not change IDs", () => {
      const tracker = new Tracker();
      const product = new ProductModel(tracker, "Widget");
      tracker.withTrackingSuppressed(() => {
        product.id = 42;
      });

      tracker.onCommit();

      expect(product.id).toBe(42);
    });

    it("afterCommit() marks tracker as not dirty", () => {
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

// ---- Validated model ----

@InitializeTracked
class ValidatedModel extends TrackedObject {
  @Tracked((_, v: string) => (!v ? "Required" : undefined))
  accessor status: string = "initial";

  @Tracked()
  accessor note: string = "";

  constructor(tracker: Tracker) {
    super(tracker);
  }
}

// ---- Event tests ----

describe("Tracker – isDirtyChanged", () => {
  it("fires with true when the tracker becomes dirty", () => {
    const tracker = new Tracker();
    const invoice = new InvoiceModel(tracker);
    const calls: boolean[] = [];
    tracker.isDirtyChanged.subscribe((v) => calls.push(v));

    invoice.status = "draft";

    expect(calls).toEqual([true]);
  });

  it("fires with false when the tracker becomes clean", () => {
    const tracker = new Tracker();
    const invoice = new InvoiceModel(tracker);
    invoice.status = "draft";
    const calls: boolean[] = [];
    tracker.isDirtyChanged.subscribe((v) => calls.push(v));

    tracker.undo();

    expect(calls).toEqual([false]);
  });

  it("does not fire when isDirty is already true", () => {
    const tracker = new Tracker();
    const invoice = new InvoiceModel(tracker);
    invoice.status = "draft"; // isDirty → true
    const calls: boolean[] = [];
    tracker.isDirtyChanged.subscribe((v) => calls.push(v));

    invoice.status = "active"; // isDirty stays true

    expect(calls).toEqual([]);
  });

  it("does not fire when isDirty is already false", () => {
    const tracker = new Tracker();
    new InvoiceModel(tracker);
    const calls: boolean[] = [];
    tracker.isDirtyChanged.subscribe((v) => calls.push(v));

    tracker.undo(); // nothing to undo, isDirty stays false

    expect(calls).toEqual([]);
  });
});

describe("Tracker – isValidChanged", () => {
  it("fires with false when the tracker becomes invalid", () => {
    const tracker = new Tracker();
    const model = new ValidatedModel(tracker);
    tracker.onCommit();
    const calls: boolean[] = [];
    tracker.isValidChanged.subscribe((v) => calls.push(v));

    model.status = ""; // validator fails → isValid → false

    expect(calls).toEqual([false]);
  });

  it("fires with true when the tracker becomes valid again", () => {
    const tracker = new Tracker();
    const model = new ValidatedModel(tracker);
    model.status = "";
    const calls: boolean[] = [];
    tracker.isValidChanged.subscribe((v) => calls.push(v));

    model.status = "active"; // validator passes → isValid → true

    expect(calls).toEqual([true]);
  });

  it("does not fire when isValid is already false", () => {
    const tracker = new Tracker();
    const model = new ValidatedModel(tracker);
    model.status = ""; // isValid → false
    const calls: boolean[] = [];
    tracker.isValidChanged.subscribe((v) => calls.push(v));

    model.note = "x"; // tracked change triggers revalidation — isValid stays false

    expect(calls).toEqual([]);
  });

  it("does not fire when isValid is already true", () => {
    const tracker = new Tracker();
    const model = new ValidatedModel(tracker); // isValid is true
    const calls: boolean[] = [];
    tracker.isValidChanged.subscribe((v) => calls.push(v));

    model.note = "x"; // tracked change triggers revalidation — isValid stays true

    expect(calls).toEqual([]);
  });
});

describe("Tracker – canCommitChanged", () => {
  it("fires with true when isDirty becomes true and isValid is already true", () => {
    const tracker = new Tracker();
    const invoice = new InvoiceModel(tracker);
    const calls: boolean[] = [];
    tracker.canCommitChanged.subscribe((v) => calls.push(v));

    invoice.status = "draft"; // isDirty → true, isValid already true → canCommit → true

    expect(calls).toEqual([true]);
  });

  it("fires with false when isDirty becomes false", () => {
    const tracker = new Tracker();
    const invoice = new InvoiceModel(tracker);
    invoice.status = "draft";
    const calls: boolean[] = [];
    tracker.canCommitChanged.subscribe((v) => calls.push(v));

    tracker.undo(); // isDirty → false → canCommit → false

    expect(calls).toEqual([false]);
  });

  it("fires with false when isValid becomes false while isDirty is true", () => {
    const tracker = new Tracker();
    const model = new ValidatedModel(tracker);
    model.status = "active"; // isDirty=true, isValid=true → canCommit=true
    const calls: boolean[] = [];
    tracker.canCommitChanged.subscribe((v) => calls.push(v));

    model.status = ""; // isValid → false → canCommit → false

    expect(calls).toEqual([false]);
  });

  it("does not fire when isDirty becomes true but isValid is false", () => {
    const tracker = new Tracker();
    const model = new ValidatedModel(tracker);
    tracker.withTrackingSuppressed(() => { model.status = ""; });
    tracker.revalidate(); // suppressed writes bypass doAndTrack so revalidation must be triggered manually
    const calls: boolean[] = [];
    tracker.canCommitChanged.subscribe((v) => calls.push(v));

    model.note = "x"; // isDirty → true, isValid stays false → canCommit stays false

    expect(calls).toEqual([]);
  });

  it("does not fire when a second change is made while already dirty and valid", () => {
    const tracker = new Tracker();
    const invoice = new InvoiceModel(tracker);
    invoice.status = "draft"; // canCommit → true
    const calls: boolean[] = [];
    tracker.canCommitChanged.subscribe((v) => calls.push(v));

    invoice.status = "active"; // isDirty stays true, isValid stays true → canCommit stays true

    expect(calls).toEqual([]);
  });
});
