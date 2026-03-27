// @InitializeTracked has been removed. Use tracker.construct() instead.
// This file is kept only for backwards compatibility with existing imports.
export function InitializeTracked<T extends new (...args: any[]) => any>(
  target: T,
  _context: ClassDecoratorContext,
): T {
  return target;
}
