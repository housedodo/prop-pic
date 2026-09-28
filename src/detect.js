// Lazy-loads an in-browser object detector (TensorFlow.js COCO-SSD) for bonus items.
// If it fails to load (offline, blocked CDN), bonus detection is skipped.

const SCRIPTS = [
  'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js',
  'https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js',
];

let modelPromise;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

function loadModel() {
  modelPromise ??= (async () => {
    for (const src of SCRIPTS) await loadScript(src);
    return window.cocoSsd.load();
  })().catch((err) => {
    console.warn('Object detection unavailable:', err);
    return null;
  });
  return modelPromise;
}

/** @returns {Promise<Array<{class:string, score:number, bbox:[number,number,number,number]}> | null>} */
export async function detectObjects(canvas) {
  const model = await loadModel();
  if (!model) return null;
  return model.detect(canvas, 20, 0.4);
}
