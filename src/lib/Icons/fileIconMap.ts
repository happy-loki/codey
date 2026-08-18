// File type → icon resolution for the file tree.
// Ported from the provided Rust tables to TypeScript.

export type IconKey =
    | "astro"
    | "audio"
    | "bicep"
    | "bun"
    | "c"
    | "cairo"
    | "code"
    | "coffeescript"
    | "cpp"
    | "crystal"
    | "csharp"
    | "csproj"
    | "css"
    | "cue"
    | "dart"
    | "default"
    | "diff"
    | "docker"
    | "document"
    | "elixir"
    | "elm"
    | "erlang"
    | "eslint"
    | "font"
    | "fsharp"
    | "fsproj"
    | "gitlab"
    | "gleam"
    | "go"
    | "graphql"
    | "haskell"
    | "hcl"
    | "heroku"
    | "html"
    | "image"
    | "java"
    | "javascript"
    | "json"
    | "julia"
    | "kdl"
    | "kotlin"
    | "lock"
    | "log"
    | "lua"
    | "luau"
    | "markdown"
    | "notebook"
    | "metal"
    | "nim"
    | "nix"
    | "ocaml"
    | "php"
    | "prettier"
    | "prisma"
    | "puppet"
    | "python"
    | "r"
    | "react"
    | "roc"
    | "ruby"
    | "rust"
    | "sass"
    | "scala"
    | "settings"
    | "solidity"
    | "storage"
    | "stylelint"
    | "surrealql"
    | "svelte"
    | "swift"
    | "tcl"
    | "template"
    | "terminal"
    | "terraform"
    | "toml"
    | "typescript"
    | "v"
    | "vbproj"
    | "vcs"
    | "video"
    | "vs_sln"
    | "vs_suo"
    | "vue"
    | "vyper"
    | "wgsl"
    | "zig";

// Exact filename matches (aka stems in the Rust version)
const FILE_STEMS_BY_ICON_KEY: Record<IconKey, string[]> = {
    docker: ["Dockerfile"],
    ruby: ["Podfile"],
    heroku: ["Procfile"],
    // Keys with no stems
    astro: [],
    audio: [],
    bicep: [],
    bun: [],
    c: [],
    cairo: [],
    code: [],
    coffeescript: [],
    cpp: [],
    crystal: [],
    csharp: [],
    csproj: [],
    css: [],
    cue: [],
    dart: [],
    default: [],
    diff: [],
    document: [],
    elixir: [],
    elm: [],
    erlang: [],
    eslint: [],
    font: [],
    fsharp: [],
    fsproj: [],
    gitlab: ["gitlab-ci.yml"],
    gleam: [],
    go: [],
    graphql: [],
    haskell: [],
    hcl: [],
    html: [],
    image: [],
    java: [],
    javascript: [],
    json: [],
    julia: [],
    kdl: [],
    kotlin: [],
    lock: [],
    log: [],
    lua: [],
    luau: [],
    markdown: [],
    notebook: [],
    metal: [],
    nim: [],
    nix: [],
    ocaml: [],
    php: [],
    prettier: [],
    prisma: [],
    puppet: [],
    python: [],
    r: [],
    react: [],
    roc: [],
    rust: [],
    sass: [],
    scala: [],
    settings: [],
    solidity: [],
    storage: [],
    stylelint: [],
    surrealql: [],
    svelte: [],
    swift: [],
    tcl: [],
    template: [],
    terminal: [],
    terraform: [],
    toml: [],
    typescript: [],
    v: [],
    vbproj: [],
    vcs: [],
    video: [],
    vs_sln: [],
    vs_suo: [],
    vue: [],
    vyper: [],
    wgsl: [],
    zig: [],
};

