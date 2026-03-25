import { Tracker } from "./Tracker";
import { validate } from "./Registry";
import { ITracked } from "./ITracked";
import { ObjectState } from "./ObjectState";
import { Operation } from "./Operation";
import { OperationProperties } from "./OperationProperties";
import { PropertyType } from "./PropertyType";
import {
  ExternalAssignment,
  getExternallyAssignedProperty,
} from "./ExternallyAssigned";

export abstract class TrackedObject implements ITracked {
  private _dirtyCounter: number;
  private _validationMessages: Map<string, string | undefined> | undefined;
  private _isValid: boolean;

  public _committedState: ObjectState = ObjectState.New;

  public get validationMessages(): Map<string, string | undefined> {
    return this._validationMessages ?? new Map<string, string>();
  }
  private set validationMessages(value: Map<string, string | undefined>) {
    this._validationMessages = value;
  }

  public get isValid(): boolean {
    return this._isValid;
  }
  private set isValid(value: boolean) {
    this._isValid = value;
  }

  public get isDirty(): boolean {
    return this._dirtyCounter !== 0;
  }

  public get dirtyCounter(): number {
    return this._dirtyCounter;
  }
  private set dirtyCounter(value: number) {
    this._dirtyCounter = value;
  }

  public get state(): ObjectState {
    if (this._committedState === ObjectState.Unchanged && this.isDirty) {
      return ObjectState.Edited;
    }
    return this._committedState;
  }

  public constructor(public readonly tracker: Tracker) {
    this.validationMessages = new Map<string, string>();
    this._isValid = true;
    this._dirtyCounter = 0;
    tracker.trackObject(this);
  }

  public onCommitted(lastOp?: Operation): void {
    const revertedState = this.revertedStateFor(this.state);
    if (revertedState !== null) {
      const reverted = revertedState;
      const redoFn = () => { this._committedState = ObjectState.Unchanged; };
      const undoFn = () => { this._committedState = reverted; };
      if (lastOp) {
        lastOp.updateOrAdd(redoFn, undoFn, new OperationProperties(this, '__saveState__', PropertyType.Object));
      }
      redoFn();
    }
    this.dirtyCounter = 0;
  }

  public applyExternalKey(keys: ExternalAssignment[], lastOp?: Operation): void {
    const propertyName = getExternallyAssignedProperty(Object.getPrototypeOf(this));
    if (propertyName && (this as any)[propertyName] < 0) {
      const response = keys.find((x) => x.placeholder === (this as any)[propertyName]);
      if (response) {
        const newValue = response.value;
        const redoFn = () => { (this as any)[propertyName] = newValue; };
        const undoFn = () => { (this as any)[propertyName] = 0; };
        if (lastOp) {
          lastOp.add(redoFn, undoFn, new OperationProperties(this, propertyName, PropertyType.Number));
        }
        redoFn();
      }
    }
  }

  /**
   * Returns the DB operation required for non-versioned (standard CRUD) databases.
   * Collapses `*Reverted` states to their CRUD equivalents:
   * - `InsertReverted` → `Deleted`
   * - `EditReverted`   → `Edited`
   * - `DeleteReverted` → `Edited` (soft-delete) or `New` (hard-delete, pass `true`)
   * All other states are returned as-is.
   */
  public nonVersionedState(hardDelete = false): ObjectState {
    switch (this.state) {
      case ObjectState.InsertReverted: return ObjectState.Deleted;
      case ObjectState.EditReverted:   return ObjectState.Edited;
      case ObjectState.DeleteReverted: return hardDelete ? ObjectState.New : ObjectState.Edited;
      default:                         return this.state;
    }
  }

  private revertedStateFor(state: ObjectState): ObjectState | null {
    switch (state) {
      case ObjectState.New:            return ObjectState.InsertReverted;
      case ObjectState.Edited:         return ObjectState.EditReverted;
      case ObjectState.Deleted:        return ObjectState.DeleteReverted;
      case ObjectState.InsertReverted: return ObjectState.InsertReverted;
      case ObjectState.EditReverted:   return ObjectState.EditReverted;
      case ObjectState.DeleteReverted: return ObjectState.DeleteReverted;
      default:                         return null;
    }
  }

  public validate(property: string, errorMessage: string | undefined): void {
    if (errorMessage) {
      this.validationMessages.set(property, errorMessage);
    } else {
      this.validationMessages.delete(property);
    }

    this.validationMessages = new Map(this.validationMessages);
    this.isValid = this.validationMessages.size === 0;
  }

  public destroy(): void {
    this.tracker.untrackObject(this);
  }

}

export function validateDecorated(model: any): void {
  validate(model);
}
