import type {
  NonDeletedExcalidrawElement,
  NonDeleted,
  ExcalidrawFreeDrawElement,
} from '@excalidraw/excalidraw/element/types';

import { getFreeDrawSvgPath } from '@excalidraw/excalidraw';
import { SVG_EXPORT_PADDING } from './constants';
import type { AnimationTimelineMap } from './constants';

type AnimateOptions = {
  startMs?: number;
  pointerImg?: string;
  pointerWidth?: string;
  pointerHeight?: string;
  timeline?: AnimationTimelineMap;
};

const SVG_NS = 'http://www.w3.org/2000/svg';

const elementChildren = (node: Node | null | undefined) =>
  node
    ? (Array.from(node.childNodes).filter(
        (child): child is SVGElement => child.nodeType === Node.ELEMENT_NODE,
      ) as SVGElement[])
    : [];

const elementChildAt = (node: Node | null | undefined, index: number) => {
  if (!node) return null;
  let seen = -1;
  const { childNodes } = node;
  for (let i = 0; i < childNodes.length; i += 1) {
    const child = childNodes[i];
    if (child.nodeType === Node.ELEMENT_NODE) {
      seen += 1;
      if (seen === index) return child as SVGElement;
    }
  }
  return null;
};

const collectPaths = (node: SVGElement | null | undefined) => {
  if (!node) return [] as SVGPathElement[];
  const paths: SVGPathElement[] = [];
  const stack = [node];
  while (stack.length) {
    const current = stack.pop();
    if (!current) continue;
    if (current.tagName.toLowerCase() === 'path') {
      paths.push(current as SVGPathElement);
      continue;
    }
    if (current.tagName.toLowerCase() === 'defs') {
      continue;
    }
    const children = elementChildren(current);
    for (let i = children.length - 1; i >= 0; i -= 1) {
      stack.push(children[i]);
    }
  }
  return paths.reverse();
};

const findNode = (ele: SVGElement, name: string) => {
  const childNodes = ele.childNodes as NodeListOf<SVGElement>;
  for (let i = 0; i < childNodes.length; ++i) {
    if (childNodes[i].tagName === name) {
      return childNodes[i];
    }
  }
  return null;
};

const hideBeforeAnimation = (
  svg: SVGSVGElement,
  ele: SVGElement,
  currentMs: number,
  durationMs: number,
  freeze?: boolean,
) => {
  ele.setAttribute('opacity', '0');
  const animate = svg.ownerDocument.createElementNS(SVG_NS, 'animate');
  animate.setAttribute('attributeName', 'opacity');
  animate.setAttribute('from', '1');
  animate.setAttribute('to', '1');
  animate.setAttribute('begin', `${currentMs}ms`);
  animate.setAttribute('dur', `${durationMs}ms`);
  if (freeze) {
    animate.setAttribute('fill', 'freeze');
  }
  ele.appendChild(animate);
};

const pickOnePathItem = (path: string) => {
  const items = path.match(/(M[^C]*C[^M]*)/g);
  if (!items) {
    return path;
  }
  if (items.length <= 2) {
    return items[items.length - 1];
  }
  const [longestIndex] = items.reduce(
    (prev, item, index) => {
      const [, x1, y1, x2, y2] =
        item.match(/M([\d.-]+) ([\d.-]+) C([\d.-]+) ([\d.-]+)/) || [];
      const d = Math.hypot(Number(x2) - Number(x1), Number(y2) - Number(y1));
      if (d > prev[1]) {
        return [index, d];
      }
      return prev;
    },
    [0, 0],
  );
  return items[longestIndex];
};

const animatePointer = (
  svg: SVGSVGElement,
  ele: SVGElement,
  path: string,
  currentMs: number,
  durationMs: number,
  options: AnimateOptions,
) => {
  if (!options.pointerImg) return;
  const img = svg.ownerDocument.createElementNS(SVG_NS, 'image');
  img.setAttribute('href', options.pointerImg);
  if (options.pointerWidth) {
    img.setAttribute('width', options.pointerWidth);
  }
  if (options.pointerHeight) {
    img.setAttribute('height', options.pointerHeight);
  }
  hideBeforeAnimation(svg, img, currentMs, durationMs);
  const animateMotion = svg.ownerDocument.createElementNS(
    SVG_NS,
    'animateMotion',
  );
  animateMotion.setAttribute('path', pickOnePathItem(path));
  animateMotion.setAttribute('begin', `${currentMs}ms`);
  animateMotion.setAttribute('dur', `${durationMs}ms`);
  img.appendChild(animateMotion);
  ele.parentNode?.appendChild(img);
};

