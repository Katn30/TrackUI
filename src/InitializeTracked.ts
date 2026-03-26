import { validateDecorated } from "./TrackedObjectBase";
import { Tracker } from "./Tracker";


export function InitializeTracked<T extends new (...args: any[]) => any>(
  target: T,
  context: ClassDecoratorContext
): T {
  const wrapped = class extends target {
    constructor(...args: any[]) {
      const tracker = args.find((a): a is Tracker => a instanceof Tracker);
      const outerSuppressed = tracker?.isTrackingSuppressed ?? false;
      if (tracker) {
        tracker.beginSuppressTracking();
      }
      super(...args);
      if (tracker) {
        tracker.endSuppressTracking();
      }
      validateDecorated(this);
      if (tracker && !outerSuppressed) {
        tracker.revalidate();
      }
    }
  };
  Object.defineProperty(wrapped, "name", { value: target.name });
  return wrapped as unknown as T;
}
