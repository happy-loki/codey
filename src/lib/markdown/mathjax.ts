const FORMULA_ATTR = "data-formula";
const FORMULA_TYPE_ATTR = "data-formula-type";

const INLINE_WRAPPER_CLASS = "span-inline-equation";
const BLOCK_WRAPPER_CLASS = "span-block-equation";
const INLINE_EQUATION_CLASS = "inline-equation";
const BLOCK_EQUATION_CLASS = "block-equation";

type MathJaxInstance = any;

declare global {
  interface Window {
    MathJax?: MathJaxInstance;
    MathJaxAddContainer?: (math: any, doc: any) => void;
    __codeyMathJaxPromise__?: Promise<MathJaxInstance | null>;
  }
}

let configured = false;

function ensureConfig(): void {
  if (typeof window === "undefined" || configured) {
    return;
  }

  const current = window.MathJax ?? {};
  const tex = current.tex ?? {};
  const svg = current.svg ?? {};
  const options = current.options ?? {};
  const renderActions = options.renderActions ?? {};

  window.MathJax = {
    ...current,
    tex: {
      inlineMath: tex.inlineMath ?? [["$", "$"], ["\\(", "\\)"]],
      displayMath: tex.displayMath ?? [["$$", "$$"], ["\\[", "\\]"]],
      tags: tex.tags ?? "ams",
      ...tex,
    },
    svg: {
      fontCache: "none",
      ...svg,
    },
    options: {
      ...options,
      renderActions: {
        ...renderActions,
        addMenu: renderActions.addMenu ?? [0, "", ""],
        addContainer: [
          190,
          (doc: any) => {
            if (!window.MathJaxAddContainer) return;
            for (const math of doc.math ?? []) {
              try {
                window.MathJaxAddContainer(math, doc);
              }
              catch (error) {
                console.warn("[markdown] MathJax addContainer iteration failed", error);
              }
            }
          },
          (math: any, doc: any) => {
            try {
              window.MathJaxAddContainer?.(math, doc);
            }
            catch (error) {
              console.warn("[markdown] MathJax addContainer failed", error);
            }
          },
        ],
      },
    },
  } as MathJaxInstance;

  window.MathJaxAddContainer = addContainer;
  configured = true;
}

function addContainer(math: any, doc: any): void {
  try {
    const adaptor = doc?.adaptor;
    const typesetRoot = math?.typesetRoot;
    if (!adaptor || !typesetRoot) {
      return;
    }

    const isDisplay = Boolean(math.display);
    const wrapperClass = isDisplay ? BLOCK_WRAPPER_CLASS : INLINE_WRAPPER_CLASS;
    const equationClass = isDisplay ? BLOCK_EQUATION_CLASS : INLINE_EQUATION_CLASS;

    adaptor.setAttribute(typesetRoot, "class", equationClass);
    adaptor.setAttribute(typesetRoot, FORMULA_ATTR, math.math ?? "");
    adaptor.setAttribute(typesetRoot, FORMULA_TYPE_ATTR, equationClass);
    adaptor.setAttribute(typesetRoot, "data-latex", math.math ?? "");

    const wrapper = adaptor.node("span", { class: wrapperClass, style: "cursor:pointer" }, [typesetRoot]);
    adaptor.setAttribute(wrapper, FORMULA_ATTR, math.math ?? "");
    adaptor.setAttribute(wrapper, FORMULA_TYPE_ATTR, equationClass);

    math.typesetRoot = wrapper;
  }
  catch (error) {
    console.warn("[markdown] MathJax wrapper generation failed", error);
  }
}

async function loadMathJax(): Promise<MathJaxInstance | null> {
  if (typeof window === "undefined") {
    return null;
  }

  if (window.MathJax?.startup?.promise) {
    await window.MathJax.startup.promise;
    return window.MathJax;
  }

  if (!window.__codeyMathJaxPromise__) {
    window.__codeyMathJaxPromise__ = (async () => {
      ensureConfig();
      await import("mathjax/es5/tex-svg-full.js");
      const instance = window.MathJax;
      if (!instance?.startup?.promise) {
        throw new Error("MathJax startup promise missing");
      }
      await instance.startup.promise;
      return instance;
    })().catch((error) => {
      console.warn("[markdown] MathJax 加载失败", error);
      window.__codeyMathJaxPromise__ = undefined;
      return null;
    });
  }

  return window.__codeyMathJaxPromise__ ?? null;
}

let typesetQueue: Promise<void> = Promise.resolve();
const elementSeq = new WeakMap<HTMLElement, number>();

export async function typesetMathInElement(element: HTMLElement | null | undefined): Promise<void> {
  if (typeof window === "undefined" || !element) {
    return;
  }

  // 这个函数在流式输出/虚拟列表滚动时可能被非常频繁地调用。
  // 为避免旧的 typeset 任务在队列里“排队很久后才执行”，从而对已经变化的 DOM 结构做操作，
  // 这里按 element 做一次“只保留最新任务”的去抖：旧任务轮到执行时会自动跳过。
  const callSeq = (elementSeq.get(element) ?? 0) + 1;
  elementSeq.set(element, callSeq);

  typesetQueue = typesetQueue.then(async () => {
    // element 可能在异步队列执行前已被虚拟列表卸载（scroll/measure 触发频繁），
    // 对已脱离文档的节点进行 typeset 容易触发内部 DOM 操作异常（例如 insertBefore）。
    if (!element.isConnected) {
      return;
    }
    if (elementSeq.get(element) !== callSeq) {
      return;
    }

    const mathjax = await loadMathJax();
    if (!mathjax) {
      return;
    }

    try {
      if (!element.isConnected) {
        return;
      }
      if (elementSeq.get(element) !== callSeq) {
        return;
      }
      await mathjax.startup?.promise;
      mathjax.texReset?.();
      mathjax.typesetClear?.([element]);
      await mathjax.typesetPromise?.([element]);
    }
    catch (error) {
      console.warn("[markdown] MathJax typeset 失败", error);
    }
  });

  try {
    await typesetQueue;
  }
  catch {
    // 队列链路已在内部记录日志，吞掉异常防止阻塞后续调用
  }
}

export function resetMathJaxQueue(): void {
  typesetQueue = Promise.resolve();
}

export const mathFormulaAttributes = {
  FORMULA_ATTR,
  FORMULA_TYPE_ATTR,
  INLINE_WRAPPER_CLASS,
  BLOCK_WRAPPER_CLASS,
  INLINE_EQUATION_CLASS,
  BLOCK_EQUATION_CLASS,
} as const;