const animatePath = (
  svg: SVGSVGElement,
  ele: SVGElement,
  currentMs: number,
  durationMs: number,
  options: AnimateOptions,
) => {
  const dTo = ele.getAttribute('d') || '';
  const mCount = dTo.match(/M/g)?.length || 0;
  const cCount = dTo.match(/C/g)?.length || 0;
  const repeat = cCount / mCount;
  let dLast = dTo;
  for (let i = repeat - 1; i >= 0; i -= 1) {
    const dFrom = dTo.replace(
      new RegExp(
        [
          'M(\\S+) (\\S+)',
          '((?: C\\S+ \\S+, \\S+ \\S+, \\S+ \\S+){',
          `${i}`, // skip count
          '})',
          '(?: C\\S+ \\S+, \\S+ \\S+, \\S+ \\S+){1,}',
        ].join(''),
        'g',
      ),
      (...a) => {
        const [x, y] = a[3]
          ? a[3].match(/.* (\S+) (\S+)$/).slice(1, 3)
          : [a[1], a[2]];
        return (
          `M${a[1]} ${a[2]}${a[3]}` +
          ` C${x} ${y}, ${x} ${y}, ${x} ${y}`.repeat(repeat - i)
        );
      },
    );
    if (i === 0) {
      ele.setAttribute('d', dFrom);
    }
    const animate = svg.ownerDocument.createElementNS(SVG_NS, 'animate');
    animate.setAttribute('attributeName', 'd');
    animate.setAttribute('from', dFrom);
    animate.setAttribute('to', dLast);
    animate.setAttribute('begin', `${currentMs + i * (durationMs / repeat)}ms`);
    animate.setAttribute('dur', `${durationMs / repeat}ms`);
    animate.setAttribute('fill', 'freeze');
    ele.appendChild(animate);
    dLast = dFrom;
  }
  animatePointer(svg, ele, dTo, currentMs, durationMs, options);
  hideBeforeAnimation(svg, ele, currentMs, durationMs, true);
};

const animateFillPath = (
  svg: SVGSVGElement,
  ele: SVGElement,
  currentMs: number,
  durationMs: number,
  options: AnimateOptions,
) => {
  const dTo = ele.getAttribute('d') || '';
  if (dTo.includes('C')) {
    animatePath(svg, ele, currentMs, durationMs, options);
    return;
  }
  const dFrom = dTo.replace(
    new RegExp(['M(\\S+) (\\S+)', '((?: L\\S+ \\S+){1,})'].join('')),
    (...a) => {
      return `M${a[1]} ${a[2]}` + a[3].replace(/L\S+ \S+/g, `L${a[1]} ${a[2]}`);
    },
  );
  ele.setAttribute('d', dFrom);
  const animate = svg.ownerDocument.createElementNS(SVG_NS, 'animate');
  animate.setAttribute('attributeName', 'd');
  animate.setAttribute('from', dFrom);
  animate.setAttribute('to', dTo);
  animate.setAttribute('begin', `${currentMs}ms`);
  animate.setAttribute('dur', `${durationMs}ms`);
  animate.setAttribute('fill', 'freeze');
  ele.appendChild(animate);
};

