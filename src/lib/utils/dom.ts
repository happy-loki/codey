export async function waitForElement(selector: string, timeoutMs = 5000): Promise<HTMLElement> {
  const start = performance.now();
  const isId = selector.startsWith('#');
  const getEl = () => (isId ? document.getElementById(selector.slice(1)) : (document.querySelector(selector) as HTMLElement | null));
  let el = getEl();
  if (el) return el as HTMLElement;
  return new Promise((resolve, reject) => {
    const interval = 50;
    const timer = setInterval(() => {
      el = getEl();
      if (el) {
        clearInterval(timer);
        clearTimeout(abort);
        resolve(el as HTMLElement);
      } else if (performance.now() - start >= timeoutMs) {
        // Let final iteration try one last time
      }
    }, interval);
    const abort = setTimeout(() => {
      clearInterval(timer);
      reject(new Error(`waitForElement timeout: ${selector}`));
    }, timeoutMs);
  });
}

