import { Tracker } from "./Tracker";
import { TrackedObjectBase } from "./TrackedObjectBase";
import { VersionedObjectState } from "./VersionedObjectState";
import { Operation } from "./Operation";
import { OperationProperties } from "./OperationProperties";
import { PropertyType } from "./PropertyType";
import { ExternalAssignment, getExternallyAssignedProperty } from "./ExternallyAssigned";

export abstract class VersionedTrackedObject extends TrackedObjectBase {
  public _committedState: VersionedObjectState = VersionedObjectState.New;
  public readonly pendingHardDeletes = new Set<number>();

  public get state(): VersionedObjectState {
    if (this._committedState === VersionedObjectState.Unchanged && this.isDirty) {
      return VersionedObjectState.Edited;
    }
    return this._committedState;
  }

  public constructor(tracker: Tracker) {
    super(tracker);
  }

  public onCommitted(lastOp?: Operation): void {
    const revertedState = this.revertedStateFor(this.state);
    if (revertedState !== null) {
      const reverted = revertedState;
      const redoFn = () => { this._committedState = VersionedObjectState.Unchanged; };
      const undoFn = () => { this._committedState = reverted; };
      if (lastOp) {
        lastOp.updateOrAdd(redoFn, undoFn, new OperationProperties(this, '__saveState__', PropertyType.Object));
      }
      redoFn();
    }
    this.dirtyCounter = 0;
  }

  public override applyExternalAssignments(keys: ExternalAssignment[], lastOp?: Operation): void {
    const propertyName = getExternallyAssignedProperty(Object.getPrototypeOf(this));
    const response = propertyName && (this as any)[propertyName] < 0
      ? keys.find((x) => x.placeholder === (this as any)[propertyName])
      : undefined;

    super.applyExternalAssignments(keys, lastOp);

    if (!response) return;
    const newValue = response.value;
    const redoFn = () => { this.pendingHardDeletes.delete(newValue); };
    const undoFn = () => { this.pendingHardDeletes.add(newValue); };
    if (lastOp) {
      lastOp.add(redoFn, undoFn, new OperationProperties(this, '__pendingHardDeletes__', PropertyType.Object));
    }
    redoFn();
  }

  public markDeletion(): void {
    const prev = this._committedState;
    const isNeverPersisted = prev === VersionedObjectState.New || prev === VersionedObjectState.InsertReverted;
    const target = isNeverPersisted ? VersionedObjectState.Unchanged : VersionedObjectState.Deleted;

    const propertyName = getExternallyAssignedProperty(Object.getPrototypeOf(this));
    const prevId = propertyName !== undefined ? (this as any)[propertyName] as number : undefined;
    const prevPendingHardDeletes = new Set(this.pendingHardDeletes);
    const prevDirtyCounter = this.dirtyCounter;

    this.tracker.doAndTrack(
      () => {
        this._committedState = target;
        if (isNeverPersisted) {
          this.dirtyCounter = 0;
        }
        if (propertyName !== undefined && prevId !== 0) {
          (this as any)[propertyName] = 0;
        }
      },
      () => {
        this._committedState = prev;
        if (isNeverPersisted) {
          this.dirtyCounter = prevDirtyCounter;
        }
        if (propertyName !== undefined) {
          (this as any)[propertyName] = prevId!;
        }
        this.pendingHardDeletes.clear();
        prevPendingHardDeletes.forEach(id => this.pendingHardDeletes.add(id));
      },
      new OperationProperties(this, '__saveState__', PropertyType.Object),
    );
  }

  private revertedStateFor(state: VersionedObjectState): VersionedObjectState | null {
    switch (state) {
      case VersionedObjectState.New:            return VersionedObjectState.InsertReverted;
      case VersionedObjectState.Edited:         return VersionedObjectState.EditReverted;
      case VersionedObjectState.Deleted:        return VersionedObjectState.DeleteReverted;
      case VersionedObjectState.InsertReverted: return VersionedObjectState.InsertReverted;
      case VersionedObjectState.EditReverted:   return VersionedObjectState.EditReverted;
      case VersionedObjectState.DeleteReverted: return VersionedObjectState.DeleteReverted;
      default:                                  return null;
    }
  }
}
