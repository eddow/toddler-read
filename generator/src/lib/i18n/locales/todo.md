# Locale Translation Todo

This file tracks English locale changes that still need to be applied to non-English locale files.

## Pending Changes

### 2026-05-08 - Separate image search and generation

- Key path: `actions.generate`
- Action: added
- English text:
  `Generate`
- Context:
  Button label for opening/running image generation.
- Placeholders:
  `none`
- Target locales:
  all existing non-English locale files

- Key path: `actions.generating`
- Action: added
- English text:
  `Generating...`
- Context:
  Button label while an image generation request is running.
- Placeholders:
  `none`
- Target locales:
  all existing non-English locale files

- Key path: `aria.imageGenerationHints`
- Action: added
- English text:
  `Additional image generation hints`
- Context:
  Accessible label for the image generation hints field in the generate-image modal.
- Placeholders:
  `none`
- Target locales:
  all existing non-English locale files

- Key path: `labels.imageGenerationSources`
- Action: added
- English text:
  `Image generation sources`
- Context:
  Settings section heading for Leonardo.Ai and Pollinations.ai provider configuration.
- Placeholders:
  `none`
- Target locales:
  all existing non-English locale files

- Key path: `labels.imageSearch`
- Action: added
- English text:
  `Image search`
- Context:
  Modal eyebrow/grouping label for the image search flow.
- Placeholders:
  `none`
- Target locales:
  all existing non-English locale files

- Key path: `labels.imageSearchSources`
- Action: added
- English text:
  `Image search sources`
- Context:
  Settings section heading for Pexels and Flaticon provider configuration.
- Placeholders:
  `none`
- Target locales:
  all existing non-English locale files

- Key path: `providers.imageGenerationProviderKeys`
- Action: added
- English text:
  `Leonardo.Ai or Pollinations.ai`
- Context:
  Missing-key provider name list when no image generation API key is configured.
- Placeholders:
  `none`
- Target locales:
  all existing non-English locale files

- Key path: `providers.imageSearchProviderKeys`
- Action: added
- English text:
  `Pexels or Flaticon`
- Context:
  Missing-key provider name list when no image search API key is configured.
- Placeholders:
  `none`
- Target locales:
  all existing non-English locale files

- Key path: `placeholders.imageGenerationHints`
- Action: added
- English text:
  `extra style, mood, or composition hints`
- Context:
  Placeholder for optional additional hints used by image generation providers.
- Placeholders:
  `none`
- Target locales:
  all existing non-English locale files

- Key path: `modal.imageSearch.generateTitle`
- Action: added
- English text:
  `Generate image`
- Context:
  Title for the image generation modal.
- Placeholders:
  `none`
- Target locales:
  all existing non-English locale files

## Entry Template

```md
### YYYY-MM-DD - Short change title

- Key path: `section.key.path`
- Action: added | changed | removed
- English text:
  `Exact English text or a short JSON snippet`
- Context:
  Where the text appears and what the user is doing.
- Placeholders:
  `{{name}}`, `{{count}}`, or `none`
- Target locales:
  `fr`, then any other existing non-English locale files
```