const animatePolygon = (
  svg: SVGSVGElement,
  ele: SVGElement,
  currentMs: number,
  durationMs: number,
  options: AnimateOptions,
) => {
  let dTo = ele.getAttribute('d') || '';
  let mCount = dTo.match(/M/g)?.length || 0;
  let cCount = dTo.match(/C/g)?.length || 0;
  if (mCount === cCount + 1) {
    // workaround for round rect
    dTo = dTo.replace(/^M\S+ \S+ M/, 'M');
    mCount = dTo.match(/M/g)?.length || 0;
    cCount = dTo.match(/C/g)?.length || 0;
  }
  if (mCount !== cCount) throw new Error('unexpected m/c counts');
  const dups = ele.getAttribute('stroke-dasharray') ? 1 : Math.min(2, mCount);
  const repeat = mCount / dups;
  let dLast = dTo;
  for (let i = repeat - 1; i >= 0; i -= 1) {
    const dFrom = dTo.replace(
      new RegExp(
        [
          '((?:',
          'M(\\S+) (\\S+) C\\S+ \\S+, \\S+ \\S+, \\S+ \\S+ ?'.repeat(dups),
          '){',
          `${i}`, // skip count
          '})',
          'M(\\S+) (\\S+) C\\S+ \\S+, \\S+ \\S+, \\S+ \\S+ ?'.repeat(dups),
          '.*',
        ].join(''),
      ),
      (...a) => {
        return (
          `${a[1]}` +
          [...Array(dups).keys()]
            .map((d) => {
              const [x, y] = a.slice(2 + dups * 2 + d * 2);
              return `M${x} ${y} C${x} ${y}, ${x} ${y}, ${x} ${y} `;
            })
            .join('')
            .repeat(repeat - i)
        );
      },
    );
    if (i === 0) {
      ele.setAttribute('d', dFrom);
    }
    const animate = svg.ownerDocument.createElementNS(SVG_NS, 'animate');
    animate.setAttribute('attributeName', 'd');
    animate.setAttribute('from', dFrom);
    animate.setAttribute('to', dLast);
    animate.setAttribute('begin', `${currentMs + i * (durationMs / repeat)}ms`);
    animate.setAttribute('dur', `${durationMs / repeat}ms`);
    animate.setAttribute('fill', 'freeze');
    ele.appendChild(animate);
    dLast = dFrom;
    animatePointer(
      svg,
      ele,
      dTo.replace(
        new RegExp(
          [
            '(?:',
            'M\\S+ \\S+ C\\S+ \\S+, \\S+ \\S+, \\S+ \\S+ ?'.repeat(dups),
            '){',
            `${i}`, // skip count
            '}',
            '(M\\S+ \\S+ C\\S+ \\S+, \\S+ \\S+, \\S+ \\S+) ?'.repeat(dups),
            '.*',
          ].join(''),
        ),
        '$1',
      ),
      currentMs + i * (durationMs / repeat),
      durationMs / repeat,
      options,
    );
  }
  hideBeforeAnimation(svg, ele, currentMs, durationMs, true);
};

let pathForTextIndex = 0;

const animateText = (
  svg: SVGSVGElement,
  width: number,
  ele: SVGElement,
  currentMs: number,
  durationMs: number,
  options: AnimateOptions,
) => {
  const anchor = ele.getAttribute('text-anchor') || 'start';
  if (anchor !== 'start') {
    // Not sure how to support it, fallback with opacity
    const toOpacity = ele.getAttribute('opacity') || '1.0';
    const animate = svg.ownerDocument.createElementNS(SVG_NS, 'animate');
    animate.setAttribute('attributeName', 'opacity');
    animate.setAttribute('from', '0.0');
    animate.setAttribute('to', toOpacity);
    animate.setAttribute('begin', `${currentMs}ms`);
    animate.setAttribute('dur', `${durationMs}ms`);
    animate.setAttribute('fill', 'freeze');
    ele.appendChild(animate);
    ele.setAttribute('opacity', '0.0');
    return;
  }
  const x = Number(ele.getAttribute('x') || 0);
  const y = Number(ele.getAttribute('y') || 0);
  pathForTextIndex += 1;
  const path = svg.ownerDocument.createElementNS(SVG_NS, 'path');
  path.setAttribute('id', 'pathForText' + pathForTextIndex);
  const animate = svg.ownerDocument.createElementNS(SVG_NS, 'animate');
  animate.setAttribute('attributeName', 'd');
  animate.setAttribute('from', `m${x} ${y} h0`);
  animate.setAttribute('to', `m${x} ${y} h${width}`);
  animate.setAttribute('begin', `${currentMs}ms`);
  animate.setAttribute('dur', `${durationMs}ms`);
  animate.setAttribute('fill', 'freeze');
  path.appendChild(animate);
  const textPath = svg.ownerDocument.createElementNS(SVG_NS, 'textPath');
  textPath.setAttribute('href', '#pathForText' + pathForTextIndex);
  textPath.textContent = ele.textContent;
  ele.textContent = ' '; // HACK for Firebox as `null` does not work
  findNode(svg, 'defs')?.appendChild(path);
  ele.appendChild(textPath);
  animatePointer(
    svg,
    ele,
    `m${x} ${y} h${width}`,
    currentMs,
    durationMs,
    options,
  );
};

