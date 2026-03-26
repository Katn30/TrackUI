import { TrackedObjectBase } from "./TrackedObjectBase";
import { OperationProperties } from "./OperationProperties";
import { PropertyType } from "./PropertyType";
import { ITracked } from "./ITracked";
import { registerPropertyValidator } from "./Registry";

export function Tracked<T extends TrackedObjectBase, V>(
  validator?: (self: T, newValue: V) => string | undefined,
  options?: { noCoalesce?: boolean },
) {
  function decorator(
    target: ClassAccessorDecoratorTarget<T, V>,
    context: ClassAccessorDecoratorContext,
  ): ClassAccessorDecoratorResult<T, V>;
  function decorator(
    target: (this: T, value: V) => void,
    context: ClassSetterDecoratorContext,
  ): (this: T, value: V) => void;
  function decorator(
    target: ClassAccessorDecoratorTarget<T, V> | ((this: T, value: V) => void),
    context: ClassAccessorDecoratorContext | ClassSetterDecoratorContext,
  ): ClassAccessorDecoratorResult<T, V> | ((this: T, value: V) => void) {
    const propertyName = String(context.name);

    if (context.kind === "accessor") {
      const accessorTarget = target as ClassAccessorDecoratorTarget<T, V>;

      if (validator) {
        context.addInitializer(function (this: unknown) {
          registerPropertyValidator(
            Object.getPrototypeOf(this),
            propertyName,
            (model: any) => validator(model, accessorTarget.get.call(model)),
          );
        });
      }

      return {
        set(this: T, newValue: V) {
          const oldValue = accessorTarget.get.call(this);

          if (isSameValue(oldValue, newValue)) {
            return;
          }

          if (!this.tracker || this.tracker.isTrackingSuppressed) {
            accessorTarget.set.call(this, newValue);
            return;
          }

          const properties = new OperationProperties(
            this,
            propertyName,
            getPropertyType(newValue, oldValue),
            validator ? (model: any, v: any) => validator(model, v) : undefined,
            options?.noCoalesce,
          );

          this.tracker.doAndTrack(
            () => {
              accessorTarget.set.call(this, newValue);
              (this as unknown as ITracked).dirtyCounter++;
            },
            () => {
              accessorTarget.set.call(this, oldValue);
              (this as unknown as ITracked).dirtyCounter--;
            },
            properties,
          );
        },
      };
    } else {
      const setterFn = target as (this: T, value: V) => void;

      if (validator) {
        context.addInitializer(function (this: unknown) {
          registerPropertyValidator(
            Object.getPrototypeOf(this),
            propertyName,
            (model: any) => validator(model, (model as any)[propertyName]),
          );
        });
      }

      return function (this: T, newValue: V): void {
        const oldValue = (this as any)[propertyName] as V;

        if (isSameValue(oldValue, newValue)) {
          return;
        }

        if (!this.tracker || this.tracker.isTrackingSuppressed) {
          setterFn.call(this, newValue);
          return;
        }

        const properties = new OperationProperties(
          this,
          propertyName,
          getPropertyType(newValue, oldValue),
          validator ? (model: any, v: any) => validator(model, v) : undefined,
        );

        this.tracker.doAndTrack(
          () => {
            setterFn.call(this, newValue);
            (this as unknown as ITracked).dirtyCounter++;
          },
          () => {
            setterFn.call(this, oldValue);
            (this as unknown as ITracked).dirtyCounter--;
          },
          properties,
        );
      };
    }
  }

  return decorator;
}

function isSameValue(value1: any, value2: any): boolean {
  return (
    value1 === value2 ||
    ((value1 === undefined || value1 === null) && value2 === "") ||
    ((value2 === undefined || value2 === null) && value1 === "")
  );
}

function getPropertyType(newValue: any, oldValue: any): PropertyType {
  const v = newValue ?? oldValue;
  if (v instanceof Date) return PropertyType.Date;
  switch (typeof v) {
    case "string":
      return PropertyType.String;
    case "boolean":
      return PropertyType.Boolean;
    case "number":
      return PropertyType.Number;
    case "object":
      return PropertyType.Object;
    default:
      throw new Error(`Property type '${typeof v}' not supported`);
  }
}
