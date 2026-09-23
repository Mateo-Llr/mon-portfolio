import * as THREE from "three";
import { loadSharedModel, onIdle, onVisible, onVisibilityChange, loadSharedTexture, loadSharedPixelData } from "./model-cache.js";

const SCREEN_WIDTH = 960;
const SCREEN_HEIGHT = 540;

function drawScreen(canvas, project, index, isEjected = false) {
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
  context.save();
  context.fillStyle = "#16221e";
  context.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);

  context.fillStyle = "#e8ad45";
  context.font = "500 22px 'DM Mono', monospace";
  context.letterSpacing = "2px";
  context.fillText(isEjected ? "NO TAPE / READY" : `PLAY / 0${index + 1}`, 74, 52);

  context.fillStyle = "#f5bc43";
  context.shadowColor = "rgba(242, 188, 67, .85)";
  context.shadowBlur = 8;
  context.font = "500 76px 'Space Grotesk', sans-serif";
  const title = isEjected ? ["SIGNAL", "PAUSE"] : project.title.replace("<br>", "\n").split("\n");
  title.forEach((line, lineIndex) => context.fillText(line, 74, 174 + lineIndex * 68));

  context.shadowBlur = 0;
  context.fillStyle = "#e8ad45";
  context.fillRect(74, 315, 64, 4);
  context.font = "500 19px 'DM Mono', monospace";
  context.fillText(isEjected ? "NO TAPE / READY" : project.meta.replaceAll("&nbsp;", " "), 74, 365);

  context.fillStyle = "#d9d6bd";
  context.font = "400 20px 'Space Grotesk', sans-serif";
  const description = isEjected ? "Insérez une cassette pour découvrir un projet." : project.description;
  const words = description.split(" ");
  let line = "";
  let lineIndex = 0;
  words.forEach((word) => {
    const candidate = `${line} ${word}`.trim();
    if (context.measureText(candidate).width > 760 && line) {
      context.fillText(line, 74, 414 + lineIndex * 23);
      line = word;
      lineIndex += 1;
    } else {
      line = candidate;
    }
  });
  context.fillText(line, 74, 414 + lineIndex * 23);

  // Apply the CRT character to the texture itself so it follows the curved model screen.
  context.globalCompositeOperation = "screen";
  context.globalAlpha = 0.16;
  context.fillStyle = "#b8c39d";
  const scanOffset = Math.floor(Date.now() / 90) % 6;
  for (let y = scanOffset; y < SCREEN_HEIGHT; y += 6) {
    context.fillRect(0, y, SCREEN_WIDTH, 2);
  }

  context.globalAlpha = 0.08;
  context.fillStyle = "#f0c768";
  context.fillRect(0, (Math.floor(Date.now() / 18) % (SCREEN_HEIGHT + 80)) - 40, SCREEN_WIDTH, 18);

  context.globalAlpha = 0.045;
  context.fillStyle = "#8ec8b2";
  for (let x = 0; x < SCREEN_WIDTH; x += 4) {
    context.fillRect(x, 0, 1, SCREEN_HEIGHT);
  }

  context.globalCompositeOperation = "source-over";
  context.globalAlpha = 1;
  const vignette = context.createRadialGradient(
    SCREEN_WIDTH / 2,
    SCREEN_HEIGHT / 2,
    SCREEN_WIDTH * 0.18,
    SCREEN_WIDTH / 2,
    SCREEN_HEIGHT / 2,
    SCREEN_WIDTH * 0.72
  );
  vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
  vignette.addColorStop(0.72, "rgba(0, 0, 0, 0.12)");
  vignette.addColorStop(1, "rgba(0, 0, 0, 0.58)");
  context.fillStyle = vignette;
  context.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);

  context.restore();
}