const animateFromToPath = (
  svg: SVGSVGElement,
  ele: SVGElement,
  dFrom: string,
  dTo: string,
  currentMs: number,
  durationMs: number,
) => {
  const path = svg.ownerDocument.createElementNS(SVG_NS, 'path');
  const animate = svg.ownerDocument.createElementNS(SVG_NS, 'animate');
  animate.setAttribute('attributeName', 'd');
  animate.setAttribute('from', dFrom);
  animate.setAttribute('to', dTo);
  animate.setAttribute('begin', `${currentMs}ms`);
  animate.setAttribute('dur', `${durationMs}ms`);
  path.appendChild(animate);
  ele.appendChild(path);
};

const patchSvgLine = (
  svg: SVGSVGElement,
  ele: SVGElement,
  isRounded: boolean,
  currentMs: number,
  durationMs: number,
  options: AnimateOptions,
) => {
  const animateLine = isRounded ? animatePath : animatePolygon;
  const wrapper = elementChildAt(ele, 0) || ele;
  const paths = collectPaths(wrapper);
  if (!paths.length) return;
  if (paths[0].getAttribute('fill-rule') && paths[1]) {
    animateLine(svg, paths[1], currentMs, durationMs * 0.75, options);
    currentMs += durationMs * 0.75;
    animateFillPath(svg, paths[0], currentMs, durationMs * 0.25, options);
    return;
  }
  animateLine(svg, paths[0], currentMs, durationMs, options);
};

const patchSvgArrow = (
  svg: SVGSVGElement,
  ele: SVGElement,
  isRounded: boolean,
  currentMs: number,
  durationMs: number,
  options: AnimateOptions,
) => {
  const animateLine = isRounded ? animatePath : animatePolygon;
  const shaftGroup = elementChildAt(ele, 0) || ele;
  const shaftCandidate = elementChildAt(shaftGroup, 0);
  // Fallback: try to find first real path
  const shaft = shaftCandidate || collectPaths(shaftGroup)[0];
  if (!shaft) return;
  const numParts = elementChildren(ele).length || 1;
  animateLine(
    svg,
    shaft,
    currentMs,
    (durationMs / (numParts + 2)) * 3,
    options,
  );
  currentMs += (durationMs / (numParts + 2)) * 3;
  for (let i = 1; i < numParts; i += 1) {
    const headGroup = elementChildAt(ele, i);
    if (!headGroup) continue;
    const heads = collectPaths(headGroup);
    const numHeads = heads.length;
    if (!numHeads) continue;
    const perHead = durationMs / (numParts + 2) / numHeads;
    for (let j = 0; j < numHeads; j += 1) {
      animatePath(svg, heads[j], currentMs, perHead, options);
      currentMs += perHead;
    }
  }
};

const patchSvgRectangle = (
  svg: SVGSVGElement,
  ele: SVGElement,
  currentMs: number,
  durationMs: number,
  options: AnimateOptions,
) => {
  if (ele.childNodes[1]) {
    animatePolygon(
      svg,
      ele.childNodes[1] as SVGElement,
      currentMs,
      durationMs * 0.75,
      options,
    );
    currentMs += durationMs * 0.75;
    animateFillPath(
      svg,
      ele.childNodes[0] as SVGElement,
      currentMs,
      durationMs * 0.25,
      options,
    );
  } else {
    animatePolygon(
      svg,
      ele.childNodes[0] as SVGElement,
      currentMs,
      durationMs,
      options,
    );
  }
};

const patchSvgEllipse = (
  svg: SVGSVGElement,
  ele: SVGElement,
  currentMs: number,
  durationMs: number,
  options: AnimateOptions,
) => {
  if (ele.childNodes[1]) {
    animatePath(
      svg,
      ele.childNodes[1] as SVGElement,
      currentMs,
      durationMs * 0.75,
      options,
    );
    currentMs += durationMs * 0.75;
    animateFillPath(
      svg,
      ele.childNodes[0] as SVGElement,
      currentMs,
      durationMs * 0.25,
      options,
    );
  } else {
    animatePath(
      svg,
      ele.childNodes[0] as SVGElement,
      currentMs,
      durationMs,
      options,
    );
  }
};

