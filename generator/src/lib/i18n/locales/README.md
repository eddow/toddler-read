# Locale Files

The generator UI is localized from JSON files in this directory. A usage language is supported when a matching lowercase two-letter file exists, such as `en.json` or `fr.json`.

## Source Of Truth

- `en.json` is the canonical source locale.
- Code changes that add, change, or remove user-visible UI text must update English only.
- Every English text change must also add an entry to `todo.md`.
- Non-English locale files are updated later by a dedicated translation pass from `todo.md`.
- Keep JSON shape and key names identical across locale files.
- Preserve `{{placeholders}}` exactly, including placeholder names.
- Keep product names, provider names, URLs, filenames, storage keys, language codes, CSS classes, and API identifiers literal unless a string is clearly user-facing prose.
- `translationPrompt` is intentionally not localized. It is AI request payload, not UI copy.

## Language Roadmap

Existing locale files:

- `en` - English
- `fr` - French
- `de` - German
- `es` - Spanish
- `it` - Italian
- `pt` - Portuguese
- `nl` - Dutch
- `sv` - Swedish
- `da` - Danish
- `no` - Norwegian
- `fi` - Finnish
- `pl` - Polish
- `cs` - Czech
- `ro` - Romanian
- `hu` - Hungarian
- `el` - Greek
- `bg` - Bulgarian
- `uk` - Ukrainian
- `ru` - Russian
- `tr` - Turkish
- `zh` - Chinese
- `ja` - Japanese
- `ko` - Korean
- `ar` - Arabic
- `hi` - Hindi
- `id` - Indonesian
- `vi` - Vietnamese
- `th` - Thai
- `et` - Estonian
- `lv` - Latvian
- `lt` - Lithuanian
- `sk` - Slovak
- `sl` - Slovenian
- `hr` - Croatian
- `sr` - Serbian
- `bs` - Bosnian
- `mk` - Macedonian
- `sq` - Albanian
- `ca` - Catalan
- `eu` - Basque
- `gl` - Galician
- `ga` - Irish
- `cy` - Welsh
- `is` - Icelandic
- `mt` - Maltese
- `be` - Belarusian
- `he` - Hebrew
- `fa` - Persian
- `ur` - Urdu
- `bn` - Bengali
- `pa` - Punjabi
- `gu` - Gujarati
- `mr` - Marathi
- `ta` - Tamil
- `te` - Telugu
- `kn` - Kannada
- `ml` - Malayalam
- `si` - Sinhala
- `ne` - Nepali
- `ms` - Malay
- `tl` - Tagalog
- `km` - Khmer
- `lo` - Lao
- `my` - Burmese
- `mn` - Mongolian
- `ka` - Georgian
- `hy` - Armenian
- `az` - Azerbaijani
- `kk` - Kazakh
- `ky` - Kyrgyz
- `uz` - Uzbek

## Locale Code Policy

Locale filenames must be exactly two lowercase letters plus `.json`. Regional or script variants such as `en-US`, `pt-BR`, or `zh-Hans` are not supported by the usage-language kernel.

When a two-letter code covers multiple common variants, use the broadest default for the first translation file and document that choice in the translation change if it matters.

Right-to-left support is wired into the usage-language kernel. When one of `ar`, `he`, `fa`, or `ur` exists as a locale file and is loaded as the usage language, the generator UI sets `dir="rtl"` for the document and app shell. A new RTL locale should still be smoke-tested for directionality, alignment, truncation, and modal/table layout before it is considered fully shipped.

Card corner labels describe physical printed corners. They are not reading-direction-relative, so the top-left card slot remains top-left even when the usage language is RTL.
