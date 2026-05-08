/// <reference types="vite/client" />

type TranslationTree = Record<string, any>

export type LocaleCode = string
export type LocaleDirection = 'ltr' | 'rtl'
export type Translations = TranslationTree

const FALLBACK_LOCALE = 'en'
const RTL_LOCALES = ['ar', 'he', 'fa', 'ur']
const USAGE_LANGUAGE_STORAGE_KEY = 'toddler-read-generator-usage-language'
const localeModules = import.meta.glob('./locales/*.json') as Record<
	string,
	() => Promise<{ default: TranslationTree }>
>
const localeCodes = Object.keys(localeModules)
	.map((path) => path.match(/\/([a-z]{2})\.json$/)?.[1])
	.filter((locale): locale is string => Boolean(locale))
	.sort((left, right) => left.localeCompare(right))

let currentLocale = $state<LocaleCode>('')
const translations = $state({}) as TranslationTree
let localeLoadToken = 0

export const T = translations
export const availableLocales = localeCodes

export function locale(): LocaleCode {
	return currentLocale
}

export function isLocaleCode(locale: string): locale is LocaleCode {
	return /^[a-z]{2}$/.test(locale)
}

export function hasLocale(locale: string): locale is LocaleCode {
	return isLocaleCode(locale) && localeCodes.includes(locale)
}

export function isRtlLocale(locale: string): boolean {
	return RTL_LOCALES.includes(normalizeLocaleCode(locale))
}

export function direction(): LocaleDirection {
	return isRtlLocale(currentLocale) ? 'rtl' : 'ltr'
}

export async function loadPreferredLocale(): Promise<LocaleCode> {
	const loadedLocale = await loadLocale(preferredLocale())
	storePreferredLocale(loadedLocale)
	return loadedLocale
}

export async function setPreferredLocale(locale: string): Promise<LocaleCode> {
	const loadedLocale = await loadLocale(locale)
	storePreferredLocale(loadedLocale)
	return loadedLocale
}

export async function loadLocale(locale: string): Promise<LocaleCode> {
	const token = ++localeLoadToken
	const normalizedLocale = normalizeLocaleCode(locale)
	if (!hasLocale(normalizedLocale)) return loadFallbackLocale(token)

	const loader = localeModules[`./locales/${normalizedLocale}.json`]
	if (!loader) return loadFallbackLocale(token)

	try {
		const loaded = await loader()
		if (token !== localeLoadToken) return currentLocale
		setTranslations(normalizedLocale, loaded.default)
		return normalizedLocale
	} catch {
		return loadFallbackLocale(token)
	}
}

export function format(template: string, values: Record<string, string | number>): string {
	return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key) => {
		const value = values[key]
		return value === undefined ? match : String(value)
	})
}

export function setTranslations(locale: string, nextTranslations: TranslationTree) {
	if (!isLocaleCode(locale)) throw new Error(`Invalid locale code: ${locale}`)

	currentLocale = locale
	replaceObject(translations, cloneTranslations(nextTranslations))
}

function cloneTranslations<T>(value: T): T {
	return structuredClone(value)
}

function normalizeLocaleCode(locale: string): string {
	const normalized = locale.trim().toLowerCase()
	return isLocaleCode(normalized) ? normalized : ''
}

function preferredLocale(): string {
	const stored = storedPreferredLocale()
	if (stored) return hasLocale(stored) ? stored : FALLBACK_LOCALE
	return browserPreferredLocale() || FALLBACK_LOCALE
}

function storedPreferredLocale(): string {
	if (typeof localStorage === 'undefined') return ''
	const stored = localStorage.getItem(USAGE_LANGUAGE_STORAGE_KEY) ?? ''
	const normalized = normalizeLocaleCode(stored)
	return isLocaleCode(normalized) ? normalized : ''
}

function storePreferredLocale(locale: string) {
	if (typeof localStorage === 'undefined') return
	localStorage.setItem(USAGE_LANGUAGE_STORAGE_KEY, hasLocale(locale) ? locale : FALLBACK_LOCALE)
}

function browserPreferredLocale(): string {
	if (typeof navigator === 'undefined') return ''

	return (
		[...(navigator.languages ?? []), navigator.language]
			.filter((language): language is string => typeof language === 'string')
			.map((language) => language.trim().toLowerCase().split('-')[0])
			.find((language) => hasLocale(language)) ?? ''
	)
}

async function loadFallbackLocale(token: number): Promise<LocaleCode> {
	const loader = localeModules[`./locales/${FALLBACK_LOCALE}.json`]
	if (!loader) throw new Error(`Missing fallback locale: ${FALLBACK_LOCALE}`)

	const loaded = await loader()
	if (token !== localeLoadToken) return currentLocale
	setTranslations(FALLBACK_LOCALE, loaded.default)
	return FALLBACK_LOCALE
}

function replaceObject(target: TranslationTree, source: TranslationTree) {
	for (const key of Object.keys(target)) {
		delete target[key]
	}
	for (const [key, value] of Object.entries(source)) {
		target[key] = value
	}
}
