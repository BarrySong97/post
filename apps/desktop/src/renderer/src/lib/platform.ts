export function isMacWindow() {
  return typeof window !== "undefined" && window.api?.platform?.isMac === true;
}