// Extensions and special filenames.
const FILE_SUFFIXES_BY_ICON_KEY: Record<IconKey, string[]> = {
    astro: ["astro"],
    audio: ["aac", "flac", "m4a", "mka", "mp3", "ogg", "opus", "wav", "wma", "wv"],
    bicep: ["bicep"],
    bun: ["lockb"],
    c: ["c", "h"],
    cairo: ["cairo"],
    code: ["handlebars", "metadata", "rkt", "scm"],
    coffeescript: ["coffee"],
    cpp: ["c++", "cc", "cpp", "cxx", "hh", "hpp", "hxx", "inl", "ixx"],
    crystal: ["cr", "ecr"],
    csharp: ["cs"],
    csproj: ["csproj"],
    css: ["css", "pcss", "postcss"],
    cue: ["cue"],
    dart: ["dart"],
    diff: ["diff"],
    document: [
        "doc",
        "docx",
        "mdx",
        "odp",
        "ods",
        "odt",
        "pdf",
        "ppt",
        "pptx",
        "rtf",
        "txt",
        "xls",
        "xlsx",
    ],
    elixir: ["eex", "ex", "exs", "heex"],
    elm: ["elm"],
    erlang: [
        "Emakefile",
        "app.src",
        "erl",
        "escript",
        "hrl",
        "rebar.config",
        "xrl",
        "yrl",
    ],
    eslint: [
        "eslint.config.cjs",
        "eslint.config.cts",
        "eslint.config.js",
        "eslint.config.mjs",
        "eslint.config.mts",
        "eslint.config.ts",
        "eslintrc",
        "eslintrc.js",
        "eslintrc.json",
    ],
    font: ["otf", "ttf", "woff", "woff2"],
    fsharp: ["fs"],
    fsproj: ["fsproj"],
    gleam: ["gleam"],
    go: ["go", "mod", "work"],
    graphql: ["gql", "graphql", "graphqls"],
    haskell: ["hs"],
    hcl: ["hcl"],
    html: ["htm", "html"],
    image: [
        "avif",
        "bmp",
        "gif",
        "heic",
        "heif",
        "ico",
        "j2k",
        "jfif",
        "jp2",
        "jpeg",
        "jpg",
        "jxl",
        "png",
        "psd",
        "qoi",
        "svg",
        "tiff",
        "webp",
    ],
    java: ["java"],
    javascript: ["cjs", "js", "mjs"],
    json: ["json"],
    julia: ["jl"],
    kdl: ["kdl"],
    kotlin: ["kt"],
    lock: ["lock"],
    log: ["log"],
    lua: ["lua"],
    luau: ["luau"],
    markdown: ["markdown", "md"],
    notebook: ["ipynb"],
    metal: ["metal"],
    nim: ["nim"],
    nix: ["nix"],
    ocaml: ["ml", "mli"],
    php: ["php"],
    prettier: [
        "prettier.config.cjs",
        "prettier.config.js",
        "prettier.config.mjs",
        "prettierignore",
        "prettierrc",
        "prettierrc.cjs",
        "prettierrc.js",
        "prettierrc.json",
        "prettierrc.json5",
        "prettierrc.mjs",
        "prettierrc.toml",
        "prettierrc.yaml",
        "prettierrc.yml",
    ],
    prisma: ["prisma"],
    puppet: ["pp"],
    python: ["py"],
    r: ["r", "R"],
    react: ["cjsx", "ctsx", "jsx", "mjsx", "mtsx", "tsx"],
    roc: ["roc"],
    ruby: ["rb"],
    rust: ["rs"],
    sass: ["sass", "scss"],
    scala: ["scala", "sc"],
    settings: ["conf", "ini", "yaml", "yml"],
    solidity: ["sol"],
    storage: [
        "accdb",
        "csv",
        "dat",
        "db",
        "dbf",
        "dll",
        "fmp",
        "fp7",
        "frm",
        "gdb",
        "ib",
        "jsonc",
        "ldf",
        "mdb",
        "mdf",
        "myd",
        "myi",
        "pdb",
        "RData",
        "rdata",
        "sav",
        "sdf",
        "sql",
        "sqlite",
        "tsv",
    ],
    stylelint: [
        "stylelint.config.cjs",
        "stylelint.config.js",
        "stylelint.config.mjs",
        "stylelintignore",
        "stylelintrc",
        "stylelintrc.cjs",
        "stylelintrc.js",
        "stylelintrc.json",
        "stylelintrc.mjs",
        "stylelintrc.yaml",
        "stylelintrc.yml",
    ],
    surrealql: ["surql"],
    svelte: ["svelte"],
    swift: ["swift"],
    tcl: ["tcl"],
    template: ["hbs", "plist", "xml"],
    terminal: [
        "bash",
        "bash_aliases",
        "bash_login",
        "bash_logout",
        "bash_profile",
        "bashrc",
        "fish",
        "nu",
        "profile",
        "ps1",
        "sh",
        "zlogin",
        "zlogout",
        "zprofile",
        "zsh",
        "zsh_aliases",
        "zsh_histfile",
        "zsh_history",
        "zshenv",
        "zshrc",
    ],
    terraform: ["tf", "tfvars"],
    toml: ["toml"],
    typescript: ["cts", "mts", "ts"],
    v: ["v", "vsh", "vv"],
    vcs: [
        "COMMIT_EDITMSG",
        "EDIT_DESCRIPTION",
        "MERGE_MSG",
        "NOTES_EDITMSG",
        "TAG_EDITMSG",
        "gitattributes",
        "gitignore",
        "gitkeep",
        "gitmodules",
    ],
    vbproj: ["vbproj"],
    video: ["avi", "m4v", "mkv", "mov", "mp4", "webm", "wmv"],
    vs_sln: ["sln"],
    vs_suo: ["suo"],
    vue: ["vue"],
    vyper: ["vy", "vyi"],
    wgsl: ["wgsl"],
    zig: ["zig"],
    // Non-specified keys kept for completeness
    default: [],
    gitlab: ["gitlab-ci.yml"],
};

export type IconTheme = "dark" | "light";

type IconModuleSet = {
    modules: Record<string, string>;
    dirSuffix: string;
};

const ICON_FILE_OVERRIDES: Partial<Record<IconKey, string>> = {
    default: "_file",
    document: "pdf",
    terminal: "bash",
    template: "html",
};

const FALLBACK_ICON_BASENAMES = ["_file", "file"];

