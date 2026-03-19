import { Tracker } from "./Tracker";
import { validate } from "./Registry";
import { ITracked } from "./ITracked";

export abstract class TrackedObject implements ITracked {
  private _dirtyCounter: number;
  private _validationMessages: Map<string, string | undefined> | undefined;
  private _isValid: boolean;

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

  public constructor(public readonly tracker: Tracker) {
    this.validationMessages = new Map<string, string>();
    this._isValid = true;
    this._dirtyCounter = 0;
    tracker.trackObject(this);
  }

  public onCommitted(): void {
    this.dirtyCounter = 0;
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
