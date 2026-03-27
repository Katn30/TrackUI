import { TypedEvent } from "./TypedEvent";
import { Operation } from "./Operation";
import { TrackedCollection } from "./TrackedCollection";
import { OperationProperties } from "./OperationProperties";
import { PropertyType } from "./PropertyType";
import { CollectionUtilities } from "./CollectionUtilities";
import {
  ExternalAssignment,
  getExternallyAssignedProperty,
} from "./ExternallyAssigned";
import { validate } from "./Registry";
import { ITracked } from "./ITracked";
import { TrackedObjectBase } from "./TrackedObjectBase";

export class Tracker {
  private _currentOperation: Operation | undefined;
  private readonly _redoOperations: Operation[];
  private readonly _undoOperations: Operation[];
  private _commitStateOperation: Operation | undefined;
  private _isDirty: boolean;
  private _canUndo: boolean;
  private _canRedo: boolean;
  private _suppressTrackingCounter = 0;
  private _currentOperationOwner: ITracked | undefined;
  private _currentOperationPropertyName: string | undefined;
  private _isValid: boolean;
  private _canCommit: boolean;
  private _externallyAssignedPlaceholderCounter = -1;
  private _invalidCount = 0;
  private _constructionDepth = 0;

  public readonly coalescingWindowMs: number | undefined;

  public readonly trackedObjects: TrackedObjectBase[] = [];

  public readonly trackedCollections: TrackedCollection<any>[] = [];

  public get isDirty(): boolean {
    return this._isDirty;
  }
  public set isDirty(value: boolean) {
    if (this._isDirty !== value) {
      this._isDirty = value;
      this.isDirtyChanged.emit(value);
      this.updateCanCommit();
    }
  }

  public readonly isDirtyChanged: TypedEvent<boolean> = new TypedEvent<boolean>();

  public get isValid(): boolean {
    return this._isValid;
  }
  private set isValid(value: boolean) {
    if (this._isValid !== value) {
      this._isValid = value;
      this.isValidChanged.emit(value);
      this.updateCanCommit();
    }
  }

  public readonly isValidChanged: TypedEvent<boolean> = new TypedEvent<boolean>();

  public get canCommit(): boolean {
    return this._canCommit;
  }
  private set canCommit(value: boolean) {
    if (this._canCommit !== value) {
      this._canCommit = value;
      this.canCommitChanged.emit(value);
    }
  }

  public readonly canCommitChanged: TypedEvent<boolean> = new TypedEvent<boolean>();

  private updateCanCommit(): void {
    this.canCommit = this._isDirty && this._isValid;
  }

  public get canUndo(): boolean {
    return this._canUndo;
  }
  private set canUndo(value: boolean) {
    this._canUndo = value;
  }

  public get canRedo(): boolean {
    return this._canRedo;
  }
  private set canRedo(value: boolean) {
    this._canRedo = value;
  }

  public get isTrackingSuppressed(): boolean {
    return this._suppressTrackingCounter > 0;
  }

  public get isConstructing(): boolean {
    return this._constructionDepth > 0;
  }

  public constructor(coalescingWindowMs: number | undefined = 3000) {
    this.coalescingWindowMs = coalescingWindowMs;
    this._currentOperation = undefined;
    this._redoOperations = [];
    this._undoOperations = [];
    this._commitStateOperation = undefined;
    this._isDirty = false;
    this._canUndo = false;
    this._canRedo = false;
    this._suppressTrackingCounter = 0;
    this._currentOperationOwner = undefined;
    this._currentOperationPropertyName = undefined;
    this._isValid = true;
    this._canCommit = false;
  }

  public trackObject(trackedObject: TrackedObjectBase) {
    this.trackedObjects.push(trackedObject);
  }

  public untrackObject(trackedObject: TrackedObjectBase) {
    this.trackedObjects.splice(this.trackedObjects.indexOf(trackedObject), 1);
    if (!trackedObject.isValid) this._invalidCount--;
    this.isValid = this._invalidCount === 0;
  }

  public trackCollection(trackedCollection: TrackedCollection<any>): void {
    this.trackedCollections.push(trackedCollection);
  }

  public untrackCollection(trackedCollection: TrackedCollection<any>) {
    this.trackedCollections.splice(
      this.trackedCollections.indexOf(trackedCollection),
      1,
    );
    if (!trackedCollection.isValid) this._invalidCount--;
    this.isValid = this._invalidCount === 0;
  }

  public onValidityChanged(wasValid: boolean, isNowValid: boolean): void {
    if (wasValid && !isNowValid) this._invalidCount++;
    else if (!wasValid && isNowValid) this._invalidCount--;
    if (!this.isTrackingSuppressed) {
      this.isValid = this._invalidCount === 0;
    }
  }

  public construct<T>(action: () => T): T {
    const objectsBefore = this.trackedObjects.length;
    this._constructionDepth++;
    this._suppressTrackingCounter++;
    const result = action();
    for (let i = objectsBefore; i < this.trackedObjects.length; i++) {
      validate(this.trackedObjects[i]);
    }
    this._suppressTrackingCounter--;
    this._constructionDepth--;
    this.isValid = this._invalidCount === 0;
    return result;
  }

