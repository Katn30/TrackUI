import { Tracker } from "./Tracker";

export interface ITracked {
  tracker: Tracker;
  isDirty: boolean;
  dirtyCounter: number;

  validate(property: string, errorMessage: string | undefined): void;
  destroy(): void;
}
