/** A legacy copy appearing in this host requires an explicit migration and reload. */
export const createLegacyExtensionGuard = (
  legacyIsPresent: () => boolean,
  notify: () => void,
): (() => boolean) => {
  let blocked = false;
  return () => {
    if (!blocked && legacyIsPresent()) {
      blocked = true;
      notify();
    }
    return !blocked;
  };
};
