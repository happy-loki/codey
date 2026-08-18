import { invoke } from '@tauri-apps/api/core';
import { derived, writable } from 'svelte/store';
import en from './locales/en';
import zhCN from './locales/zh-CN';

export type Lang = 'en' | 'zh-CN';

const LANG_KEY = 'uiLang'; // 独立于 cline 的宿主侧语言键

const dicts: Record<Lang, any> = {
  en,
  'zh-CN': zhCN,
};

export const lang = writable<Lang>('en');

async function syncMenuLanguageToNative(value: Lang) {
  try {
    await invoke('set_menu_language', { lang: value });
  } catch (error) {
    console.warn('[i18n] failed to sync native menu language', error);
  }
}

function getBrowserDefault(): Lang {
  const n = (navigator?.language || 'en').toLowerCase();
  return n.startsWith('zh') ? 'zh-CN' : 'en';
}

export function initLang(): Lang {
  const saved = (localStorage.getItem(LANG_KEY) as Lang | null);
  const value: Lang = saved === 'en' || saved === 'zh-CN' ? saved : getBrowserDefault();
  lang.set(value);
  updateHtmlLang(value);
  void syncMenuLanguageToNative(value);
  return value;
}

export function setLang(value: Lang) {
  lang.set(value);
  try {
    localStorage.setItem(LANG_KEY, value);
    // 为历史兼容：同步写入 appLang，供其他模块（如 ClinePanel）读取
    localStorage.setItem('appLang', value);
  } catch {}
  updateHtmlLang(value);
  void syncMenuLanguageToNative(value);
}

function updateHtmlLang(value: Lang) {
  try {
    document?.documentElement?.setAttribute('lang', value);
  } catch {}
}

function lookup(obj: any, path: string): string | undefined {
  return path.split('.').reduce<any>((acc, k) => (acc && acc[k] != null ? acc[k] : undefined), obj);
}

function format(str: string, params?: Record<string, string | number>): string {
  if (!params) return str;
  return Object.keys(params).reduce((s, k) => s.replace(new RegExp('\\{' + k + '\\}', 'g'), String(params[k])), str);
}

function translate(l: Lang, key: string, params?: Record<string, string | number>) {
  const fromDict = lookup(dicts[l], key) ?? lookup(dicts.en, key) ?? key;
  return typeof fromDict === 'string' ? format(fromDict, params) : key;
}

// t 是一个可订阅的“函数”，在模版中可写作 `$t('key')`
export const t = derived(lang, ($lang) => (key: string, params?: Record<string, string | number>) => translate($lang, key, params));