function mapScreenUvs(screenMesh) {
  const geometry = screenMesh.geometry;
  const position = geometry.attributes.position;
  const uv = new Float32Array(position.count * 2);
  const bounds = new THREE.Box3().setFromBufferAttribute(position);
  const size = new THREE.Vector3();
  bounds.getSize(size);

  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const y = position.getY(index);
    uv[index * 2] = (x - bounds.min.x) / size.x;
    uv[index * 2 + 1] = 1 - (y - bounds.min.y) / size.y;
  }

  geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
}

export function createTelevisionModel(container, projects) {
  const canvas = document.createElement("canvas");
  canvas.width = SCREEN_WIDTH;
  canvas.height = SCREEN_HEIGHT;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(27, 1, 0.1, 100);
  const cameraTarget = new THREE.Vector3(0, 0.55, 0);
  const cameraDirection = new THREE.Vector3(2.7, 1.9, -4.4).sub(cameraTarget).normalize();
  camera.position.copy(cameraDirection).multiplyScalar(5.25).add(cameraTarget);
  camera.lookAt(cameraTarget);

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  scene.add(new THREE.HemisphereLight(0xfff1d1, 0x24312d, 2.2));
  const keyLight = new THREE.DirectionalLight(0xffffff, 3);
  keyLight.position.set(2, 4, 4);
  scene.add(keyLight);

  const actionTexture = loadSharedTexture("assets/textures/television_actions.png", { colorSpace: THREE.NoColorSpace });
  let actionPixelData = null;
  loadSharedPixelData("assets/textures/television_actions.png").then((imageData) => {
    actionPixelData = imageData;
  });
  const actionUniforms = {
    actionMap: { value: actionTexture },
    hoverUv: { value: new THREE.Vector2() },
    hasHoveredAction: { value: 0 },
    dropZonePulse: { value: 0 },
    crtTime: { value: 0 }
  };
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const fullscreen = document.createElement("div");
  fullscreen.className = "tv-fullscreen";
  fullscreen.innerHTML = `<canvas class="tv-fullscreen-screen" aria-label="Vue agrandie de l'écran de télévision"></canvas><button class="tv-fullscreen-back" type="button">RETOUR</button>`;
  document.body.appendChild(fullscreen);
  const fullscreenCanvas = fullscreen.querySelector(".tv-fullscreen-screen");
  const fullscreenContext = fullscreenCanvas.getContext("2d");
  const fullscreenBackButton = fullscreen.querySelector(".tv-fullscreen-back");
  let television;
  let screenMaterial;
  let baseScreenMap;
  let baseScreenUvs;
  let dynamicScreenUvs;
  let cassetteInserted = false;
  let staticAnimationId = null;
  let staticTimeoutId = null;
  let screenTransitionToken = 0;
  let ejectHandler = null;
  let projectOpenHandler = null;
  let activeProjectIndex = 0;

  function syncFullscreenScreen() {
    if (!fullscreen.classList.contains("is-visible")) return;
    fullscreenCanvas.width = canvas.width;
    fullscreenCanvas.height = canvas.height;
    fullscreenContext.save();
    fullscreenContext.drawImage(canvas, 0, 0);
    fullscreenContext.restore();
  }

  function syncFullscreenBaseScreen() {
    if (!fullscreen.classList.contains("is-visible") || !baseScreenMap?.image || !baseScreenUvs) return;
    const uv = baseScreenUvs.array;
    let minX = 1;
    let maxX = 0;
    let minY = 1;
    let maxY = 0;
    for (let index = 0; index < uv.length; index += 2) {
      minX = Math.min(minX, uv[index]);
      maxX = Math.max(maxX, uv[index]);
      minY = Math.min(minY, uv[index + 1]);
      maxY = Math.max(maxY, uv[index + 1]);
    }
    fullscreenCanvas.width = canvas.width;
    fullscreenCanvas.height = canvas.height;
    fullscreenContext.clearRect(0, 0, fullscreenCanvas.width, fullscreenCanvas.height);
    fullscreenContext.drawImage(
      baseScreenMap.image,
      minX * baseScreenMap.image.width,
      (1 - maxY) * baseScreenMap.image.height,
      (maxX - minX) * baseScreenMap.image.width,
      (maxY - minY) * baseScreenMap.image.height,
      0,
      0,
      fullscreenCanvas.width,
      fullscreenCanvas.height
    );
  }

  function setFullscreen(isVisible) {
    fullscreen.classList.toggle("is-visible", isVisible);
    if (isVisible) {
      if (cassetteInserted) syncFullscreenScreen();
      else syncFullscreenBaseScreen();
    }
  }

  function isBlueAction(uv) {
    return isActionColor(uv, 0, 0, 255);
  }

  function isRedAction(uv) {
    return isActionColor(uv, 255, 0, 0);
  }

  function isActionColor(uv, red, green, blue) {
    if (!actionPixelData) return false;
    const centerX = Math.min(actionPixelData.width - 1, Math.max(0, Math.floor(uv.x * actionPixelData.width)));
    const centerY = Math.min(actionPixelData.height - 1, Math.max(0, Math.floor((1 - uv.y) * actionPixelData.height)));
    for (let y = centerY - 1; y <= centerY + 1; y += 1) {
      for (let x = centerX - 1; x <= centerX + 1; x += 1) {
        if (x < 0 || y < 0 || x >= actionPixelData.width || y >= actionPixelData.height) continue;
        const offset = (y * actionPixelData.width + x) * 4;
        if (Math.abs(actionPixelData.data[offset] - red) < 35 && Math.abs(actionPixelData.data[offset + 1] - green) < 35 && Math.abs(actionPixelData.data[offset + 2] - blue) < 35) return true;
      }
    }
    return false;
  }

  function fitCameraToTelevision() {
    if (!television) return;
    const bounds = new THREE.Box3().setFromObject(television);
    const sphere = bounds.getBoundingSphere(new THREE.Sphere());
    const verticalHalfFov = THREE.MathUtils.degToRad(camera.fov / 2);
    const horizontalHalfFov = Math.atan(Math.tan(verticalHalfFov) * camera.aspect);
    const narrowestHalfFov = Math.min(verticalHalfFov, horizontalHalfFov);
    // Exact distance at which the television's bounding sphere just touches
    // the frame edges. A small safety margin (<1) is applied on top so the
    // render fills the container as much as possible without ever clipping,
    // regardless of the container's aspect ratio or size.
    const fittedDistance = sphere.radius / Math.tan(narrowestHalfFov);
    const marginFactor = 0.92;
    const distance = fittedDistance * marginFactor;
    camera.position.copy(cameraDirection).multiplyScalar(distance).add(cameraTarget);
    camera.lookAt(cameraTarget);
  }

  function resize() {
    const width = container.clientWidth;
    const height = container.clientHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (television) {
      television.scale.setScalar(1.5 * Math.max(1, width / 520));
      fitCameraToTelevision();
    }
  }

  function addActionShader(material, useActionUv = false) {
    if (!material.map) return;
    material.onBeforeCompile = (shader) => {
      shader.uniforms.actionMap = actionUniforms.actionMap;
      shader.uniforms.hoverUv = actionUniforms.hoverUv;
      shader.uniforms.hasHoveredAction = actionUniforms.hasHoveredAction;
      shader.uniforms.dropZonePulse = actionUniforms.dropZonePulse;
      if (useActionUv) shader.uniforms.crtTime = actionUniforms.crtTime;
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <map_pars_fragment>",
        `#include <map_pars_fragment>
uniform sampler2D actionMap;
uniform vec2 hoverUv;
      uniform float hasHoveredAction;
  uniform float dropZonePulse;
    ${useActionUv ? "uniform float crtTime; varying vec2 vActionUv;" : ""}`
      );
      if (useActionUv) {
        shader.vertexShader = shader.vertexShader.replace(
          "#include <uv_pars_vertex>",
          `#include <uv_pars_vertex>
varying vec2 vActionUv;`
        );
        shader.vertexShader = shader.vertexShader.replace(
          "#include <uv_vertex>",
          `#include <uv_vertex>
vActionUv = uv1;`
        );
      }
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <map_fragment>",
        `#include <map_fragment>
      vec3 hoveredAction = texture2D(actionMap, hoverUv).rgb;
float hoveredMagenta = step(distance(hoveredAction, vec3(1.0, 0.0, 1.0)), 0.08);
float hoveredRed = step(distance(hoveredAction, vec3(1.0, 0.0, 0.0)), 0.08);
float hoveredBlue = step(distance(hoveredAction, vec3(0.0, 0.0, 1.0)), 0.08);
vec3 actionPixel = texture2D(actionMap, ${useActionUv ? "vActionUv" : "vMapUv"}).rgb;
float magentaMask = step(distance(actionPixel, vec3(1.0, 0.0, 1.0)), 0.08);
float redMask = step(distance(actionPixel, vec3(1.0, 0.0, 0.0)), 0.08);
float blueMask = step(distance(actionPixel, vec3(0.0, 0.0, 1.0)), 0.08);
float highlightMask = hasHoveredAction * (hoveredMagenta * magentaMask + hoveredRed * redMask + hoveredBlue * blueMask);
  diffuseColor.rgb *= 1.0 + highlightMask * 4.5 + magentaMask * dropZonePulse * 1.8;
  ${useActionUv ? `
float crtBand = step(0.48, fract(vMapUv.y * 150.0 + crtTime * 1.8));
float crtScanline = mix(0.58, 1.0, crtBand);
float crtVignette = smoothstep(0.88, 0.28, distance(vMapUv, vec2(0.5)));
float crtFlicker = 0.965 + 0.035 * sin(crtTime * 28.0) + 0.012 * sin(crtTime * 71.0);
float crtJitterBand = step(0.86, fract(sin(floor(vMapUv.y * 42.0) + floor(crtTime * 9.0)) * 43758.5453));
float crtJitter = (crtJitterBand - 0.5) * 0.018;
float crtEdge = smoothstep(0.0, 0.16, vMapUv.x) * smoothstep(1.0, 0.84, vMapUv.x);
diffuseColor.rgb *= crtScanline * crtFlicker * (0.72 + crtVignette * 0.28);
diffuseColor.rgb += vec3(crtJitter * crtEdge * 0.12);` : ""}`
      );
    };
    material.customProgramCacheKey = () => "television-action-zones-v1";
  }

  function clearHoveredAction() {
    actionUniforms.hasHoveredAction.value = 0;
  }

  function setDropZoneActive(isActive) {
    actionUniforms.dropZonePulse.value = isActive ? 0.2 : 0;
  }

  function updateHoveredAction(event) {
    if (!television) return;
    const bounds = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObject(television, true)[0];
    const actionUv = hit?.object === television.getObjectByName("screen") ? hit.uv1 : hit?.uv;
    if (!actionUv) {
      clearHoveredAction();
      return;
    }
    actionUniforms.hoverUv.value.copy(actionUv);
    actionUniforms.hasHoveredAction.value = 1;
  }

  function activateAction(event) {
    if (!television || fullscreen.classList.contains("is-visible")) return;
    const bounds = renderer.domElement.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) return;
    pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObject(television, true)[0];
    const actionUv = hit?.object === television.getObjectByName("screen") ? hit.uv1 : hit?.uv;
    const isScreenAction = hit?.object === television.getObjectByName("screen");
    if (actionUv && isRedAction(actionUv)) {
      if (cassetteInserted) ejectHandler?.();
      else playEjectedStatic();
      return;
    }
    if (isScreenAction && !cassetteInserted) {
      playEjectedStatic();
      return;
    }
    if (actionUv && isBlueAction(actionUv)) {
      if (cassetteInserted) projectOpenHandler?.(activeProjectIndex);
      else setFullscreen(true);
    }
  }

  function restoreBaseScreen() {
    const screenMesh = television?.getObjectByName("screen");
    if (!screenMesh || !screenMaterial || !baseScreenMap || !baseScreenUvs) return;
    screenMesh.geometry.setAttribute("uv", baseScreenUvs);
    screenMaterial.map = baseScreenMap;
    screenMaterial.emissiveMap = null;
    screenMaterial.emissiveIntensity = 0;
    screenMaterial.needsUpdate = true;
  }

  function showEjectedScreen() {
    cancelAnimationFrame(staticAnimationId);
    clearTimeout(staticTimeoutId);
    restoreBaseScreen();
    syncFullscreenBaseScreen();
  }

  // Generating fresh per-pixel random noise (960x540 => ~1.5M Math.random()
  // calls) on every animation frame is what caused the freeze in the middle
  // of a scene transition: the static effect ran for ~15 frames, each one
  // doing that full pixel pass plus a putImageData, all synchronously on the
  // main thread. Instead, a handful of noise frames are rendered ONCE (the
  // first time static is needed) and then simply blitted with drawImage,
  // which is orders of magnitude cheaper.
  const STATIC_FRAME_COUNT = 6;
  const STATIC_NOISE_WIDTH = 240;
  const STATIC_NOISE_HEIGHT = 135;
  let staticNoiseFrames = null;

  function buildStaticNoiseFrames() {
    if (staticNoiseFrames) return staticNoiseFrames;
    staticNoiseFrames = Array.from({ length: STATIC_FRAME_COUNT }, (_, frameIndex) => {
      const noiseCanvas = document.createElement("canvas");
      noiseCanvas.width = STATIC_NOISE_WIDTH;
      noiseCanvas.height = STATIC_NOISE_HEIGHT;
      const noiseContext = noiseCanvas.getContext("2d");
      noiseContext.fillStyle = frameIndex % 3 === 0 ? "#c3c7ae" : "#6b7667";
      noiseContext.fillRect(0, 0, STATIC_NOISE_WIDTH, STATIC_NOISE_HEIGHT);
      const image = noiseContext.createImageData(SCREEN_WIDTH, SCREEN_HEIGHT);
      const pixels = image.data;
      for (let index = 0; index < pixels.length; index += 4) {
        const value = Math.random() > 0.5 ? 235 : 20;
        const variation = Math.floor(Math.random() * 35);
        pixels[index] = Math.min(255, value + variation);
        pixels[index + 1] = Math.min(255, value + variation);
        pixels[index + 2] = Math.min(255, value + variation * 0.7);
        pixels[index + 3] = 255;
      }
      noiseContext.putImageData(image, 0, 0);
      return noiseCanvas;
    });
    return staticNoiseFrames;
  }

  function drawStaticFrame(context, frame) {
    const frames = buildStaticNoiseFrames();
    context.drawImage(frames[frame % frames.length], 0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
    context.fillStyle = "rgba(12, 20, 17, .22)";
    for (let y = frame % 8; y < SCREEN_HEIGHT; y += 8) context.fillRect(0, y, SCREEN_WIDTH, 2);
  }

  function playStaticTransition(projectIndex) {
    const transitionToken = ++screenTransitionToken;
    if (!screenMaterial || !dynamicScreenUvs) {
      drawScreen(canvas, projects[projectIndex], projectIndex);
      texture.needsUpdate = true;
      syncFullscreenScreen();
      return;
    }

    const context = canvas.getContext("2d");
    const startedAt = performance.now();
    const duration = 260;
    cancelAnimationFrame(staticAnimationId);
    clearTimeout(staticTimeoutId);

    function finishStaticTransition() {
      if (transitionToken !== screenTransitionToken) return;
      cancelAnimationFrame(staticAnimationId);
      drawScreen(canvas, projects[projectIndex], projectIndex);
      texture.needsUpdate = true;
      syncFullscreenScreen();
      staticAnimationId = null;
      staticTimeoutId = null;
    }

    function animateStatic(now) {
      if (transitionToken !== screenTransitionToken) return;
      const progress = Math.min(1, (now - startedAt) / duration);
      drawStaticFrame(context, Math.floor(now / 32));
      texture.needsUpdate = true;
      syncFullscreenScreen();
      if (progress < 1) {
        staticAnimationId = requestAnimationFrame(animateStatic);
        return;
      }
      finishStaticTransition();
    }

    staticAnimationId = requestAnimationFrame(animateStatic);
    staticTimeoutId = setTimeout(finishStaticTransition, duration + 100);
  }

  function playEjectedStatic() {
    const transitionToken = ++screenTransitionToken;
    const screenMesh = television?.getObjectByName("screen");
    if (!screenMesh || !screenMaterial || !dynamicScreenUvs) return;
    const context = canvas.getContext("2d");
    const startedAt = performance.now();
    const duration = 520;
    cancelAnimationFrame(staticAnimationId);
    clearTimeout(staticTimeoutId);
    screenMesh.geometry.setAttribute("uv", dynamicScreenUvs);
    screenMaterial.map = texture;
    screenMaterial.emissiveMap = texture;
    screenMaterial.emissiveIntensity = 0.75;
    screenMaterial.needsUpdate = true;

    function animateEjectedStatic(now) {
      if (transitionToken !== screenTransitionToken) return;
      if (now - startedAt < duration) {
        drawStaticFrame(context, Math.floor(now / 32));
        texture.needsUpdate = true;
        staticAnimationId = requestAnimationFrame(animateEjectedStatic);
        return;
      }
      showEjectedScreen();
    }

    staticAnimationId = requestAnimationFrame(animateEjectedStatic);
  }

  onVisible(container, () => onIdle(() => {
    buildStaticNoiseFrames();
    loadSharedModel("assets/models/television.mtl", "assets/models/television.obj").then((template) => {
      const model = template.clone();
      television = model;
      television.position.set(0, -0.3, 0);
      television.rotation.y = -0.12;

      television.traverse((part) => {
        if (!part.isMesh) return;
        if (part.name.toLowerCase() === "screen") {
          baseScreenMap = part.material.map;
          if (baseScreenMap) {
            baseScreenMap.magFilter = THREE.NearestFilter;
            baseScreenMap.minFilter = THREE.NearestFilter;
            baseScreenMap.anisotropy = 1;
            baseScreenMap.needsUpdate = true;
          }
          baseScreenUvs = part.geometry.attributes.uv.clone();
          part.geometry.setAttribute("uv1", baseScreenUvs.clone());
          mapScreenUvs(part);
          dynamicScreenUvs = part.geometry.attributes.uv.clone();
          screenMaterial = part.material.clone();
          screenMaterial.map = texture;
          screenMaterial.emissive = new THREE.Color(0x16221e);
          screenMaterial.emissiveMap = texture;
          screenMaterial.emissiveIntensity = 0.75;
          addActionShader(screenMaterial, true);
          part.material = screenMaterial;
          part.renderOrder = 2;
        } else {
          const material = part.material.clone();
          addActionShader(material);
          part.material = material;
        }
        if (part.material.map) {
          part.material.map.colorSpace = THREE.SRGBColorSpace;
          part.material.map.magFilter = THREE.NearestFilter;
          part.material.map.minFilter = THREE.NearestFilter;
          part.material.map.needsUpdate = true;
        }
      });
      // The screen material's onBeforeCompile shader (action-zone highlight
      // + CRT effect) doesn't actually get compiled by the GPU driver until
      // the FIRST time it's rendered - and that compile is a genuinely
      // synchronous stall, unrelated to asset loading or the camera. Adding
      // the model straight into the live render loop meant that first
      // compile landed on whatever frame happened to come next, which is
      // exactly the freeze reported the instant the TV appears. Keeping it
      // invisible until compileAsync's promise resolves moves that one-time
      // cost off the visible reveal frame, and compileAsync itself yields
      // to the browser between compile steps instead of blocking outright
      // (on renderers old enough to lack it, this just resolves immediately
      // and falls back to the previous behaviour).
      scene.add(television);
      resize();
      television.visible = true;
      if (renderer.compileAsync) {
        renderer.compileAsync(scene, camera).catch(() => {}).then(() => {
          renderer.render(scene, camera);
          if (!cassetteInserted) showEjectedScreen();
        });
      } else {
        renderer.compile(scene, camera);
        renderer.render(scene, camera);
        if (!cassetteInserted) showEjectedScreen();
      }
    }, (error) => console.error("Impossible de charger le modèle TV.", error));
  }, { timeout: 2500 }));

  // Redrawing the full screen canvas (text layout, gradients, vignette) on
  // every single animation frame was pure waste: nothing on it changes
  // except the scanline drift, which doesn't need 60 redraws per second to
  // read as "alive". Throttling to ~10 redraws/sec keeps the CRT look while
  // cutting this cost by roughly 6x.
  const SCREEN_REDRAW_INTERVAL_MS = 100;
  let lastScreenDrawAt = -Infinity;

  // Pausing this renderer's requestAnimationFrame loop while its container
  // is scrolled out of view removes an entire always-on WebGL render pass
  // (plus the per-frame drawScreen/texture upload) from the page's constant
  // background load - one less thing competing for frame budget everywhere
  // else on the page, including during the room camera's travelling shots.
  let isVisible = true;
  onVisibilityChange(container, (visible) => {
    const wasVisible = isVisible;
    isVisible = visible;
    if (visible && !wasVisible) requestAnimationFrame(render);
  });

  function render(time) {
    actionUniforms.crtTime.value = time * 0.001;
    if (cassetteInserted && !staticAnimationId && time - lastScreenDrawAt >= SCREEN_REDRAW_INTERVAL_MS) {
      drawScreen(canvas, projects[activeProjectIndex], activeProjectIndex);
      texture.needsUpdate = true;
      lastScreenDrawAt = time;
    }
    if (actionUniforms.dropZonePulse.value > 0) {
      actionUniforms.dropZonePulse.value = 0.2 + (Math.sin(time * 0.006) + 1) * 0.4;
    }
    renderer.render(scene, camera);
    if (isVisible) requestAnimationFrame(render);
  }

  function update(projectIndex, isEjected = false, animate = true) {
    if (isEjected) {
      cassetteInserted = false;
      playEjectedStatic();
      return;
    }

    cassetteInserted = true;
    activeProjectIndex = projectIndex;
    const screenMesh = television?.getObjectByName("screen");
    if (screenMesh && screenMaterial && dynamicScreenUvs) {
      screenMesh.geometry.setAttribute("uv", dynamicScreenUvs);
      screenMaterial.map = texture;
      screenMaterial.emissiveMap = texture;
      screenMaterial.emissiveIntensity = 0.75;
      screenMaterial.needsUpdate = true;
    }
    if (animate) {
      playStaticTransition(projectIndex);
      return;
    }

    screenTransitionToken += 1;
    cancelAnimationFrame(staticAnimationId);
    clearTimeout(staticTimeoutId);
    drawScreen(canvas, projects[projectIndex], projectIndex);
    texture.needsUpdate = true;
    syncFullscreenScreen();
  }

  update(0, true);
  resize();
  window.addEventListener("resize", resize);
  window.addEventListener("blur", clearHoveredAction);
  fullscreenBackButton.addEventListener("click", () => setFullscreen(false));
  render();

  return {
    update,
    triggerAction(action) {
      if (action === "red") {
        if (cassetteInserted) ejectHandler?.();
        else playEjectedStatic();
      }
      if (action === "blue") {
        if (cassetteInserted) projectOpenHandler?.(activeProjectIndex);
        else setFullscreen(true);
      }
    },
    setDropZoneActive,
    setEjectHandler(handler) {
      ejectHandler = handler;
    },
    setProjectOpenHandler(handler) {
      projectOpenHandler = handler;
    }
  };
}
