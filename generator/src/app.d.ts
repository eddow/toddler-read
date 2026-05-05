declare module '*.svelte' {
  import type { ComponentType } from 'svelte';

  const component: ComponentType;
  export default component;
}

declare module '*.css';

interface ImportMetaEnv {
  readonly VITE_ANDROID_APK_URL?: string;
  readonly VITE_READER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
