import { Tracker } from "./Tracker";
import { validate } from "./Registry";
import { ITracked } from "./ITracked";
import { Operation } from "./Operation";
import { OperationProperties } from "./OperationProperties";
import { PropertyType } from "./PropertyType";
import { ExternalAssignment, getExternallyAssignedProperty } from "./ExternallyAssigned";

export abstract class TrackedObjectBase implements ITracked {
  private _dirtyCounter: number = 0;
  private _validationMessages: Map<string, string | undefined> | undefined;
  private _isValid: boolean = true;

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
    const wasValid = this._isValid;
    this._isValid = value;
    if (wasValid !== value) {
      this.tracker.onValidityChanged(wasValid, value);
    }
  }

  public get isDirty(): boolean {
    return this._dirtyCounter !== 0;
  }

  public get dirtyCounter(): number {
    return this._dirtyCounter;
  }
  protected set dirtyCounter(value: number) {
    this._dirtyCounter = value;
  }

  public constructor(public readonly tracker: Tracker) {
    if (process.env.NODE_ENV !== 'production' && !tracker.isConstructing) {
      throw new Error(`${this.constructor.name} must be created inside tracker.construct()`);
    }
    this.validationMessages = new Map<string, string>();
    tracker.trackObject(this);
  }

  public abstract onCommitted(lastOp?: Operation): void;
  public abstract markDeletion(): void;
  public abstract markAsNew(): void;

  public applyExternalAssignments(keys: ExternalAssignment[], lastOp?: Operation): void {
    const propertyName = getExternallyAssignedProperty(Object.getPrototypeOf(this));
    if (!propertyName || (this as any)[propertyName] >= 0) return;
    const response = keys.find((x) => x.placeholder === (this as any)[propertyName]);
    if (!response) return;
    const previousValue = (this as any)[propertyName];
    const newValue = response.value;
    const redoFn = () => { (this as any)[propertyName] = newValue; };
    const undoFn = () => { (this as any)[propertyName] = previousValue; };
    if (lastOp) {
      lastOp.add(redoFn, undoFn, new OperationProperties(this, propertyName, PropertyType.Number));
    }
    redoFn();
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

  public applyValidation(messages: Map<string, string>): void {
    this.validationMessages = messages;
    this.isValid = messages.size === 0;
  }

  public destroy(): void {
    this.tracker.untrackObject(this);
  }
}

export function validateDecorated(model: any): void {
  validate(model);
}
