// daylight.js — éclairage naturel "physique" pour la pièce 3D.
//
// Principe (inspiré de ce que fait Unreal Engine, en version légère) :
//   1. SOLEIL  : une seule DirectionalLight, placée dans la direction réelle du soleil
//                (ou de la lune la nuit). Sa shadow map ne laisse passer la lumière que par
//                les ouvertures des fenêtres -> les taches de lumière au sol/sur les murs et
//                les ombres des croisillons sont calculées, pas dessinées.
//   2. CIEL    : une RectAreaLight par fenêtre (équivalent des "sky portals" d'Unreal).
//                Lumière douce et diffuse, très forte près de la fenêtre, qui décroît vers le
//                fond de la pièce. Remplace l'éclairage uniforme du cubemap.
//   3. RAYONS  : un seul passage plein écran de "volumetric fog" raymarché. Pour chaque pixel
//                on avance le long du rayon caméra et on teste si chaque point est éclairé par
//                le soleil à travers une fenêtre (test analytique, sans texture).
//                Demi-résolution + bruit de jitter + flou => propre et peu coûteux.
//
// Rien n'est dessiné à la main : tout dérive de la position du soleil et de la géométrie des
// fenêtres (ROOM_WINDOWS).

import * as THREE from "three";

// ---------------------------------------------------------------------------
// Données partagées avec room.js
// ---------------------------------------------------------------------------

export const SUNRISE_HOUR = 6.5;
export const SUNSET_HOUR = 21.5;

// Ouvertures du mur nord (z = -6.2). Mêmes valeurs que les appels addWindow() de room.js.
export const ROOM_WINDOWS = [
  { x: -5.7, y: 5.1, width: 4.2, height: 3.5 },
  { x: 4.8, y: 4.25, width: 10, height: 8.4 }
];
export const WINDOW_PLANE_Z = -6.075; // face intérieure du mur
const FRAME_INSET = 0.06; // demi-épaisseur du cadre
const MULLION_HALF = 0.05; // demi-largeur du croisillon central

// Volume d'air de la pièce (faces intérieures des murs / plafond).
const ROOM_MIN = new THREE.Vector3(-11.375, 0, WINDOW_PLANE_Z);
const ROOM_MAX = new THREE.Vector3(11.375, 8.74, 9.375);
const ROOM_CENTER = new THREE.Vector3(0, 3.2, 1.6);

export function getDaylight(hour) {
  const t = (hour - SUNRISE_HOUR) / (SUNSET_HOUR - SUNRISE_HOUR);
  return THREE.MathUtils.clamp(Math.sin(t * Math.PI), 0, 1);
}

// Positions des astres (identiques à l'ancien code de addDynamicSky).
export function sunPositionAt(hour, target = new THREE.Vector3()) {
  const angle = ((hour - SUNRISE_HOUR) / (SUNSET_HOUR - SUNRISE_HOUR)) * Math.PI;
  return target.set(Math.cos(angle) * 22, Math.sin(angle) * 16 + 10, -18);
}

export function moonPositionAt(hour, target = new THREE.Vector3()) {
  const angle = ((hour - SUNRISE_HOUR) / (SUNSET_HOUR - SUNRISE_HOUR)) * Math.PI;
  return target.set(-Math.cos(angle) * 20, -Math.sin(angle) * 14 + 12, -20);
}

// ---------------------------------------------------------------------------
// RectAreaLight : chargement optionnel (fichiers three/addons/lights/*)
// ---------------------------------------------------------------------------

let RectAreaLightUniformsLib = null;
try {
  ({ RectAreaLightUniformsLib } = await import("three/addons/lights/RectAreaLightUniformsLib.js"));
} catch (error) {
  console.warn("[daylight] RectAreaLightUniformsLib introuvable : lumière de ciel par fenêtre désactivée (repli sur la lumière hémisphérique).", error);
}

// ---------------------------------------------------------------------------
// Shaders des rayons volumétriques
// ---------------------------------------------------------------------------

