import { Tracker } from "./Tracker";
import { TrackedObjectBase } from "./TrackedObjectBase";
import { ObjectState } from "./ObjectState";
import { Operation } from "./Operation";
import { OperationProperties } from "./OperationProperties";
import { PropertyType } from "./PropertyType";

export abstract class TrackedObject extends TrackedObjectBase {
  public _committedState: ObjectState = ObjectState.Unchanged;

  public get state(): ObjectState {
    if (this._committedState === ObjectState.Unchanged && this.isDirty) {
      return ObjectState.Edited;
    }
    return this._committedState;
  }

  public constructor(tracker: Tracker, initialState: ObjectState = ObjectState.Unchanged) {
    super(tracker);
    this._committedState = initialState;
  }

  public onCommitted(_lastOp?: Operation): void {
    this.dirtyCounter = 0;
  }

  public markDeletion(): void {
    const prev = this._committedState;
    const target = prev === ObjectState.New ? ObjectState.Unchanged : ObjectState.Deleted;
    this.tracker.doAndTrack(
      () => { this._committedState = target; },
      () => { this._committedState = prev; },
      new OperationProperties(this, '__saveState__', PropertyType.Object),
    );
  }

  public markAsNew(): void {
    if (this._committedState !== ObjectState.Unchanged) return;
    if (this.tracker.isTrackingSuppressed) return;
    const prev = this._committedState;
    this.tracker.doAndTrack(
      () => { this._committedState = ObjectState.New; },
      () => { this._committedState = prev; },
      new OperationProperties(this, '__saveState__', PropertyType.Object),
    );
  }
}