  public withTrackingSuppressed(action: () => void): void {
    this._suppressTrackingCounter++;
    action();
    this._suppressTrackingCounter--;
  }

  public beginSuppressTracking(): void {
    this._suppressTrackingCounter++;
  }

  public endSuppressTracking(): void {
    this._suppressTrackingCounter--;
  }

  public doAndTrack(
    redoAction: () => void,
    undoAction: () => void,
    properties: OperationProperties,
  ): void {
    if (this.isTrackingSuppressed) {
      redoAction();
      if (!this.isConstructing) {
        this.revalidate();
      }
      return;
    }

    if (this.isStartingNewOperation()) {
      this._currentOperationOwner = properties.trackedObject;
      this._currentOperationPropertyName = properties.property;

      if (this.shouldCoalesceChanges(properties)) {
        this._currentOperation = CollectionUtilities.getLast(this._undoOperations)!;
      } else {
        this._currentOperation = new Operation();
        this._undoOperations.push(this._currentOperation);
        this._redoOperations.length = 0;
        this.reset();
      }
    }

    this._currentOperation?.add(
      () => redoAction(),
      () => undoAction(),
      properties,
    );
    redoAction();

    if (this.isEndingCurrentOperation(properties)) {
      this._currentOperation = undefined;
      this._currentOperationOwner = undefined;
      this._currentOperationPropertyName = undefined;
      this.revalidate();
    }
  }

  private isEndingCurrentOperation(properties: OperationProperties) {
    return this._currentOperationOwner === properties.trackedObject &&
      this._currentOperationPropertyName === properties.property;
  }

  private isStartingNewOperation() {
    return this._currentOperationOwner === undefined &&
      this._currentOperationPropertyName === undefined;
  }

  private shouldCoalesceChanges(properties: OperationProperties): boolean {
    const lastOperation = CollectionUtilities.getLast(this._undoOperations);
    return (
      this.isCoalescibleType(properties) &&
      this.hasLastOperation(lastOperation) &&
      this.lastOperationTargetsSameProperty(lastOperation!, properties) &&
      this.lastActionIsRecent(lastOperation!)
    );
  }

  private isCoalescibleType(properties: OperationProperties): boolean {
    return (
      !properties.noCoalesce &&
      (properties.type === PropertyType.String ||
        properties.type === PropertyType.Number)
    );
  }

  private hasLastOperation(lastOperation: Operation | undefined): boolean {
    return !!lastOperation;
  }

  private lastOperationTargetsSameProperty(lastOperation: Operation, properties: OperationProperties): boolean {
    return lastOperation.actions.every(
      (x) =>
        x.properties.trackedObject === properties.trackedObject &&
        x.properties.property === properties.property,
    );
  }

  private lastActionIsRecent(lastOperation: Operation): boolean {
    if (this.coalescingWindowMs === undefined) return false;
    return (
      new Date().getTime() -
        CollectionUtilities.getLast(lastOperation.actions)!.time.getTime() <
        this.coalescingWindowMs
    );
  }

  public onCommit(keys?: ExternalAssignment[]): void {
    const lastOp = CollectionUtilities.getLast(this._undoOperations);
    if (keys) {
      this.trackedObjects.forEach((obj) => obj.applyExternalAssignments(keys, lastOp));
    }
    this.trackedObjects.forEach((obj) => obj.onCommitted(lastOp));
    this._commitStateOperation = lastOp;
    this.reset();
  }

  public isInUndoStack(op: Operation): boolean {
    return this._undoOperations.includes(op);
  }

  public beforeCommit() {
    this.trackedObjects.forEach((model) => {
      const propertyName = getExternallyAssignedProperty(
        Object.getPrototypeOf(model),
      );
      if (propertyName && (model as any)[propertyName] <= 0) {
        (model as any)[propertyName] = this._externallyAssignedPlaceholderCounter--;
      }
    });
  }

  private reset(): void {
    this.canUndo = this._undoOperations.length > 0;
    this.canRedo = this._redoOperations.length > 0;
    this.isDirty =
      CollectionUtilities.getLast(this._undoOperations) !==
      this._commitStateOperation;
  }

  public undo(): void {
    if (!this.canUndo) {
      return;
    }

    const undoOperation = this._undoOperations.pop()!;
    this.withTrackingSuppressed(() => undoOperation.undo());
    this._redoOperations.push(undoOperation);

    this.reset();
    this.revalidate();
  }

  public redo(): void {
    if (!this.canRedo) {
      return;
    }

    const redoOperation = this._redoOperations.pop()!;
    this.withTrackingSuppressed(() => redoOperation.redo());
    this._undoOperations.push(redoOperation);

    this.reset();
    this.revalidate();
  }

  public revalidate(): void {
    this.trackedObjects.forEach((x) => validate(x));
    this.trackedCollections.forEach((x) => x.validate());
    this.isValid = this._invalidCount === 0;
  }
}