const FULLSCREEN_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const MARCH_FRAGMENT = /* glsl */ `
  #define STEPS ${24}
  precision highp float;

  uniform sampler2D tDepth;
  uniform mat4 uInvProj;
  uniform mat4 uCamWorld;
  uniform vec3 uBoxMin;
  uniform vec3 uBoxMax;
  uniform vec3 uToLight;     // direction normalisée vers le soleil
  uniform vec3 uLightColor;  // couleur * intensité relative
  uniform vec4 uWindows[2];  // cx, cy, demi-largeur utile, demi-hauteur utile
  uniform float uPlaneZ;
  uniform float uDensity;
  uniform float uAnisotropy;
  uniform float uDust;
  uniform float uTime;
  varying vec2 vUv;

  float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }

  float valueNoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float n000 = hash13(i);
    float n100 = hash13(i + vec3(1.0, 0.0, 0.0));
    float n010 = hash13(i + vec3(0.0, 1.0, 0.0));
    float n110 = hash13(i + vec3(1.0, 1.0, 0.0));
    float n001 = hash13(i + vec3(0.0, 0.0, 1.0));
    float n101 = hash13(i + vec3(1.0, 0.0, 1.0));
    float n011 = hash13(i + vec3(0.0, 1.0, 1.0));
    float n111 = hash13(i + vec3(1.0, 1.0, 1.0));
    return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
               mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
  }

  // Bruit "gradient interleaved" : motif stable, pas de scintillement.
  float interleavedGradientNoise(vec2 p) {
    return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
  }

  float henyeyGreenstein(float c, float g) {
    float g2 = g * g;
    return (1.0 - g2) / (12.566370614 * pow(max(1.0 + g2 - 2.0 * g * c, 1e-3), 1.5));
  }

  // 1 = le point est éclairé par le soleil à travers une fenêtre, 0 = dans l'ombre du mur.
  float sunVisibility(vec3 p) {
    float t = (uPlaneZ - p.z) / uToLight.z;
    if (t <= 0.0) return 0.0;
    vec2 q = p.xy + uToLight.xy * t;
    float soft = 0.02 + t * 0.014; // pénombre qui grandit avec la distance à la fenêtre
    float lit = 0.0;
    for (int i = 0; i < 2; i++) {
      vec4 w = uWindows[i];
      vec2 d = abs(q - w.xy);
      float outer = max(d.x - w.z, d.y - w.w);          // distance signée à l'ouverture
      float bars = min(d.x, d.y) - ${MULLION_HALF.toFixed(3)}; // distance signée au croisillon
      float open = (1.0 - smoothstep(-soft, soft, outer)) * smoothstep(-soft, soft, bars);
      lit = max(lit, open);
    }
    return lit;
  }

  void main() {
    vec2 ndc = vUv * 2.0 - 1.0;
    vec4 farPoint = uInvProj * vec4(ndc, 1.0, 1.0);
    vec3 viewDir = normalize(farPoint.xyz / farPoint.w);
    vec3 dir = normalize((uCamWorld * vec4(viewDir, 0.0)).xyz);
    vec3 origin = uCamWorld[3].xyz;

    // Distance caméra -> surface la plus proche (profondeur de la scène).
    float depth = texture2D(tDepth, vUv).x;
    vec4 sp = uInvProj * vec4(ndc, depth * 2.0 - 1.0, 1.0);
    float sceneDist = length(sp.xyz / sp.w);

    // Intersection rayon / volume de la pièce.
    vec3 safeDir = vec3(
      abs(dir.x) < 1e-5 ? 1e-5 : dir.x,
      abs(dir.y) < 1e-5 ? 1e-5 : dir.y,
      abs(dir.z) < 1e-5 ? 1e-5 : dir.z);
    vec3 inv = 1.0 / safeDir;
    vec3 t0 = (uBoxMin - origin) * inv;
    vec3 t1 = (uBoxMax - origin) * inv;
    vec3 tmin = min(t0, t1);
    vec3 tmax = max(t0, t1);
    float tStart = max(max(max(tmin.x, tmin.y), tmin.z), 0.0);
    float tEnd = min(min(min(tmax.x, tmax.y), tmax.z), sceneDist);

    if (tEnd <= tStart) {
      gl_FragColor = vec4(0.0);
      return;
    }

    float stepLen = (tEnd - tStart) / float(STEPS);
    float jitter = interleavedGradientNoise(gl_FragCoord.xy);
    float t = tStart + stepLen * jitter;
    float scatter = 0.0;

    for (int i = 0; i < STEPS; i++) {
      vec3 p = origin + dir * t;
      float vis = sunVisibility(p);
      if (vis > 0.001) {
        float dust = valueNoise(p * 0.7 + vec3(0.0, uTime * 0.04, uTime * 0.02));
        float density = uDensity * (1.0 + uDust * (dust * 2.0 - 1.0));
        scatter += vis * density * exp(-uDensity * 0.35 * (t - tStart));
      }
      t += stepLen;
    }

    float phase = henyeyGreenstein(dot(dir, uToLight), uAnisotropy);
    vec3 color = uLightColor * (scatter * stepLen * phase);
    color = 1.0 - exp(-color); // compression douce : jamais de saturation dure
    gl_FragColor = vec4(color, 0.0);
  }
`;