const patchSvgText = (
  svg: SVGSVGElement,
  ele: SVGElement,
  width: number,
  currentMs: number,
  durationMs: number,
  options: AnimateOptions,
) => {
  const childNodes = ele.childNodes as NodeListOf<SVGElement>;
  const len = childNodes.length;
  childNodes.forEach((child) => {
    animateText(svg, width, child, currentMs, durationMs / len, options);
    currentMs += durationMs / len;
  });
};

const patchSvgFreedraw = (
  svg: SVGSVGElement,
  ele: SVGElement,
  freeDrawElement: NonDeleted<ExcalidrawFreeDrawElement>,
  currentMs: number,
  durationMs: number,
  options: AnimateOptions,
) => {
  const childNode = ele.childNodes[0] as SVGPathElement;
  childNode.setAttribute('opacity', '0');
  const animate = svg.ownerDocument.createElementNS(SVG_NS, 'animate');
  animate.setAttribute('attributeName', 'opacity');
  animate.setAttribute('from', '0');
  animate.setAttribute('to', '1');
  animate.setAttribute('calcMode', 'discrete');
  animate.setAttribute('begin', `${currentMs + durationMs - 1}ms`);
  animate.setAttribute('dur', `${1}ms`);
  animate.setAttribute('fill', 'freeze');
  childNode.appendChild(animate);
  animatePointer(
    svg,
    childNode,
    freeDrawElement.points.reduce(
      (p, [x, y]) => (p ? p + ` T ${x} ${y}` : `M ${x} ${y}`),
      '',
    ),
    currentMs,
    durationMs,
    options,
  );

  // interporation
  const repeat = freeDrawElement.points.length;
  let dTo = childNode.getAttribute('d') as string;
  for (let i = repeat - 1; i >= 0; i -= 1) {
    const dFrom =
      i > 0
        ? getFreeDrawSvgPath({
            ...freeDrawElement,
            points: freeDrawElement.points.slice(0, i),
          })
        : 'M 0 0';
    animateFromToPath(
      svg,
      ele,
      dFrom,
      dTo,
      currentMs + i * (durationMs / repeat),
      durationMs / repeat,
    );
    dTo = dFrom;
  }
};

const patchSvgImage = (
  svg: SVGSVGElement,
  ele: SVGElement,
  currentMs: number,
  durationMs: number,
) => {
  const toOpacity = ele.getAttribute('opacity') || '1.0';
  const animate = svg.ownerDocument.createElementNS(SVG_NS, 'animate');
  animate.setAttribute('attributeName', 'opacity');
  animate.setAttribute('from', '0.0');
  animate.setAttribute('to', toOpacity);
  animate.setAttribute('begin', `${currentMs}ms`);
  animate.setAttribute('dur', `${durationMs}ms`);
  animate.setAttribute('fill', 'freeze');
  ele.appendChild(animate);
  ele.setAttribute('opacity', '0.0');
};

const patchSvgEle = (
  svg: SVGSVGElement,
  ele: SVGElement,
  excalidraElement: NonDeletedExcalidrawElement,
  currentMs: number,
  durationMs: number,
  options: AnimateOptions,
) => {
  const { type, roundness, width } = excalidraElement;
  if (type === 'line') {
    patchSvgLine(svg, ele, !!roundness, currentMs, durationMs, options);
  } else if (type === 'arrow') {
    patchSvgArrow(svg, ele, !!roundness, currentMs, durationMs, options);
  } else if (
    type === 'rectangle' ||
    type === 'diamond' ||
    type === 'frame'
  ) {
    patchSvgRectangle(svg, ele, currentMs, durationMs, options);
  } else if (type === 'ellipse') {
    patchSvgEllipse(svg, ele, currentMs, durationMs, options);
  } else if (type === 'text') {
    patchSvgText(svg, ele, width, currentMs, durationMs, options);
  } else if (excalidraElement.type === 'freedraw') {
    patchSvgFreedraw(
      svg,
      ele,
      excalidraElement,
      currentMs,
      durationMs,
      options,
    );
  } else if (type === 'image') {
    patchSvgImage(svg, ele, currentMs, durationMs);
  } else {
    console.error('unknown excalidraw element type', excalidraElement.type);
  }
};

