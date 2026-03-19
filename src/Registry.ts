import { ITracked as ITrackedItem } from "./ITracked";

type ValidatorMap = Map<string, (model: any) => string | undefined>;
const VALIDATORS = Symbol("validators");

export function registerPropertyValidator(
  proto: object,
  property: string,
  validator: (model: any) => string | undefined,
): void {
  if (!(VALIDATORS in proto)) {
    Object.defineProperty(proto, VALIDATORS, {
      value: new Map<string, (model: any) => string | undefined>(),
      configurable: true,
    });
  }
  const map = (proto as any)[VALIDATORS] as ValidatorMap;
  if (!map.has(property)) {
    map.set(property, validator);
  }
}

export function validate(model: ITrackedItem): void {
  const proto = Object.getPrototypeOf(model);
  if (!(VALIDATORS in proto)) return;
  const validators = (proto as any)[VALIDATORS] as ValidatorMap;
  validators.forEach((validatorFn, property) => {
    model.validate(property, validatorFn(model));
  });
}
