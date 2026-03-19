export interface ExternallyAssignment {
  placeholder: number;
  value: number;
}

const EXTERNALLY_ASSIGNED = Symbol("externallyAssigned");

export function ExternallyAssigned<This extends object, Value>(
  _target: undefined,
  context: ClassFieldDecoratorContext<This, Value>,
): void {
  context.addInitializer(function (this: This) {
    Object.defineProperty(Object.getPrototypeOf(this), EXTERNALLY_ASSIGNED, {
      value: String(context.name),
      configurable: true,
    });
  });
}

export function getExternallyAssignedProperty(
  proto: object,
): string | undefined {
  return EXTERNALLY_ASSIGNED in proto
    ? ((proto as any)[EXTERNALLY_ASSIGNED] as string)
    : undefined;
}