const resolveElementGroupId = (
  element: NonDeletedExcalidrawElement,
  timeline?: AnimationTimelineMap,
) => {
  if (timeline) {
    const meta = timeline[element.id];
    if (meta && Object.prototype.hasOwnProperty.call(meta, 'groupId')) {
      if (meta.groupId === null) {
        return null;
      }
      const trimmed = typeof meta.groupId === 'string' ? meta.groupId.trim() : '';
      if (trimmed) {
        return trimmed;
      }
      return null;
    }
  }
  const ids = element.groupIds || [];
  return ids.length ? ids[ids.length - 1] ?? null : null;
};

const createGroups = (
  pairs: readonly MatchedPair[],
  timeline?: AnimationTimelineMap,
) => {
  const groups: { [groupId: string]: (readonly [SVGElement, number])[] } = {};
  if (!pairs.length) return groups;

  pairs.forEach(([ele, element, index]) => {
    const groupId = resolveElementGroupId(element, timeline);
    if (!groupId) return;
    groups[groupId] = groups[groupId] || [];
    groups[groupId].push([ele, index] as const);
  });
  return groups;
};

const filterGroupNodes = (nodes: NodeListOf<SVGElement>) =>
  [...nodes].filter(
    (node) => node.tagName === 'g' || node.tagName === 'use' /* for images */,
  );

const parseTranslate = (transform?: string | null) => {
  if (!transform) return null;
  const match = /translate\(([-\d.]+)[ ,]([-\d.]+)\)/.exec(transform);
  if (!match) return null;
  return { x: Number(match[1]), y: Number(match[2]) };
};

const resolveNodeTranslate = (node: SVGElement) => {
  const stack: SVGElement[] = [node];
  while (stack.length) {
    const current = stack.shift();
    if (!current) break;
    const translate = parseTranslate(current.getAttribute('transform'));
    if (translate) return translate;
    elementChildren(current).forEach((child) => {
      stack.push(child);
    });
  }
  return null;
};

const shouldSkipElementForAnimation = (
  element: NonDeletedExcalidrawElement | undefined,
) => {
  if (!element) return true;
  return element.type === 'frame';
};

type MatchedPair = readonly [
  SVGElement,
  NonDeletedExcalidrawElement,
  number,
];

/**
 * Excalidraw 导出的 SVG 每个顶层 <g> 带有 translate(minX->0 + padding)。
 * 这里按 translate 坐标与元素原始 (x,y) 做最近匹配，避免因 DOM 顺序变化导致
 * 文字/箭头错配，从而出现“箭头不见了”的问题。Frame 等非渲染元素会被忽略。
 */
const matchSvgNodesToElements = (
  nodes: SVGElement[],
  elements: readonly NonDeletedExcalidrawElement[],
) => {
  const renderableElements = elements
    .map((element, index) => ({ element, index }))
    .filter(({ element }) => !shouldSkipElementForAnimation(element));
  if (!nodes.length || !renderableElements.length) {
    return [];
  }

  // 计算全局最小坐标，用于还原 exportToSvg 的偏移
  const minX = Math.min(...renderableElements.map(({ element }) => element.x));
  const minY = Math.min(...renderableElements.map(({ element }) => element.y));

  const matched: MatchedPair[] = [];
  const remainingNodes = [...nodes];
  renderableElements.forEach(({ element, index }) => {
    const expected = {
      x: element.x - minX + SVG_EXPORT_PADDING,
      y: element.y - minY + SVG_EXPORT_PADDING,
    };
    let matchIndex = -1;
    let minDistance = Infinity;
    remainingNodes.forEach((node, nodeIndex) => {
      const translate = resolveNodeTranslate(node);
      if (!translate) return;
      const dx = translate.x - expected.x;
      const dy = translate.y - expected.y;
      const distance = dx * dx + dy * dy;
      if (distance < minDistance) {
        minDistance = distance;
        matchIndex = nodeIndex;
      }
    });
    if (matchIndex >= 0) {
      const [node] = remainingNodes.splice(matchIndex, 1);
      matched.push([node, element, index]);
    }
  });

  if (!matched.length) {
    const limit = Math.min(nodes.length, renderableElements.length);
    for (let i = 0; i < limit; i += 1) {
      matched.push([
        nodes[i],
        renderableElements[i].element,
        renderableElements[i].index,
      ]);
    }
  }

  return matched;
};

const extractNumberFromElement = (
  element: NonDeletedExcalidrawElement,
  key: string,
) => {
  const match = element.id.match(new RegExp(`${key}:(-?\\d+)`));
  return (match && Number(match[1])) || 0;
};

