// Background Web Worker to prevent browser tab throttling of medication timers
let intervalId = null;

self.onmessage = function (e) {
  const { command, intervalMs } = e.data;
  if (command === 'START') {
    if (intervalId) clearInterval(intervalId);
    intervalId = setInterval(() => {
      self.postMessage({ type: 'TICK', timestamp: Date.now() });
    }, intervalMs || 1000);
  } else if (command === 'STOP') {
    if (intervalId) clearInterval(intervalId);
    intervalId = null;
  }
};
