import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import sveltePreprocess from "svelte-preprocess";
import { fileURLToPath, URL } from "node:url";

// https://vitejs.dev/config/
export default defineConfig({
  define: {
    __VUE_OPTIONS_API__: false,
    __VUE_PROD_DEVTOOLS__: false,
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
  },
  plugins: [svelte({
    // The application still instantiates a few components with Svelte 4's
    // `new Component({ target })` API (including the root entrypoint). Keep
    // that API compatible while the rest of the codebase adopts Svelte 5.
    compilerOptions: {
      compatibility: {
        componentApi: 4,
      },
    },
    preprocess: [
      sveltePreprocess({
        typescript: true,
        scss: {
          // 禁用 Sass 警告
          quietDeps: true,
          silenceDeprecations: ['legacy-js-api'],
        },
      }),
    ],
    onwarn: (warning, handler) => {
      // 禁用 A11y 警告
      if (warning.code.startsWith('a11y-')) return;
      // 禁用未使用的 CSS 选择器警告
      if (warning.code === 'css-unused-selector') return;
      // 其他警告正常处理
      handler(warning);
    },
  })],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  // prevent vite from obscuring rust errors
  clearScreen: false,
  // tauri expects a fixed port, fail if that port is not available
  server: {
    port: 8080,
    strictPort: true,
    // Bind explicitly to IPv4 loopback to avoid IPv6 localhost stalls
    host: "127.0.0.1",
    hmr: {
      host: "127.0.0.1",
      protocol: "ws",
    },
    watch: {
      // Prevent unrelated repo/submodule changes from triggering Vite reloads during `yarn dev` / `tauri dev`.
      ignored: [
        "**/external/**",
        "**/releases/**",
        "**/dist/**",
        "**/src-tauri/target/**",
        "**/.git/**",
      ],
    },
  },
  // 强制每次 dev 重新预构建依赖，避免 WebView 命中旧的 .vite 缓存导致动态 import 404
  optimizeDeps: {
    // Avoid forcing re-opt on every dev start; enable only if needed
    force: process.env.VITE_FORCE_OPT_DEPS === '1',
  },
  worker: {
    format: "es",
  },
  // 使用独立的缓存目录，避免与其它仓库/子模块冲突
  cacheDir: 'node_modules/.vite-codey',
  // to make use of `TAURI_DEBUG` and other env variables
  // https://tauri.studio/v1/api/config#buildconfig.beforedevcommand
  envPrefix: ["VITE_", "TAURI_"],
  css: {
    preprocessorOptions: {
      scss: {
        // 禁用 Dart Sass 的 legacy API 警告
        api: 'modern-compiler',
        silenceDeprecations: ['legacy-js-api'],
      },
    },
  },
  build: {
    // Tauri supports es2021
    target: ["es2021", "chrome100", "safari13"],
    // don't minify for debug builds
    minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
    // produce sourcemaps for debug builds
    sourcemap: !!process.env.TAURI_DEBUG
  },
  esbuild: {
    supported: {
      "top-level-await": true
    }
  },
  resolve: {
    alias: {
      "@md/shared": fileURLToPath(new URL("./src/lib/markdown/reference/shared", import.meta.url)),
      "roughjs/bin/rough": "roughjs/bin/rough.js",
    },
    dedupe: [
      "svelte",
    ]
  }
});