const COMPOSITE_FRAGMENT = /* glsl */ `
  precision highp float;
  uniform sampler2D tShafts;
  uniform vec2 uTexel;
  uniform float uStrength;
  varying vec2 vUv;

  void main() {
    // Flou 5 taps (le raymarch est en demi-résolution avec un jitter) + sur-échantillonnage bilinéaire.
    vec3 c = texture2D(tShafts, vUv).rgb * 0.4;
    c += texture2D(tShafts, vUv + uTexel * vec2( 1.0,  1.0)).rgb * 0.15;
    c += texture2D(tShafts, vUv + uTexel * vec2(-1.0,  1.0)).rgb * 0.15;
    c += texture2D(tShafts, vUv + uTexel * vec2( 1.0, -1.0)).rgb * 0.15;
    c += texture2D(tShafts, vUv + uTexel * vec2(-1.0, -1.0)).rgb * 0.15;
    c *= uStrength;
    // Linéaire -> sRGB (le canvas est déjà encodé : on mélange en "screen").
    gl_FragColor = vec4(pow(max(c, vec3(0.0)), vec3(1.0 / 2.2)), 0.0);
  }
`;

// ---------------------------------------------------------------------------
// Conversion éventuelle des matériaux Phong (MTLLoader) vers Standard
// ---------------------------------------------------------------------------

function upgradeMaterial(material, cache) {
  if (!material || !material.isMeshPhongMaterial) return material;
  // Matériaux personnalisés (shader patché, ex. écran CRT) : on n'y touche pas.
  if (Object.prototype.hasOwnProperty.call(material, "onBeforeCompile")) return material;
  if (cache.has(material)) return cache.get(material);
  const upgraded = new THREE.MeshStandardMaterial({
    name: material.name,
    color: material.color,
    map: material.map,
    alphaMap: material.alphaMap,
    alphaTest: material.alphaTest,
    transparent: material.transparent,
    opacity: material.opacity,
    side: material.side,
    depthWrite: material.depthWrite,
    vertexColors: material.vertexColors,
    emissive: material.emissive,
    emissiveMap: material.emissiveMap,
    emissiveIntensity: material.emissiveIntensity,
    roughness: 0.82,
    metalness: 0
  });
  upgraded.userData = { ...material.userData, upgradedFromPhong: true };
  cache.set(material, upgraded);
  return upgraded;
}

// ---------------------------------------------------------------------------
// API principale
// ---------------------------------------------------------------------------

