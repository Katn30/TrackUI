import { describe, it, expect } from "vitest";
import { TrackedObject } from "../src/TrackedObject";
import { Tracker } from "../src/Tracker";
import { InitializeTracked } from "../src/InitializeTracked";
import { Tracked } from "../src/Tracked";
import { TrackedCollection } from "../src/TrackedCollection";

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

@InitializeTracked
class RequiredNameModel extends TrackedObject {
  @Tracked((_, v: string) => (!v ? "Name is required" : undefined))
  accessor name: string = ""; // empty default → always invalid on construction

  constructor(tracker: Tracker) {
    super(tracker);
  }
}

// ---- Sequential changes ----

describe("TrackedObject – sequential changes create separate undo steps", () => {
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

// ---- Tracking suppression ----

describe("TrackedObject – tracking suppression", () => {
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

// ---- @Tracked on get/set accessor ----

describe("TrackedObject – @Tracked on get/set accessor", () => {
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

// ---- Events ----

describe("TrackedObject – isDirtyChanged", () => {
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
    invoice.status = "draft";
    const calls: boolean[] = [];
    tracker.isDirtyChanged.subscribe((v) => calls.push(v));

    invoice.status = "active";

    expect(calls).toEqual([]);
  });

  it("does not fire when isDirty is already false", () => {
    const tracker = new Tracker();
    new InvoiceModel(tracker);
    const calls: boolean[] = [];
    tracker.isDirtyChanged.subscribe((v) => calls.push(v));

    tracker.undo();

    expect(calls).toEqual([]);
  });
});

describe("TrackedObject – isValidChanged", () => {
  it("fires with false when the tracker becomes invalid", () => {
    const tracker = new Tracker();
    const model = new ValidatedModel(tracker);
    tracker.onCommit();
    const calls: boolean[] = [];
    tracker.isValidChanged.subscribe((v) => calls.push(v));

    model.status = "";

    expect(calls).toEqual([false]);
  });

  it("fires with true when the tracker becomes valid again", () => {
    const tracker = new Tracker();
    const model = new ValidatedModel(tracker);
    model.status = "";
    const calls: boolean[] = [];
    tracker.isValidChanged.subscribe((v) => calls.push(v));

    model.status = "active";

    expect(calls).toEqual([true]);
  });

  it("does not fire when isValid is already false", () => {
    const tracker = new Tracker();
    const model = new ValidatedModel(tracker);
    model.status = "";
    const calls: boolean[] = [];
    tracker.isValidChanged.subscribe((v) => calls.push(v));

    model.note = "x";

    expect(calls).toEqual([]);
  });

  it("does not fire when isValid is already true", () => {
    const tracker = new Tracker();
    const model = new ValidatedModel(tracker);
    const calls: boolean[] = [];
    tracker.isValidChanged.subscribe((v) => calls.push(v));

    model.note = "x";

    expect(calls).toEqual([]);
  });
});

describe("TrackedObject – canCommitChanged", () => {
  it("fires with true when isDirty becomes true and isValid is already true", () => {
    const tracker = new Tracker();
    const invoice = new InvoiceModel(tracker);
    const calls: boolean[] = [];
    tracker.canCommitChanged.subscribe((v) => calls.push(v));

    invoice.status = "draft";

    expect(calls).toEqual([true]);
  });

  it("fires with false when isDirty becomes false", () => {
    const tracker = new Tracker();
    const invoice = new InvoiceModel(tracker);
    invoice.status = "draft";
    const calls: boolean[] = [];
    tracker.canCommitChanged.subscribe((v) => calls.push(v));

    tracker.undo();

    expect(calls).toEqual([false]);
  });

  it("fires with false when isValid becomes false while isDirty is true", () => {
    const tracker = new Tracker();
    const model = new ValidatedModel(tracker);
    model.status = "active";
    const calls: boolean[] = [];
    tracker.canCommitChanged.subscribe((v) => calls.push(v));

    model.status = "";

    expect(calls).toEqual([false]);
  });

  it("does not fire when isDirty becomes true but isValid is false", () => {
    const tracker = new Tracker();
    const model = new ValidatedModel(tracker);
    tracker.withTrackingSuppressed(() => { model.status = ""; });
    tracker.revalidate();
    const calls: boolean[] = [];
    tracker.canCommitChanged.subscribe((v) => calls.push(v));

    model.note = "x";

    expect(calls).toEqual([]);
  });

  it("does not fire when a second change is made while already dirty and valid", () => {
    const tracker = new Tracker();
    const invoice = new InvoiceModel(tracker);
    invoice.status = "draft";
    const calls: boolean[] = [];
    tracker.canCommitChanged.subscribe((v) => calls.push(v));

    invoice.status = "active";

    expect(calls).toEqual([]);
  });
});

// ---- Bulk construction ----

describe("TrackedObject – bulk construction with withTrackingSuppressed", () => {
  it("isValid is stale (not updated) while construction is suppressed", () => {
    const tracker = new Tracker();
    expect(tracker.isValid).toBe(true);

    tracker.withTrackingSuppressed(() => {
      new RequiredNameModel(tracker); // invalid: name = ""
    });

    // revalidate() was skipped — isValid has not been updated yet
    expect(tracker.isValid).toBe(true);
  });

  it("isValid is correct after manual revalidate() following suppressed bulk construction", () => {
    const tracker = new Tracker();

    tracker.withTrackingSuppressed(() => {
      new RequiredNameModel(tracker);
      new RequiredNameModel(tracker);
      new RequiredNameModel(tracker);
    });

    tracker.revalidate();

    expect(tracker.isValid).toBe(false);
  });

  it("single construction without outer suppression updates isValid immediately", () => {
    const tracker = new Tracker();

    new RequiredNameModel(tracker); // revalidate() runs inside @InitializeTracked

    expect(tracker.isValid).toBe(false);
  });

  it("bulk construction then revalidate produces the same validity as sequential construction", () => {
    const tracker1 = new Tracker();
    tracker1.withTrackingSuppressed(() => {
      new RequiredNameModel(tracker1);
      new RequiredNameModel(tracker1);
    });
    tracker1.revalidate();

    const tracker2 = new Tracker();
    new RequiredNameModel(tracker2);
    new RequiredNameModel(tracker2);

    expect(tracker1.isValid).toBe(tracker2.isValid);
    expect(tracker1.trackedObjects.length).toBe(tracker2.trackedObjects.length);
  });
});
