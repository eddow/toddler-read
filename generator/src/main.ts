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
      const getWorkerVersion = async (worker: ServiceWorker | null) => {
        if (!worker) return null;
        const messageChannel = new MessageChannel();
        let resolved = false;
        const versionPromise = new Promise<string | null>((resolve) => {
          messageChannel.port1.onmessage = (event: MessageEvent) => {
            if (!resolved) {
              resolved = true;
              resolve(event.data?.version || null);
            }
          };
          setTimeout(() => {
            if (!resolved) {
              resolved = true;
              resolve(null);
            }
          }, 2000);
        });
        worker.postMessage({ type: 'GET_VERSION' }, [messageChannel.port2]);
        return versionPromise;
      };

      const dispatchIfNewVersion = async (worker: ServiceWorker) => {
        const activeVersion = await getWorkerVersion(navigator.serviceWorker.controller);
        const waitingVersion = await getWorkerVersion(worker);

        if (!activeVersion || !waitingVersion) return;
        if (activeVersion === waitingVersion) {
          worker.postMessage({ type: 'SKIP_WAITING' });
          return;
        }

        window.dispatchEvent(
          new CustomEvent('toddler-read-sw-update-available', {
            detail: { worker }
          })
        );
      };

      const notifyWaitingWorker = () => {
        if (registration.waiting && navigator.serviceWorker.controller) {
          dispatchIfNewVersion(registration.waiting);
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
            dispatchIfNewVersion(installingWorker);
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