export function createDaylight({ renderer, scene, camera, qualityProfile }) {
  const enabled = !qualityProfile.lowPower;

  const config = {
    // Soleil
    sunIntensity: 3.4,
    moonIntensity: 0.32,
    sunColorLow: new THREE.Color(0xff9a55),
    sunColorHigh: new THREE.Color(0xfff0d8),
    moonColor: new THREE.Color(0x8fb4ff),
    // Ciel (lumière douce par fenêtre)
    skyIntensityDay: 2.2,
    skyIntensityNight: 0.1,
    skyColorDay: new THREE.Color(0xcfe6ff),
    skyColorNight: new THREE.Color(0x4d6f9c),
    // Ambiance résiduelle (la lumière doit venir des fenêtres, pas de partout)
    hemiDay: 0.55,
    hemiNight: 0.35,
    envDay: 0.3,
    envNight: 0.12,
    // Plafonnier : discret en plein jour, principal la nuit
    lampDay: 5,
    lampNight: 26,
    // Rayons volumétriques
    shafts: true,
    shaftStrength: 1.0,
    shaftDensity: 0.05,
    shaftAnisotropy: 0.6,
    shaftDust: 0.45,
    shaftResolution: 0.5,
    // Matériaux
    upgradePhongMaterials: true
  };

  const state = { lastKey: null, usingSun: true, shaftsActive: false, lastIgnoreRefresh: -Infinity };
  const _bodyPosition = new THREE.Vector3();
  const _toLight = new THREE.Vector3();
  const _corner = new THREE.Vector3();
  const _color = new THREE.Color();

  // --- Soleil / lune -------------------------------------------------------
  const sun = new THREE.DirectionalLight(0xfff0d8, 0);
  sun.name = "sun-light";
  sun.castShadow = enabled;
  if (enabled) {
    sun.shadow.mapSize.set(qualityProfile.shadowMapSize, qualityProfile.shadowMapSize);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
  }
  sun.target.position.copy(ROOM_CENTER);
  scene.add(sun, sun.target);

  // --- Lumières de ciel (une par fenêtre) -----------------------------------
  const skyPortals = [];
  if (enabled && RectAreaLightUniformsLib) {
    RectAreaLightUniformsLib.init();
    ROOM_WINDOWS.forEach((window, index) => {
      const portal = new THREE.RectAreaLight(0xcfe6ff, 0, window.width - FRAME_INSET * 2, window.height - FRAME_INSET * 2);
      portal.name = `sky-portal-${index}`;
      portal.position.set(window.x, window.y, WINDOW_PLANE_Z + 0.02);
      portal.lookAt(window.x, window.y, WINDOW_PLANE_Z + 10);
      scene.add(portal);
      skyPortals.push(portal);
    });
  }
  const hasSkyPortals = skyPortals.length > 0;

  // --- Passes volumétriques --------------------------------------------------
  const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quadGeometry = new THREE.PlaneGeometry(2, 2);

  const depthMaterial = new THREE.MeshBasicMaterial({ colorWrite: false });
  const depthTarget = new THREE.WebGLRenderTarget(2, 2, {
    depthBuffer: true,
    depthTexture: new THREE.DepthTexture(2, 2),
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter
  });
  const shaftTarget = new THREE.WebGLRenderTarget(2, 2, {
    type: THREE.HalfFloatType,
    depthBuffer: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter
  });

  const marchUniforms = {
    tDepth: { value: depthTarget.depthTexture },
    uInvProj: { value: new THREE.Matrix4() },
    uCamWorld: { value: new THREE.Matrix4() },
    uBoxMin: { value: ROOM_MIN },
    uBoxMax: { value: ROOM_MAX },
    uToLight: { value: new THREE.Vector3(0, 0, -1) },
    uLightColor: { value: new THREE.Color(1, 1, 1) },
    uWindows: { value: ROOM_WINDOWS.map((w) => new THREE.Vector4(w.x, w.y, w.width / 2 - FRAME_INSET, w.height / 2 - FRAME_INSET)) },
    uPlaneZ: { value: WINDOW_PLANE_Z },
    uDensity: { value: config.shaftDensity },
    uAnisotropy: { value: config.shaftAnisotropy },
    uDust: { value: config.shaftDust },
    uTime: { value: 0 }
  };
  const marchMaterial = new THREE.ShaderMaterial({
    uniforms: marchUniforms,
    vertexShader: FULLSCREEN_VERTEX,
    fragmentShader: MARCH_FRAGMENT,
    depthTest: false,
    depthWrite: false
  });
  const marchScene = new THREE.Scene();
  marchScene.add(new THREE.Mesh(quadGeometry, marchMaterial));

  const compositeUniforms = {
    tShafts: { value: shaftTarget.texture },
    uTexel: { value: new THREE.Vector2(1, 1) },
    uStrength: { value: config.shaftStrength }
  };
  const compositeMaterial = new THREE.ShaderMaterial({
    uniforms: compositeUniforms,
    vertexShader: FULLSCREEN_VERTEX,
    fragmentShader: COMPOSITE_FRAGMENT,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.CustomBlending, // "screen" : src + dst * (1 - src)
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcColorFactor,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor
  });
  const compositeScene = new THREE.Scene();
  compositeScene.add(new THREE.Mesh(quadGeometry, compositeMaterial));
  [marchScene, compositeScene].forEach((s) => s.children.forEach((mesh) => { mesh.frustumCulled = false; }));

  // Objets à masquer pendant la passe de profondeur (vitres, zones de clic invisibles, astres...).
  let depthIgnore = [];
  function refreshDepthIgnoreList(now) {
    if (now - state.lastIgnoreRefresh < 1500) return;
    state.lastIgnoreRefresh = now;
    const list = [];
    const upgradeCache = new Map();
    scene.traverse((object) => {
      if (!object.isMesh) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      if (object.userData.depthIgnore || materials.some((m) => m && m.transparent && m.opacity < 0.5)) list.push(object);
      if (config.upgradePhongMaterials && materials.some((m) => m && m.isMeshPhongMaterial)) {
        const upgraded = materials.map((m) => upgradeMaterial(m, upgradeCache));
        object.material = Array.isArray(object.material) ? upgraded : upgraded[0];
      }
    });
    depthIgnore = list;
  }

  function resize() {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const width = Math.max(2, Math.round(size.x * config.shaftResolution));
    const height = Math.max(2, Math.round(size.y * config.shaftResolution));
    depthTarget.setSize(width, height);
    shaftTarget.setSize(width, height);
    compositeUniforms.uTexel.value.set(1 / width, 1 / height);
  }
  if (enabled) resize();

  // --- Ajustement du frustum d'ombre à la pièce -------------------------------
  function fitShadowFrustum() {
    const shadowCamera = sun.shadow.camera;
    shadowCamera.position.copy(sun.position);
    shadowCamera.lookAt(sun.target.position);
    shadowCamera.updateMatrixWorld(true);
    shadowCamera.matrixWorldInverse.copy(shadowCamera.matrixWorld).invert();

    const pad = 0.4; // inclut l'épaisseur des murs
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < 8; i += 1) {
      _corner.set(
        i & 1 ? ROOM_MAX.x + pad : ROOM_MIN.x - pad,
        i & 2 ? ROOM_MAX.y + pad : ROOM_MIN.y - pad,
        i & 4 ? ROOM_MAX.z + pad : ROOM_MIN.z - pad
      ).applyMatrix4(shadowCamera.matrixWorldInverse);
      minX = Math.min(minX, _corner.x); maxX = Math.max(maxX, _corner.x);
      minY = Math.min(minY, _corner.y); maxY = Math.max(maxY, _corner.y);
      minZ = Math.min(minZ, _corner.z); maxZ = Math.max(maxZ, _corner.z);
    }
    shadowCamera.left = minX;
    shadowCamera.right = maxX;
    shadowCamera.bottom = minY;
    shadowCamera.top = maxY;
    shadowCamera.near = Math.max(0.1, -maxZ - 0.5);
    shadowCamera.far = -minZ + 0.5;
    shadowCamera.updateProjectionMatrix();
  }

  // --- Mise à jour (appelée quand la minute change) --------------------------
  function update(hour) {
    if (!enabled) return;
    const key = Math.round(hour * 60);
    if (key === state.lastKey) return;
    state.lastKey = key;

    const d = getDaylight(hour);
    const useSun = d > 0.06;
    state.usingSun = useSun;
    (useSun ? sunPositionAt : moonPositionAt)(hour, _bodyPosition);
    _toLight.copy(_bodyPosition).sub(ROOM_CENTER).normalize();

    sun.position.copy(ROOM_CENTER).addScaledVector(_toLight, 40);
    if (useSun) {
      sun.intensity = config.sunIntensity * THREE.MathUtils.smoothstep(d, 0.06, 0.3);
      sun.color.lerpColors(config.sunColorLow, config.sunColorHigh, THREE.MathUtils.smoothstep(d, 0.06, 0.55));
    } else {
      sun.intensity = config.moonIntensity * (1 - THREE.MathUtils.smoothstep(d, 0, 0.06));
      sun.color.copy(config.moonColor);
    }
    sun.updateMatrixWorld(true);
    sun.target.updateMatrixWorld(true);
    fitShadowFrustum();
    renderer.shadowMap.needsUpdate = true;

    // Ciel
    const skyAmount = THREE.MathUtils.smoothstep(d, 0, 0.6);
    _color.lerpColors(config.skyColorNight, config.skyColorDay, skyAmount);
    const skyIntensity = THREE.MathUtils.lerp(config.skyIntensityNight, config.skyIntensityDay, skyAmount);
    skyPortals.forEach((portal) => {
      portal.color.copy(_color);
      portal.intensity = skyIntensity;
    });
    if ("environmentIntensity" in scene) {
      scene.environmentIntensity = hasSkyPortals ? THREE.MathUtils.lerp(config.envNight, config.envDay, skyAmount) : 1;
    }

    // Rayons : uniquement si la lumière entre réellement par les fenêtres (astre derrière le mur)
    const relative = sun.intensity / config.sunIntensity;
    state.shaftsActive = config.shafts && _toLight.z < -0.05 && relative > 0.01;
    marchUniforms.uToLight.value.copy(_toLight);
    marchUniforms.uLightColor.value.copy(sun.color).multiplyScalar(relative);
  }

  // --- Rendu des rayons (après le rendu principal) ----------------------------
  function renderShafts(nowMs = performance.now()) {
    if (!enabled) return;
    refreshDepthIgnoreList(nowMs); // aussi la nuit : conversion des matériaux + liste des objets ignorés
    if (!state.shaftsActive) return;

    marchUniforms.uInvProj.value.copy(camera.projectionMatrixInverse);
    marchUniforms.uCamWorld.value.copy(camera.matrixWorld);
    marchUniforms.uTime.value = nowMs * 0.001;
    marchUniforms.uDensity.value = config.shaftDensity;
    marchUniforms.uAnisotropy.value = config.shaftAnisotropy;
    marchUniforms.uDust.value = config.shaftDust;
    compositeUniforms.uStrength.value = config.shaftStrength;

    const previousTarget = renderer.getRenderTarget();
    const previousAutoClear = renderer.autoClear;
    const previousBackground = scene.background;
    const previousOverride = scene.overrideMaterial;
    const hidden = depthIgnore.map((object) => object.visible);
    depthIgnore.forEach((object) => { object.visible = false; });

    // 1) Profondeur de la scène en demi-résolution
    scene.background = null;
    scene.overrideMaterial = depthMaterial;
    renderer.setRenderTarget(depthTarget);
    renderer.autoClear = true;
    renderer.render(scene, camera);
    scene.overrideMaterial = previousOverride;
    scene.background = previousBackground;
    depthIgnore.forEach((object, index) => { object.visible = hidden[index]; });

    // 2) Raymarch de la lumière volumétrique
    renderer.setRenderTarget(shaftTarget);
    renderer.render(marchScene, quadCamera);

    // 3) Composition "screen" sur l'image finale
    renderer.setRenderTarget(previousTarget);
    renderer.autoClear = false;
    renderer.render(compositeScene, quadCamera);
    renderer.autoClear = previousAutoClear;
  }

  return {
    enabled,
    hasSkyPortals,
    config,
    sun,
    skyPortals,
    update,
    renderShafts,
    resize: () => { if (enabled) resize(); },
    // Force un recalcul au prochain update() (utile après changement de config en direct)
    invalidate: () => { state.lastKey = null; }
  };
}