const iconModuleSets: Record<IconTheme, IconModuleSet> = {
    dark: {
        modules: import.meta.glob("./file_icons/*.svg", { eager: true, as: "url" }) as Record<string, string>,
        dirSuffix: "/file_icons/",
    },
    light: {
        modules: import.meta.glob("./file_icons_light/*.svg", { eager: true, as: "url" }) as Record<string, string>,
        dirSuffix: "/file_icons_light/",
    },
};

const iconCache: Record<IconTheme, Partial<Record<IconKey, string>>> = {
    dark: {},
    light: {},
};

function ensureSvgName(name: string): string {
    return name.endsWith(".svg") ? name : `${name}.svg`;
}

function findIcon(set: IconModuleSet, fileName: string): string | undefined {
    const suffix = `${set.dirSuffix}${fileName}`;
    return Object.entries(set.modules).find(([filepath]) => filepath.endsWith(suffix))?.[1];
}

function resolveForCandidates(theme: IconTheme, candidateNames: string[]): string | undefined {
    const primary = iconModuleSets[theme];
    const alternateTheme: IconTheme = theme === "dark" ? "light" : "dark";
    const alternate = iconModuleSets[alternateTheme];
    for (const name of candidateNames) {
        const fileName = ensureSvgName(name);
        const hit = findIcon(primary, fileName);
        if (hit) return hit;
    }
    for (const name of candidateNames) {
        const fileName = ensureSvgName(name);
        const hit = findIcon(alternate, fileName);
        if (hit) return hit;
    }
    return undefined;
}

function iconBaseNameForKey(key: IconKey): string {
    return ICON_FILE_OVERRIDES[key] ?? key;
}

function resolveIconUrl(key: IconKey, theme: IconTheme): string {
    const cacheHit = iconCache[theme][key];
    if (cacheHit !== undefined) return cacheHit;

    const candidates = [iconBaseNameForKey(key), ...FALLBACK_ICON_BASENAMES];
    const resolved = resolveForCandidates(theme, candidates) ?? "";
    iconCache[theme][key] = resolved;
    return resolved;
}

const ICON_URL_BY_THEME: Record<IconTheme, Record<IconKey, string>> = {
    dark: new Proxy({} as Record<IconKey, string>, {
        get(_target, prop: string) {
            return resolveIconUrl(prop as IconKey, "dark");
        },
    }),
    light: new Proxy({} as Record<IconKey, string>, {
        get(_target, prop: string) {
            return resolveIconUrl(prop as IconKey, "light");
        },
    }),
};

export function getThemedIconUrl(name: string, theme: IconTheme, fallbackNames: string[] = FALLBACK_ICON_BASENAMES): string {
    const uniqueCandidates = Array.from(new Set([name, ...fallbackNames]));
    return resolveForCandidates(theme, uniqueCandidates) ?? "";
}

function basename(path: string): string {
    const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
    return i >= 0 ? path.slice(i + 1) : path;
}

function extname(file: string): string | "" {
    const base = basename(file);
    const idx = base.lastIndexOf(".");
    return idx >= 0 ? base.slice(idx + 1) : "";
}

function matchesExact(name: string, candidates: string[]): boolean {
    const base = basename(name);
    return candidates.includes(base);
}

function matchesSuffix(name: string, candidates: string[]): boolean {
    const base = basename(name);
    const ext = extname(base);
    // Try exact filename matches first (to handle entries like "eslintrc", "gitignore", etc.)
    if (candidates.includes(base)) return true;
    if (!ext) return false;
    // Case-insensitive extension matches
    return candidates.some((s) => s.toLowerCase() === ext.toLowerCase());
}

export function getIconKeyForFile(filename: string): IconKey {
    // 1) stems (exact filename)
    for (const [key, stems] of Object.entries(FILE_STEMS_BY_ICON_KEY) as [IconKey, string[]][]) {
        if (stems.length && matchesExact(filename, stems)) return key;
    }
    // 2) suffixes (special filenames or extensions)
    for (const [key, suffixes] of Object.entries(FILE_SUFFIXES_BY_ICON_KEY) as [IconKey, string[]][]) {
        if (suffixes.length && matchesSuffix(filename, suffixes)) return key;
    }
    // 3) fallback
    return "default";
}

export function getIconUrlForFile(filename: string, theme: IconTheme = "dark"): string {
    // Keep the table-driven mapping intact, but provide richer icons for some
    // common formats (Office) when the SVG assets exist.
    const ext = extname(filename).toLowerCase();
    if (ext === "csv") {
        return getThemedIconUrl("csv", theme);
    }
    if (["xls", "xlsx", "xlsm", "xltx", "xltm"].includes(ext)) {
        return getThemedIconUrl("ms-excel", theme);
    }
    if (["ppt", "pptx", "pptm", "potx", "potm"].includes(ext)) {
        return getThemedIconUrl("ms-powerpoint", theme);
    }
    const key = getIconKeyForFile(filename);
    return ICON_URL_BY_THEME[theme]?.[key] ?? ICON_URL_BY_THEME.dark[key];
}