const getTimelineNumber = (
  element: NonDeletedExcalidrawElement,
  key: 'order' | 'duration',
  timeline?: AnimationTimelineMap,
) => {
  if (!timeline) return undefined;
  const entry = timeline[element.id];
  const value = entry?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
};

const sortSvgPairs = (
  pairs: readonly MatchedPair[],
  timeline?: AnimationTimelineMap,
) =>
  [...pairs].sort((a, b) => {
    const [, elA] = a;
    const [, elB] = b;
    const aOrder =
      getTimelineNumber(elA, 'order', timeline) ||
      extractNumberFromElement(elA, 'animateOrder');
    const bOrder =
      getTimelineNumber(elB, 'order', timeline) ||
      extractNumberFromElement(elB, 'animateOrder');
    return aOrder - bOrder;
  });

export const animateSvg = (
  svg: SVGSVGElement,
  elements: readonly NonDeletedExcalidrawElement[],
  options: AnimateOptions = {},
) => {
  if (!elements.length) {
    const margin = options.startMs ?? 1000;
    return { finishedMs: margin + 1000 };
  }
  const timeline = options.timeline;
  const finished = new Map();
  let current = options.startMs ?? 1000; // 1 sec margin
  const groupDur = 5000;
  const individualDur = 500;

  const groupNodesRaw = filterGroupNodes(
    svg.childNodes as NodeListOf<SVGElement>,
  );
  const pairs = matchSvgNodesToElements(groupNodesRaw, elements);
  const groups = createGroups(pairs, timeline);

  sortSvgPairs(pairs, timeline).forEach(([ele, element]) => {
    if (!element) return;
    if (finished.has(ele)) return;

    const groupId = resolveElementGroupId(element, timeline);
    if (groupId) {
      const group = groups[groupId];
      const dur =
        getTimelineNumber(element, 'duration', timeline) ||
        extractNumberFromElement(element, 'animateDuration') ||
        groupDur / ((group?.length || 0) + 1);
      patchSvgEle(svg, ele, element, current, dur, options);
      current += dur;
      finished.set(ele, true);

      group?.forEach(([childEle, childIndex]) => {
        const childElement = elements[childIndex];
        if (!childElement || childElement.type === 'frame') return;
        const dur =
          getTimelineNumber(childElement, 'duration', timeline) ||
          extractNumberFromElement(childElement, 'animateDuration') ||
          groupDur / ((group?.length || 0) + 1);
        if (!finished.has(childEle)) {
          patchSvgEle(svg, childEle, childElement, current, dur, options);
          current += dur;
          finished.set(childEle, true);
        }
      });
      delete groups[groupId];
    } else {
      const dur =
        getTimelineNumber(element, 'duration', timeline) ||
        extractNumberFromElement(element, 'animateDuration') ||
        individualDur;
      patchSvgEle(svg, ele, element, current, dur, options);
      current += dur;
      finished.set(ele, true);
    }
  });
  const finishedMs = current + 1000; // 1 sec margin
  return { finishedMs };
};

export const getBeginTimeList = (svg: SVGSVGElement) => {
  const beginTimeList: number[] = [];
  const tmpTimeList: number[] = [];
  const findAnimate = (ele: SVGElement) => {
    if (ele.tagName === 'animate') {
      const match = /([0-9.]+)ms/.exec(ele.getAttribute('begin') || '');
      if (match) {
        tmpTimeList.push(Number(match[1]));
      }
    }
    (ele.childNodes as NodeListOf<SVGElement>).forEach((ele) => {
      findAnimate(ele);
    });
  };
  (svg.childNodes as NodeListOf<SVGElement>).forEach((ele) => {
    if (ele.tagName === 'g') {
      findAnimate(ele);
      if (tmpTimeList.length) {
        beginTimeList.push(Math.min(...tmpTimeList));
        tmpTimeList.splice(0);
      }
    } else if (ele.tagName === 'defs') {
      (ele.childNodes as NodeListOf<SVGElement>).forEach((ele) => {
        findAnimate(ele);
        if (tmpTimeList.length) {
          beginTimeList.push(Math.min(...tmpTimeList));
          tmpTimeList.splice(0);
        }
      });
    }
  });
  return beginTimeList;
};
