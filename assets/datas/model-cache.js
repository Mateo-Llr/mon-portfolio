import * as THREE from "three";
import { MTLLoader } from "three/addons/loaders/MTLLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";

const cache = new Map();
const textureCache = new Map();
const pixelDataCache = new Map();

// Loads (and parses) a given .mtl/.obj pair only once, no matter how many
// scenes ask for it. Every caller gets the same promise and should call
// .clone() on the resolved template before customizing materials/position -
// clone() only duplicates the Object3D/Mesh graph (cheap), it never
// re-parses the source file (expensive), so this removes duplicate parsing
// work entirely instead of just spreading it out over time.
export function loadSharedModel(mtlPath, objPath) {
  const key = `${mtlPath}|${objPath}`;
  if (!cache.has(key)) {
    cache.set(
      key,
      new Promise((resolve, reject) => {
        const materialLoader = new MTLLoader();
        materialLoader.load(
          mtlPath,
          (materials) => {
            materials.preload();
            const objectLoader = new OBJLoader();
            objectLoader.setMaterials(materials);
            objectLoader.load(objPath, resolve, undefined, reject);
          },
          undefined,
          reject
        );
      })
    );
  }
  return cache.get(key);
}

// Runs `callback` when the browser has a spare moment, falling back to a
// minimal timeout on browsers without requestIdleCallback. Used to keep
// heavy one-off work (model cloning/traversal) off the critical first-paint
// path.
export function onIdle(callback, options) {
  const schedule = window.requestIdleCallback;
  if (schedule) {
    schedule(callback, options);
    return;
  }
  window.setTimeout(() => callback({ timeRemaining: () => 0 }), 1);
}

// Runs `callback` only once `element` is actually visible (or about to
// become visible) in the viewport, instead of unconditionally at page load.
// Used to skip parsing/rendering models (television, cassettes) that aren't
// needed until the user actually scrolls/looks at them.
export function onVisible(element, callback, options = {}) {
  if (!element || typeof IntersectionObserver === "undefined") {
    callback();
    return;
  }
  const observer = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) {
      observer.disconnect();
      callback();
    }
  }, { rootMargin: "150px", ...options });
  observer.observe(element);
}

// Like onVisible, but keeps reporting: calls `callback(isVisible)` every
// time the element crosses the viewport boundary, instead of firing once
// and disconnecting. Used to pause/resume a render loop (television and
// cassette close-ups) so their WebGL renderer isn't drawing 60 frames a
// second in the background while the section is scrolled out of view -
// three simultaneous "always-on" renderers is a large chunk of the page's
// steady CPU/GPU cost, and it's cost paid even when nobody can see it.
export function onVisibilityChange(element, callback, options = {}) {
  if (!element || typeof IntersectionObserver === "undefined") {
    callback(true);
    return () => {};
  }
  const observer = new IntersectionObserver((entries) => {
    callback(entries.some((entry) => entry.isIntersecting));
  }, { rootMargin: "150px", ...options });
  observer.observe(element);
  return () => observer.disconnect();
}

// Loads a texture only once no matter how many scenes ask for the same
// path, mirroring loadSharedModel above. Before this, room.js and
// television.js each ran their own TextureLoader on
// "models/assets/television_actions.png", paying for the network fetch,
// image decode and a separate GPU upload twice for an identical texture.
export function loadSharedTexture(path, { colorSpace } = {}) {
  if (!textureCache.has(path)) {
    const texture = new THREE.TextureLoader().load(path);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    if (colorSpace) texture.colorSpace = colorSpace;
    textureCache.set(path, texture);
  }
  return textureCache.get(path);
}

// Companion to loadSharedTexture for the one case where a texture also
// needs its raw pixels read back on the CPU (television_actions.png is used
// as a hit-test map for the red/blue action zones on the screen). Reading
// it back and running getImageData twice, once per caller, is redundant
// work done at page load; this does it once and shares the result.
export function loadSharedPixelData(path) {
  if (!pixelDataCache.has(path)) {
    pixelDataCache.set(
      path,
      new Promise((resolve, reject) => {
        new THREE.TextureLoader().load(
          path,
          (texture) => {
            const canvas = document.createElement("canvas");
            canvas.width = texture.image.width;
            canvas.height = texture.image.height;
            const context = canvas.getContext("2d", { willReadFrequently: true });
            context.drawImage(texture.image, 0, 0);
            resolve(context.getImageData(0, 0, canvas.width, canvas.height));
          },
          undefined,
          reject
        );
      })
    );
  }
  return pixelDataCache.get(path);
}

export function clearSharedCache() {
  cache.clear();
  textureCache.clear();
  pixelDataCache.clear();
}
