import '@picocss/pico/css/pico.min.css';
import './styles.css';
import { mount } from 'svelte';
import App from './App.svelte';

const app = mount(App, {
  target: document.getElementById('app') as HTMLElement
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((registration) => {
      const notifyWaitingWorker = () => {
        if (registration.waiting && navigator.serviceWorker.controller) {
          window.dispatchEvent(
            new CustomEvent('toddler-read-sw-update-available', {
              detail: { worker: registration.waiting }
            })
          );
        }
      };
      const checkForUpdate = () => {
        registration.update().catch(() => {});
      };

      notifyWaitingWorker();
      checkForUpdate();

      registration.addEventListener('updatefound', () => {
        const installingWorker = registration.installing;
        if (!installingWorker) return;

        installingWorker.addEventListener('statechange', () => {
          if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
            window.dispatchEvent(
              new CustomEvent('toddler-read-sw-update-available', {
                detail: { worker: installingWorker }
              })
            );
          }
        });
      });

      window.addEventListener('focus', checkForUpdate);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') checkForUpdate();
      });
    }).catch(() => {});
  });
}

export default app;
