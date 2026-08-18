export const DEFAULT_MARKDOWN_CSS = `/*
 * Markdown 自定义样式操作手册（提供给 AI）
 * 目标：手机端优先，复刻微信文章体验。
 *
 * 一、渲染组成
 * 1. 最终样式 = 工具栏控件（styleStore） + 主题预设（themeMap） + 本文件自定义。
 * 2. defaultStyleConfig 写入字体、字号、行距、宽度、主题色、代码高亮等默认值。
 * 3. 代码高亮配色来自 70+ Highlight 主题；本模板仅负责容器装饰，勿覆盖语法颜色。
 *
 * 二、工具栏控件说明
 * - 「风格」(theme)：default / grace / simple，决定标题、引用、列表的基础装饰。
 * - 「主题色」：写入 CSS 变量 --md-primary-color，驱动标题边框、引用色条、强调文字。如需完全自定义，请覆盖该变量。
 * - 「字体」「字号」：影响正文及引用段落的 font-family / font-size。
 * - 「代码」：选择 Highlight CSS，并附加行号、Mac 外框等布尔开关。
 * - 「宽度」「首行缩进」「两端对齐」等：通过 styleStore 注入类名，请避免重复设置。
 *
 * 三、主题预设关键样式 (src/lib/markdown/reference/shared/configs/theme.ts)
 * default：
 *   - h1：padding 0 1em；border-bottom 2px solid var(--md-primary-color)；margin 2em auto 1em。
 *   - h2：background var(--md-primary-color)；margin 4em auto 2em；居中显示。
 *   - h3：padding-left 8px；border-left 3px solid var(--md-primary-color)；margin-top 2em。
 *   - p：margin 1.5em 8px。
 *   - blockquote：margin 0 0 1em；padding 1em；border-left 4px solid var(--md-primary-color)；background var(--blockquote-background)。
 *   - blockquote_p：margin 0 0 1em；用于引用内部段落。
 * grace：在 default 基础增加阴影与圆角，blockquote 保留左色条。
 * simple：标题使用 color-mix 边框，blockquote 改为细线框。
 *
 * 四、常见改造范例
 * 1. 移除标题 / 引用竖线：
 *    h1, h2, h3 { border-left: none !important; padding-left: 0; }
 *    blockquote { border-left: none !important; }
 * 2. 缩小引用上下留白：
 *    blockquote { margin: 0.5em 0 !important; padding: 0.8em 1.2em; }
 *    blockquote_p { margin: 0 !important; }
 *    p { margin: 1em 8px !important; }
 *    // 留白来自 blockquote 与相邻 p 的 margin 叠加，需要同时调整。
 * 3. 自定义主色逻辑：
 *    :root { --md-primary-color: #005bea; }
 *    blockquote { border-left-color: var(--md-primary-color); }
 *    strong { color: var(--md-primary-color); }
 * 4. 保持语法高亮，仅调容器：
 *    code_pre { background: rgba(15, 23, 42, 0.04); border-radius: 8px; }
 *    code { background: rgba(15, 23, 42, 0.08); color: inherit; }
 *
 * 五、与 AI 协作必备信息
 * - 当前风格（default / grace / simple）。
 * - 当前主题色或说明是否自定义 --md-primary-color。
 * - 需要调整的元素与痛点（示例：引用上下间距过大）。
 * - 参考截图（建议手机端）。
 *
 * 主题色影响范围：标题、blockquote、strong、markup_highlight / underline / wavyline，以及 simple 主题中的 color-mix 边框。覆盖 --md-primary-color 即可同步这些区域。
 *
 * 选择器速查：
/* 顶层容器样式 */
container {
  background-color: #ffffff; /* 纯白背景，贴近公众号原生阅读底色 */
  max-width: 100%;
  padding: 0 10px;
}

/* 一级标题样式 */
h1 {
  padding: 0 1em;
  border-bottom: 2px solid #B0C4DE; /* 柔和的浅钢青色 */
  margin: 2em auto 1em;
  font-size: 1.5em;
  color: #333333;
}

/* 二级标题样式 */
h2 {
  background: transparent;
  margin: 3em auto 1.5em;
  padding: 0 0 0.45em;
  text-align: center;
  font-size: 1.3em;
  color: #6f5678;
  border-bottom: 1px solid #ddd3e2;
}

/* 三级标题样式 */
h3 {
  padding-left: 8px;
  border-left: 3px solid #ADD8E6; /* 轻微调整的浅蓝色 */
  margin-top: 2em;
  font-size: 1.1em;
  color: #333333;
}

/* 四级标题样式 */
h4 {
  font-size: 1em;
  color: #333333;
  margin-top: 1.5em;
  padding-left: 4px;
  border-left: 2px solid #C1E1C1; /* 柔和的淡绿色 */
}

/* 五级标题样式 */
h5 {
  font-size: 0.9em;
  color: #DDA0DD; /* 柔和的淡紫色 */
  margin-top: 1.2em;
  font-weight: bold;
}

/* 六级标题样式 */
h6 {
  font-size: 0.8em;
  color: #FFDAB9; /* 柔和的桃红色 */
  margin-top: 1em;
  font-style: italic;
}

/* 图片样式 */
image {
}

/* 引用样式 */
blockquote {
  margin: 0 0 1em;
  padding: 1em;
  border-left: 4px solid #C1E1C1; /* 柔和的淡绿色边框 */
  background: rgba(173, 216, 230, 0.1); /* 极轻的浅蓝色背景 */
  border-radius: 4px;
  font-size: 0.9em;
}

/* 引用样式 */
blockquote {
}

/* 引用段落样式 */
blockquote_p {
}

/* 段落样式 */
p {
}

/* 分割线样式 */
hr {
}

/* 行内代码样式 */
codespan {
}

/* 斜体样式 */
em {
}

/* 粗体样式 */
strong {
}

/* 链接样式 */
link {
}

/* 微信链接样式 */
wx_link {
}

/* 有序列表样式 */
ol {
}

/* 无序列表样式 */
ul {
}

/* 列表项样式 */
listitem {
}

/* 代码块样式 */
code {
}

/* 代码块外层样式 */
code_pre {
}

/* 行内公式样式 */
inline_katex {
}

/* 公式块样式 */
block_katex {
}

/* GFM note 样式 */
blockquote_note {
}

/* GFM tip 样式 */
blockquote_tip {
}

/* GFM info 样式 */
blockquote_info {
}

/* GFM important 样式 */
blockquote_important {
}

/* GFM warning 样式 */
blockquote_warning {
}

/* GFM caution 样式 */
blockquote_caution {
}

/* GFM 通用标题 */
blockquote_title {
}

/* GFM note 标题 */
blockquote_title_note {
}

/* GFM tip 标题 */
blockquote_title_tip {
}

/* GFM info 标题 */
blockquote_title_info {
}

/* GFM important 标题 */
blockquote_title_important {
}

/* GFM warning 标题 */
blockquote_title_warning {
}

/* GFM caution 标题 */
blockquote_title_caution {
}

/* GFM note 段落样式 */
blockquote_p_note {
}

/* GFM tip 段落样式 */
blockquote_p_tip {
}

/* GFM info 段落样式 */
blockquote_p_info {
}

/* GFM important 段落样式 */
blockquote_p_important {
}

/* GFM warning 段落样式 */
blockquote_p_warning {
}

/* GFM caution 段落样式 */
blockquote_p_caution {
}
`;
