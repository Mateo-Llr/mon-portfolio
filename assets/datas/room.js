import * as THREE from "three";
import { loadSharedModel, onIdle, onVisible, loadSharedTexture, loadSharedPixelData, clearSharedCache } from "./model-cache.js";

function material(color, roughness = 0.72, metalness = 0) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function box(width, height, depth, surface, position, rotation = [0, 0, 0]) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), surface);
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
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
  return geometry.attributes.uv;
}

function furnitureGroup(scene, id, label) {
  const group = new THREE.Group();
  group.name = id;
  group.userData.editorLabel = label;
  scene.add(group);
  return group;
}

function addDynamicSky(scene) {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 512;
  const context = canvas.getContext("2d");
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const dome = new THREE.Mesh(new THREE.SphereGeometry(48, 32, 16), new THREE.MeshBasicMaterial({ map: texture, side: THREE.BackSide, depthWrite: false }));
  dome.name = "dynamic-sky";
  scene.add(dome);
  const sun = new THREE.Mesh(new THREE.SphereGeometry(0.7, 16, 8), new THREE.MeshBasicMaterial({ color: 0xffd47a }));
  const moon = new THREE.Mesh(new THREE.SphereGeometry(0.45, 16, 8), new THREE.MeshBasicMaterial({ color: 0xd9e7ff }));
  scene.add(sun, moon);

  function updateSky() {
    const date = new Date();
    const hour = date.getHours() + date.getMinutes() / 60;
    const sunrise = 6.5;
    const sunset = 20.5;
    const daylight = THREE.MathUtils.clamp(Math.sin(((hour - sunrise) / (sunset - sunrise)) * Math.PI), 0, 1);
    const topColor = new THREE.Color().lerpColors(new THREE.Color(0x071225), new THREE.Color(0x4cafd0), daylight);
    const horizonColor = new THREE.Color().lerpColors(new THREE.Color(0x321d38), new THREE.Color(0xf3bd73), daylight);
    const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, `#${topColor.getHexString()}`);
    gradient.addColorStop(1, `#${horizonColor.getHexString()}`);
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.globalAlpha = (1 - daylight) * 0.42;
    context.fillStyle = "#ffffff";
    for (let index = 0; index < 70; index += 1) {
      const x = (index * 137) % canvas.width;
      const y = (index * 73) % (canvas.height * 0.62);
      context.fillRect(x, y, 2, 2);
    }
    context.globalAlpha = 1;
    texture.needsUpdate = true;
    const angle = ((hour - sunrise) / (sunset - sunrise)) * Math.PI;
    sun.position.set(Math.cos(angle) * 22, Math.sin(angle) * 16 + 10, -18);
    moon.position.set(-Math.cos(angle) * 20, -Math.sin(angle) * 14 + 12, -20);
    sun.visible = daylight > 0.08;
    moon.visible = daylight < 0.72;
  }

  updateSky();
  window.setInterval(updateSky, 60000);
}

function centerFurniturePivot(group, pivot = null) {
  const bounds = new THREE.Box3().setFromObject(group);
  const center = pivot || bounds.getCenter(new THREE.Vector3());
  group.position.copy(center);
  group.children.forEach((child) => child.position.sub(center));
  return group;
}

function fitModelToHeight(model, targetHeight) {
  if (!model) return model;
  const bounds = new THREE.Box3().setFromObject(model);
  const size = new THREE.Vector3();
  bounds.getSize(size);
  const currentHeight = Math.max(size.y || 1, 0.001);
  model.scale.setScalar(targetHeight / currentHeight);
  return model;
}

function addWindow(scene, x, width, height, y = 5.25, z = -6.055, hasSill = true) {
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x8fcbd3, transparent: true, opacity: 0.2, roughness: 0.08, metalness: 0, transmission: 0.55, depthWrite: false });
  const frame = material(0x272f2c, 0.5);
  scene.add(box(width, height, 0.1, glass, [x, y, z]));
  scene.add(box(0.12, height + 0.24, 0.16, frame, [x - width / 2, y, z + 0.11]));
  scene.add(box(0.12, height + 0.24, 0.16, frame, [x + width / 2, y, z + 0.11]));
  scene.add(box(width + 0.24, 0.12, 0.16, frame, [x, y - height / 2, z + 0.11]));
  scene.add(box(width + 0.24, 0.12, 0.16, frame, [x, y + height / 2, z + 0.11]));
  scene.add(box(0.1, height, 0.17, frame, [x, y, z + 0.15]));
  scene.add(box(width, 0.1, 0.17, frame, [x, y, z + 0.15]));
  if (hasSill) scene.add(box(width + 0.7, 0.16, 0.45, frame, [x, y - height / 2 - 0.22, z + 0.3]));
}

function addShelf(scene, shelves, x, y, z) {
  const group = furnitureGroup(scene, "shelf", "Étagère");
  group.position.set(x, y, z);

  loadSharedModel("assets/models/furniture/shelf.mtl", "assets/models/furniture/shelf.obj").then((template) => {
    const model = template.clone();
    model.name = "shelf-model";
    fitModelToHeight(model, 5.1);
    model.rotation.y = Math.PI / 2;
    model.position.set(0, 0.15, 0);
    model.traverse((part) => {
      if (!part.isMesh) return;
      part.castShadow = true;
      part.receiveShadow = true;
      const materials = Array.isArray(part.material) ? part.material : [part.material];
      materials.forEach((materialItem) => {
        if (!materialItem.map) return;
        materialItem.map.magFilter = THREE.NearestFilter;
        materialItem.map.minFilter = THREE.NearestFilter;
        materialItem.map.anisotropy = 1;
        materialItem.map.needsUpdate = true;
      });
    });
    group.add(model);
  }, (error) => console.error("Impossible de charger le modèle d'étagère.", error));

  return group;
}

export function createRoomScene(container, projects = []) {
  const POSITION_STORAGE_KEY = "mateo-portfolio-room-positions";
  const CAMERA_STORAGE_KEY = "mateo-portfolio-camera-positions";
  const ROOM_LAYOUT_VERSION = 2;
  let configuredPositions = {};
  let configuredCameraPositions = [];
  let presentationCameraPose = null;
  const scene = new THREE.Scene();
  const CAMERA_FOV = 45;
  const camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 100);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  function markShadowsDirty() {
    renderer.shadowMap.needsUpdate = true;
  }

  function refreshEditorObjectOptions() {
    const select = document.querySelector("#editor-object");
    if (!select) return;
    const currentValue = select.value;
    const options = getEditorObjects().map(({ id, label }) => `<option value="${id}">${label}</option>`).join("");
    select.innerHTML = options;
    if (currentValue && [...select.options].some((option) => option.value === currentValue)) {
      select.value = currentValue;
    } else if (select.options.length) {
      select.value = select.options[0].value;
    }
    if (editor.selected) {
      editor.selected = getEditorObjects().find((entry) => entry.id === editor.selected.id) || null;
      if (editor.selected) syncEditorFields();
    }
  }

  function attachTrophy(shelfGroup, { id, label, modelPath, objPath, scale = 0.62, position = [0.18, 1.62, -0.08], rotationY = -0.9 }) {
    if (!shelfGroup) return;
    loadSharedModel(modelPath, objPath).then((template) => {
      const trophy = template.clone();
      trophy.name = id;
      trophy.scale.setScalar(scale);
      trophy.rotation.y = rotationY;
      trophy.position.set(...position);
      trophy.traverse((part) => {
        if (!part.isMesh) return;
        part.castShadow = true;
        part.receiveShadow = true;
        const materials = Array.isArray(part.material) ? part.material : [part.material];
        materials.forEach((material) => {
          if (!material.map) return;
          material.map.magFilter = THREE.NearestFilter;
          material.map.minFilter = THREE.NearestFilter;
          material.map.anisotropy = 1;
          material.map.needsUpdate = true;
        });
      });
      shelfGroup.add(trophy);
      applyConfiguredPosition(id, trophy);
      refreshEditorObjectOptions();
    }, (error) => console.error(`Impossible de charger le trophée ${label} sur l'étagère.`, error));
  }

  function attachScratchTrophy(shelfGroup) {
    attachTrophy(shelfGroup, {
      id: "scratch-trophy",
      label: "Scratch",
      modelPath: "assets/models/trophies/trophy_scratch.mtl",
      objPath: "assets/models/trophies/trophy_scratch.obj",
      scale: 0.62,
      position: [0.18, 1.62, -0.08],
      rotationY: -0.9
    });
  }

  function attachPythonTrophy(shelfGroup) {
    attachTrophy(shelfGroup, {
      id: "python-trophy",
      label: "Python",
      modelPath: "assets/models/trophies/trophy_python.mtl",
      objPath: "assets/models/trophies/trophy_python.obj",
      scale: 0.62,
      position: [-0.68, 1.62, -0.08],
      rotationY: 0.8
    });
  }

  function attachCSharpTrophy(shelfGroup) {
    attachTrophy(shelfGroup, {
      id: "csharp-trophy",
      label: "C#",
      modelPath: "assets/models/trophies/trophy_csharp.mtl",
      objPath: "assets/models/trophies/trophy_csharp.obj",
      scale: 0.62,
      position: [-1.52, 1.62, -0.08],
      rotationY: -0.4
    });
  }

  function attachHTMLTrophy(shelfGroup) {
    attachTrophy(shelfGroup, {
      id: "html-trophy",
      label: "HTML",
      modelPath: "assets/models/trophies/trophy_html.mtl",
      objPath: "assets/models/trophies/trophy_html.obj",
      scale: 0.62,
      position: [-2.46, 1.62, -0.08],
      rotationY: -0.6
    });
  }

  function attachGodotTrophy(shelfGroup) {
    attachTrophy(shelfGroup, {
      id: "godot-trophy",
      label: "Godot",
      modelPath: "assets/models/godot.mtl",
      objPath: "assets/models/godot.obj",
      scale: 0.62,
      position: [-3.28, 1.62, -0.08],
      rotationY: 0.2
    });
  }

  function attachCSSTrophy(shelfGroup) {
    attachTrophy(shelfGroup, {
      id: "css-trophy",
      label: "CSS",
      modelPath: "assets/models/trophies/trophy_css.mtl",
      objPath: "assets/models/trophies/trophy_css.obj",
      scale: 0.62,
      position: [-4.08, 1.62, -0.08],
      rotationY: 0.4
    });
  }

  function prepareRoomModel(model) {
    const cullingStates = [];
    model.traverse((part) => {
      if (!part.isMesh) return;
      cullingStates.push([part, part.frustumCulled]);
      part.frustumCulled = false;
    });
    model.visible = true;
    const compile = renderer.compileAsync
      ? renderer.compileAsync(scene, camera)
      : Promise.resolve().then(() => renderer.compile(scene, camera));
    return compile.catch(() => {}).then(() => {
      cullingStates.forEach(([part, frustumCulled]) => {
        part.frustumCulled = frustumCulled;
      });
    });
  }
  container.appendChild(renderer.domElement);

  const floorTexture = loadSharedTexture("assets/textures/floor_wood.png");
  floorTexture.wrapS = THREE.RepeatWrapping;
  floorTexture.wrapT = THREE.RepeatWrapping;
  floorTexture.repeat.set(2.6, 2.2);
  const floor = new THREE.MeshStandardMaterial({ map: floorTexture, roughness: 0.9, metalness: 0 });
  const kitchenFloorTexture = loadSharedTexture("assets/textures/floor_kitchen.png");
  kitchenFloorTexture.wrapS = THREE.RepeatWrapping;
  kitchenFloorTexture.wrapT = THREE.RepeatWrapping;
  kitchenFloorTexture.repeat.set(2.2, 2.2);
  const wall = material(0x798174, 0.95);
  const trim = material(0x303b36, 0.78);
  const darkWood = material(0x44382d, 0.88);
  const tabletop = material(0x9a7954, 0.82);
  const upholstery = material(0x68736b, 0.98);
  const rug = material(0x3e514b, 1);
  const kitchenFloor = new THREE.MeshStandardMaterial({ map: kitchenFloorTexture, roughness: 0.9, metalness: 0 });
  const diningFloor = material(0x48a9bb, 0.95);
  const livingFloor = material(0x39765e, 0.95);
  const presentationCamera = {
    position: { x: -4.709, y: 2.924, z: 1.412 },
    rotation: { x: 0.078, y: 0.181 }
  };

  addDynamicSky(scene);
  scene.add(createWorldTitleLabel());

  scene.add(box(23, 0.25, 17, floor, [0, -0.15, 1.5]));
  scene.add(box(9.8, 0.18, 5.5, kitchenFloor, [-7.2, -0.06, 7.5]));
  scene.add(box(3.7, 9, 0.25, wall, [-9.65, 4.35, -6.2]));
  scene.add(box(3.4, 9, 0.25, wall, [-1.9, 4.35, -6.2]));
  scene.add(box(1.7, 9, 0.25, wall, [10.65, 4.35, -6.2]));
  scene.add(box(4.2, 3.35, 0.25, wall, [-5.7, 1.675, -6.2]));
  scene.add(box(4.2, 2.15, 0.25, wall, [-5.7, 7.925, -6.2]));
  scene.add(box(10, 0.55, 0.25, wall, [4.8, 8.725, -6.2]));
  scene.add(box(23, 0.18, 0.4, trim, [0, 0.03, -5.98]));
  scene.add(box(23, 0.14, 0.3, trim, [0, 8.6, -5.92]));
  const ceilingLight = new THREE.PointLight(0xffd6a0, 13, 17, 1.6);
  ceilingLight.position.set(0, 8.05, 0.4);
  ceilingLight.castShadow = true;
  ceilingLight.shadow.mapSize.set(2048, 2048);
  ceilingLight.shadow.camera.near = 0.3;
  ceilingLight.shadow.camera.far = 17;
  ceilingLight.shadow.bias = -0.00008;
  ceilingLight.shadow.radius = 24;
  scene.add(ceilingLight);

  addWindow(scene, -5.7, 4.2, 3.5, 5.1, -6.055, true);
  addDiningTable(scene, tabletop, darkWood);

  requestAnimationFrame(() => onIdle(() => {
    scene.add(box(0.25, 9, 17, wall, [-11.5, 4.35, 1.5]));
    scene.add(box(0.25, 9, 5, wall, [-2.5, 4.35, 7.2]));
    scene.add(box(0.25, 9, 12.8, wall, [11.5, 4.35, -0.2]));
    scene.add(box(14, 9, 0.25, wall, [4.5, 4.35, 4.8]));
    scene.add(box(9, 9, 0.25, wall, [-7, 4.35, 9.5]));
    scene.add(box(23, 0.15, 0.25, trim, [0, 0.08, 8.9]));
    const ceiling = material(0x29322f, 0.96);
    scene.add(box(23, 0.22, 17, ceiling, [0, 8.85, 1.5]));
    scene.add(box(4.2, 0.08, 2.2, material(0x171e1c, 0.9), [-1.5, 8.71, 0.2]));
    const ceilingFixture = new THREE.Group();
    ceilingFixture.name = "ceiling-light";
    const ceilingMount = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.12, 8), material(0x272b28, 0.5));
    ceilingMount.position.set(0, 8.65, 0.4);
    const ceilingShade = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.42, 0.28, 8), new THREE.MeshStandardMaterial({ color: 0xcaa867, emissive: 0x8c6a32, emissiveIntensity: 0.65, roughness: 0.45 }));
    ceilingShade.position.set(0, 8.35, 0.4);
    ceilingShade.castShadow = true;
    ceilingFixture.add(ceilingMount, ceilingShade);
    scene.add(ceilingFixture);
    addWindow(scene, 4.8, 10, 8.4, 4.25, -6.055, false);
    addKitchen(scene, material(0xd28a2d, 0.78), darkWood);
    addSofaL(scene, upholstery, darkWood);
    addShelf(scene, [[0xc05262, 0, 0.25], [0x9b4e39, 1, 0], [0xd29b48, 2, 0.1], [0x6f8f6d, 3, 0]], 9.8, 2.6, 5.2);
    const shelf = scene.getObjectByName("shelf");
    attachScratchTrophy(shelf);
    attachPythonTrophy(shelf);
    attachCSharpTrophy(shelf);
    attachHTMLTrophy(shelf);
    attachGodotTrophy(shelf);
    attachCSSTrophy(shelf);
    const tvStand = furnitureGroup(scene, "tv-stand", "Meuble TV");
    tvStand.add(box(5.8, 0.32, 0.9, darkWood, [6.0, 0.62, -5.15]));
    tvStand.add(box(5.6, 0.12, 0.95, tabletop, [6.0, 0.82, -5.15]));
    const tvStandLabel = createPropLabel("MES RÉALISATIONS", { fontSize: 86, fontWeight: 700, strokeWidth: 12, width: 5.5, height: 0.75, canvasWidth: 1032, canvasHeight: 160, textAlign: "left", textPadding: 0, backgroundColor: "transparent", textColor: "#ffffff", outlineColor: "#111713" });
    tvStandLabel.position.set(6.0, 0.89, -5.15);
    tvStandLabel.rotation.x = -Math.PI / 2;
    tvStandLabel.name = "projects-label";
    tvStand.add(tvStandLabel);
    centerFurniturePivot(tvStand);

    const plant = furnitureGroup(scene, "plant", "Plante");
    const plantPot = material(0xb36b4d, 0.8);
    const plantBase = new THREE.Vector3(-7.4, 0.06, -2.7);
    plant.position.copy(plantBase);
    const plantVisual = new THREE.Group();
    plant.add(plantVisual);
    plantVisual.add(box(0.78, 0.72, 0.78, plantPot, [0, 0.36, 0]));
    for (let index = 0; index < 5; index += 1) {
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.36, 8, 5), material(0x506c4d, 0.95));
      leaf.scale.set(0.5, 1.7, 0.32);
      leaf.position.set(Math.cos(index * 1.4) * 0.35, 1.09 + index * 0.12, Math.sin(index * 1.4) * 0.28);
      leaf.rotation.z = (index - 2) * 0.28;
      leaf.castShadow = true;
      plantVisual.add(leaf);
    }
    const plantLabel = createPropLabel("RETOUR", { fontSize: 210, fontWeight: 700, strokeWidth: 12, width: 0.74, height: 0.58, canvasWidth: 1024, canvasHeight: 512, backgroundColor: "transparent", textColor: "#ffffff", outlineColor: "#111713" });
    plantLabel.name = "plant-return-label";
    plantLabel.position.set(0, 0.36, 0.401);
    plantVisual.add(plantLabel);
    getEditorObjects().forEach(({ id, object }) => applyConfiguredPosition(id, object));
    markShadowsDirty();
  }, { timeout: 700 }));

  const windowLights = [
    { position: [-5.7, 5.1, -5.25], intensity: 0.32, target: [-5.7, 1.5, 0.5] },
    { position: [4.8, 4.25, -5.25], intensity: 0.46, target: [4.8, 1.5, 0.5] }
  ].map(({ position, intensity }) => {
    const light = new THREE.SpotLight(0xffe8c2, intensity, 22, 0.62, 0.35, 1.4);
    light.position.set(...position);
    light.target.position.set(...(position[0] < 0 ? [-5.7, 1.5, 0.5] : [4.8, 1.5, 0.5]));
    light.castShadow = true;
    light.shadow.mapSize.set(2048, 2048);
    light.shadow.camera.near = 0.2;
    light.shadow.camera.far = 22;
    light.shadow.bias = -0.00004;
    light.shadow.normalBias = 0.12;
    light.shadow.radius = 26;
    scene.add(light);
    scene.add(light.target);
    return light;
  });
  const ambientLight = new THREE.HemisphereLight(0xb8d4cc, 0x302d28, 1.3);
  scene.add(ambientLight);

  const screenCanvas = document.createElement("canvas");
  screenCanvas.width = 960;
  screenCanvas.height = 540;
  const screenContext = screenCanvas.getContext("2d");
  const screenTexture = new THREE.CanvasTexture(screenCanvas);
  screenTexture.colorSpace = THREE.SRGBColorSpace;
  screenTexture.minFilter = THREE.NearestFilter;
  screenTexture.magFilter = THREE.NearestFilter;
  let roomTelevision = null;
  let roomTelevisionFeaturesLoaded = false;
  let roomCup = null;
  let roomLaptop = null;
  let roomLaptopHandler = null;
  let televisionGlow = null;
  let roomScreenMaterial = null;
  let roomBaseScreenMap = null;
  let roomBaseScreenUvs = null;
  let roomDynamicScreenUvs = null;
  let televisionGlowBaseIntensity = 1.6;
  let roomCassetteSelectHandler = null;
  let roomTelevisionHandler = null;
  let roomTelevisionActionHandler = null;
  let roomCupHandler = null;
  let roomReturnHandler = null;
  let roomProjectsHandler = null;
  let cameraTransition = null;
  let projectsFocusReached = false;
  let projectsFocusHandler = null;
  let projectsFocusRequested = false;

  function notifyProjectsFocusReached() {
    if (projectsFocusReached) return;
    projectsFocusReached = true;
    projectsFocusHandler?.();
  }
  let actionPixelData = null;
  let roomActionTexture = null;
  const roomActionUniforms = {
    actionMap: { value: null },
    hoverUv: { value: new THREE.Vector2() },
    hasHoveredAction: { value: 0 }
  };

  function activateRoomTelevisionFeatures() {
    if (roomTelevisionFeaturesLoaded || !roomTelevision) return;
    roomTelevisionFeaturesLoaded = true;
    roomActionTexture = loadSharedTexture("assets/textures/television_actions.png", { colorSpace: THREE.NoColorSpace });
    roomActionUniforms.actionMap.value = roomActionTexture;
    loadSharedPixelData("assets/textures/television_actions.png").then((imageData) => {
      actionPixelData = imageData;
    });
    const screenMesh = roomTelevision.getObjectByName("screen");
    if (screenMesh && roomScreenMaterial) {
      roomScreenMaterial.map = screenTexture;
      roomScreenMaterial.emissive = new THREE.Color(0x16221e);
      roomScreenMaterial.emissiveMap = screenTexture;
      roomScreenMaterial.emissiveIntensity = 0.78;
      addRoomActionHighlight(roomScreenMaterial);
      roomScreenMaterial.needsUpdate = true;
    }
    drawRoomScreen(projects[0] || { title: "SIGNAL", meta: "READY", description: "" }, true);
  }
  let lastLightingUpdate = -1;
  const windowColor = new THREE.Color();
  const ambientSkyColor = new THREE.Color();
  const ambientGroundColor = new THREE.Color();
  const nightWindowColor = new THREE.Color(0x7598cf);
  const dayWindowColor = new THREE.Color(0xffe5bc);
  const nightAmbientColor = new THREE.Color(0x314d82);
  const dayAmbientColor = new THREE.Color(0xb8d4cc);
  const nightGroundColor = new THREE.Color(0x11182b);
  const dayGroundColor = new THREE.Color(0x302d28);
  const roomCassettes = [];
  const cassetteStates = new Map();
  const editor = {
    active: false,
    cameraMode: false,
    pointerLockUnavailable: false,
    selected: null,
    dragging: false,
    pointer: new THREE.Vector2(),
    raycaster: new THREE.Raycaster(),
    floor: new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
    hitPoint: new THREE.Vector3(),
    dragStartPoint: new THREE.Vector3(),
    objectStartPosition: new THREE.Vector3(),
    cameraPosition: new THREE.Vector3(),
    cameraQuaternion: new THREE.Quaternion()
    ,keys: new Set(), yaw: 0, pitch: 0, speed: 4.5
  };

  function getObjectScaleValue(object) {
    if (!object || !object.scale) return 1;
    const scaleValues = [object.scale.x, object.scale.y, object.scale.z].filter((value) => Number.isFinite(value));
    if (!scaleValues.length) return 1;
    const averageScale = scaleValues.reduce((sum, value) => sum + value, 0) / scaleValues.length;
    return Number.isFinite(averageScale) ? averageScale : 1;
  }

  function applyConfiguredPosition(id, object) {
    const config = configuredPositions[id];
    if (!config || !object) return;
    object.position.set(config.position.x, config.position.y, config.position.z);
    object.rotation.y = THREE.MathUtils.degToRad(config.rotationY || 0);
    const nextScale = Number.isFinite(config.scale) ? config.scale : getObjectScaleValue(object);
    if (nextScale > 0) object.scale.setScalar(nextScale);
  }

  function getLocalPointFromWorld(object, worldPoint) {
    if (!object || !worldPoint) return worldPoint.clone();
    if (!object.parent) return worldPoint.clone();
    object.parent.updateMatrixWorld(true);
    return worldPoint.clone().applyMatrix4(new THREE.Matrix4().copy(object.parent.matrixWorld).invert());
  }

  function getStoredPositions() {
    try {
      return JSON.parse(localStorage.getItem(POSITION_STORAGE_KEY) || "null");
    } catch {
      return null;
    }
  }

  async function loadConfiguredPositions() {
    const storedPositions = getStoredPositions();
    const storedCameraPositions = localStorage.getItem(CAMERA_STORAGE_KEY);
    let jsonConfiguration = null;
    try {
      const response = await fetch("assets/datas/positions.json");
      if (response.ok) jsonConfiguration = await response.json();
    } catch { jsonConfiguration = null; }
    configuredPositions = jsonConfiguration || storedPositions || {};
    configuredCameraPositions = configuredPositions.cameraPositions || [];
    if (!storedCameraPositions && !configuredCameraPositions.length) {
      configuredCameraPositions = configuredPositions.cameraPositions || [];
      if (!configuredCameraPositions.length) {
        try {
          const response = await fetch("assets/datas/positions.json");
          if (response.ok) configuredCameraPositions = (await response.json()).cameraPositions || [];
        } catch { configuredCameraPositions = []; }
      }
    }
    if (storedCameraPositions) {
      try { configuredCameraPositions = JSON.parse(storedCameraPositions); } catch { configuredCameraPositions = []; }
    }
    configuredPositions.layoutVersion = ROOM_LAYOUT_VERSION;
    configuredPositions.cameraPositions = configuredCameraPositions;
    const storedTelevisionPosition = configuredPositions.television?.position;
    if (jsonConfiguration?.television && storedTelevisionPosition && (Math.abs(storedTelevisionPosition.x) > 18 || Math.abs(storedTelevisionPosition.y) > 10 || Math.abs(storedTelevisionPosition.z) > 18)) {
      configuredPositions.television = jsonConfiguration.television;
    }
    refreshCameraPositionSelect();
    presentationCameraPose = configuredCameraPositions[2] || presentationCamera;
    camera.position.set(presentationCameraPose.position.x, presentationCameraPose.position.y, presentationCameraPose.position.z);
    editor.pitch = presentationCameraPose.rotation.x;
    editor.yaw = presentationCameraPose.rotation.y;
    applyCameraRotation();
    getEditorObjects().forEach((entry) => applyConfiguredPosition(entry.id, entry.object));
    markShadowsDirty();
    if (projectsFocusRequested) focusOnProjects();
  }

  function refreshCameraPositionSelect() {
    const select = document.querySelector("#editor-camera-position");
    if (!select) return;
    select.innerHTML = `<option value="">Position enregistrée...</option>${configuredCameraPositions.map((_, index) => `<option value="${index}">Caméra ${index + 1}</option>`).join("")}`;
  }

  function applyCameraRotation() {
    camera.rotation.order = "YXZ";
    camera.rotation.y = editor.yaw;
    camera.rotation.x = editor.pitch;
    camera.rotation.z = 0;
  }

  function toggleCameraMode(forceState) {
    const nextState = typeof forceState === "boolean" ? forceState : !editor.cameraMode;
    editor.cameraMode = nextState;
    document.body.classList.toggle("is-camera-mode", nextState);
    if (nextState) {
      editor.pointerLockUnavailable = false;
      const lockRequest = renderer.domElement.requestPointerLock?.();
      lockRequest?.catch(() => { editor.pointerLockUnavailable = true; });
    } else if (document.pointerLockElement === renderer.domElement) {
      editor.pointerLockUnavailable = false;
      document.exitPointerLock?.();
    }
  }

  function saveCameraPosition() {
    configuredCameraPositions.push({
      position: { x: Number(camera.position.x.toFixed(3)), y: Number(camera.position.y.toFixed(3)), z: Number(camera.position.z.toFixed(3)) },
      rotation: { x: Number(editor.pitch.toFixed(4)), y: Number(editor.yaw.toFixed(4)) }
    });
    configuredPositions.cameraPositions = configuredCameraPositions;
    const serializedCameraPositions = JSON.stringify(configuredCameraPositions);
    localStorage.setItem(CAMERA_STORAGE_KEY, serializedCameraPositions);
    localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(configuredPositions));
    refreshCameraPositionSelect();
    const select = document.querySelector("#editor-camera-position");
    if (select) select.value = String(configuredCameraPositions.length - 1);
  }

  function applySavedCameraPosition(index) {
    const saved = configuredCameraPositions[Number(index)];
    if (!saved) return;
    camera.position.set(saved.position.x, saved.position.y, saved.position.z);
    editor.pitch = saved.rotation.x;
    editor.yaw = saved.rotation.y;
    applyCameraRotation();
  }

  function focusOnProjects() {
    projectsFocusRequested = true;
    const target = configuredCameraPositions[3];
    if (!target || editor.active) return;
    focusCameraPose(target);
  }

  function focusCameraPose(target) {
    if (!target || editor.active) return;
    cameraTransition = {
      startedAt: performance.now(),
      duration: 1300,
      fromPosition: camera.position.clone(),
      fromPitch: editor.pitch,
      fromYaw: editor.yaw,
      // Pre-allocate the target Vector3 once, here, instead of inside the
      // render loop. Building a `new THREE.Vector3(...)` on every single
      // animation frame for the ~1300ms of the transition is the one
      // allocation pattern unique to this camera pan (nothing else in the
      // idle render loop allocates per frame like this), and the resulting
      // GC pressure is exactly the kind of thing that reads as invisible on
      // a static scene but shows up as a visible stutter mid-pan.
      toPosition: new THREE.Vector3(target.position.x, target.position.y, target.position.z),
      target
    };
  }

  function focusOnInitialView() {
    projectsFocusRequested = false;
    focusCameraPose(presentationCamera);
  }

  function focusOnAchievements() {
    projectsFocusRequested = false;
    focusCameraPose(configuredCameraPositions[4]);
  }

  function focusOnCameraIndex(index) {
    const target = configuredCameraPositions[Number(index)];
    if (!target || editor.active) return;
    projectsFocusRequested = false;
    focusCameraPose(target);
  }

  function applyPresentationCamera() {
    if (!presentationCameraPose) return;
    camera.position.set(presentationCameraPose.position.x, presentationCameraPose.position.y, presentationCameraPose.position.z);
    editor.pitch = presentationCameraPose.rotation.x;
    editor.yaw = presentationCameraPose.rotation.y;
    applyCameraRotation();
  }

  function saveEditorPositions() {
    markShadowsDirty();
    const positions = { ...configuredPositions };
    getEditorObjects().forEach(({ id, object }) => {
      positions[id] = {
        position: {
          x: Number(object.position.x.toFixed(3)),
          y: Number(object.position.y.toFixed(3)),
          z: Number(object.position.z.toFixed(3))
        },
        rotationY: Number(THREE.MathUtils.radToDeg(object.rotation.y).toFixed(2)),
        scale: Number(getObjectScaleValue(object).toFixed(3))
      };
    });
    configuredPositions = positions;
  }

  async function validateEditorPositions() {
    const button = document.querySelector("#roomEditorSave");
    const status = document.querySelector("#roomEditorStatus");
    if (button) button.disabled = true;
    if (status) status.textContent = "ÉCRITURE...";
    try {
      const response = await fetch("assets/datas/positions.json", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(configuredPositions, null, 2)
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      localStorage.removeItem(POSITION_STORAGE_KEY);
      if (status) status.textContent = "POSITIONS VALIDÉES";
    } catch (error) {
      console.error("Impossible d'enregistrer positions.json.", error);
      if (status) status.textContent = "ERREUR D'ÉCRITURE";
    } finally {
      if (button) button.disabled = false;
    }
  }

  function drawRoomScreen(project, isEjected = false) {
    const screenMesh = roomTelevision?.getObjectByName("screen");
    if (screenMesh && roomScreenMaterial && roomBaseScreenMap && roomBaseScreenUvs && roomDynamicScreenUvs) {
      screenMesh.geometry.setAttribute("uv", isEjected ? roomBaseScreenUvs : roomDynamicScreenUvs);
      roomScreenMaterial.map = isEjected ? roomBaseScreenMap : screenTexture;
      roomScreenMaterial.emissiveMap = isEjected ? null : screenTexture;
      roomScreenMaterial.emissiveIntensity = isEjected ? 0 : 0.78;
      roomScreenMaterial.needsUpdate = true;
    }
    if (isEjected) return;
    screenContext.fillStyle = "#16221e";
    screenContext.fillRect(0, 0, 960, 540);
    screenContext.fillStyle = "#e8ad45";
    screenContext.font = "500 22px 'DM Mono', monospace";
    screenContext.fillText(isEjected ? "NO TAPE / READY" : "PLAY / 01", 54, 50);
    screenContext.fillStyle = "#f5bc43";
    screenContext.font = "500 72px 'Space Grotesk', sans-serif";
    const titleLines = isEjected ? ["SIGNAL", "PAUSE"] : project.title.replace("<br>", " ").split(" ");
    titleLines.forEach((line, index) => screenContext.fillText(line, 54, 170 + index * 68));
    screenContext.fillStyle = "#e8ad45";
    screenContext.fillRect(54, 315, 64, 4);
    screenContext.font = "500 18px 'DM Mono', monospace";
    screenContext.fillText(isEjected ? "NO TAPE / READY" : project.meta.replaceAll("&nbsp;", " "), 54, 365);
    screenContext.fillStyle = "#d9d6bd";
    screenContext.font = "400 20px 'Space Grotesk', sans-serif";
    screenContext.fillText(isEjected ? "Insérez une cassette pour découvrir un projet." : project.description, 54, 420);
    screenContext.globalAlpha = 0.18;
    screenContext.fillStyle = "#b8c39d";
    for (let y = 0; y < 540; y += 6) screenContext.fillRect(0, y, 960, 2);
    screenContext.globalAlpha = 1;
    screenTexture.needsUpdate = true;
    televisionGlowBaseIntensity = isEjected ? 1.6 : 4.4;
    if (televisionGlow) televisionGlow.intensity = televisionGlowBaseIntensity;
  }

  function updateDynamicLighting(time) {
    const date = new Date();
    const hour = date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
    const sunrise = 6.5;
    const sunset = 20.5;
    const daylight = THREE.MathUtils.clamp(Math.sin(((hour - sunrise) / (sunset - sunrise)) * Math.PI), 0, 1);
    const lightingMinute = Math.floor(hour * 60);
    const shouldUpdateWindowLighting = lightingMinute !== lastLightingUpdate;
    if (shouldUpdateWindowLighting) lastLightingUpdate = lightingMinute;
    windowColor.lerpColors(nightWindowColor, dayWindowColor, daylight);
    const windowEnergy = 0.02 + daylight * 0.55;

    if (shouldUpdateWindowLighting) {
      windowLights.forEach((light, index) => {
        light.color.copy(windowColor);
        light.intensity = windowEnergy * (index === 0 ? 0.42 : 0.58);
      });
      ambientSkyColor.lerpColors(nightAmbientColor, dayAmbientColor, daylight);
      ambientGroundColor.lerpColors(nightGroundColor, dayGroundColor, daylight);
      ambientLight.color.copy(ambientSkyColor);
      ambientLight.groundColor.copy(ambientGroundColor);
      ambientLight.intensity = 0.48 + daylight * 0.92;
    }
    ceilingLight.intensity = 10 + (1 - daylight) * 12;

    if (televisionGlow) {
      const flicker = 0.96 + Math.sin(time * 0.028) * 0.025 + Math.sin(time * 0.11) * 0.012;
      televisionGlow.intensity = televisionGlowBaseIntensity * flicker;
      televisionGlow.color.set(daylight < 0.22 ? 0xffbd73 : 0xffa85c);
    }
    if (roomScreenMaterial) {
      roomScreenMaterial.emissiveIntensity = televisionGlowBaseIntensity * (0.58 + daylight * 0.12);
    }
  }

  function isRoomAction(uv, red, green, blue) {
    if (!actionPixelData || !uv) return false;
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

  function addRoomActionHighlight(material) {
    material.onBeforeCompile = (shader) => {
      shader.uniforms.actionMap = roomActionUniforms.actionMap;
      shader.uniforms.hoverUv = roomActionUniforms.hoverUv;
      shader.uniforms.hasHoveredAction = roomActionUniforms.hasHoveredAction;
      shader.vertexShader = shader.vertexShader.replace(
        "#include <uv_pars_vertex>",
        "#include <uv_pars_vertex>\nvarying vec2 roomActionUv;"
      ).replace(
        "#include <uv_vertex>",
        "#include <uv_vertex>\nroomActionUv = uv1;"
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <map_pars_fragment>",
        "#include <map_pars_fragment>\nuniform sampler2D actionMap;\nuniform vec2 hoverUv;\nuniform float hasHoveredAction;\nvarying vec2 roomActionUv;"
      ).replace(
        "#include <map_fragment>",
        `#include <map_fragment>
          vec3 roomActionPixel = texture2D(actionMap, roomActionUv).rgb;
          vec3 roomHoveredPixel = texture2D(actionMap, hoverUv).rgb;
          float roomRed = step(distance(roomActionPixel, vec3(1.0, 0.0, 0.0)), 0.08);
          float roomBlue = step(distance(roomActionPixel, vec3(0.0, 0.0, 1.0)), 0.08);
          float roomHoveredRed = step(distance(roomHoveredPixel, vec3(1.0, 0.0, 0.0)), 0.08);
          float roomHoveredBlue = step(distance(roomHoveredPixel, vec3(0.0, 0.0, 1.0)), 0.08);
          float roomHighlight = hasHoveredAction * (roomHoveredRed * roomRed + roomHoveredBlue * roomBlue);
          diffuseColor.rgb += vec3(1.0, 0.3, 0.06) * roomHighlight * 1.4;
        `
      );
    };
    material.customProgramCacheKey = () => "room-television-action-highlight-v1";
  }

  function createPropLabel(title, options = {}) {
    const { fontSize = 24, fontWeight = 600, strokeWidth = 0, width = 0.68, height = 0.09, canvasWidth = 512, canvasHeight = 64, textAlign = "center", textPadding = 0, backgroundColor = "#f4e8ca", textColor = "#111713", outlineColor = "#111713" } = options;
    const labelCanvas = document.createElement("canvas");
    labelCanvas.width = canvasWidth;
    labelCanvas.height = canvasHeight;
    const labelContext = labelCanvas.getContext("2d");
    if (backgroundColor !== "transparent") {
      labelContext.fillStyle = backgroundColor;
      labelContext.fillRect(0, 0, labelCanvas.width, labelCanvas.height);
    }
    labelContext.fillStyle = textColor;
    labelContext.font = `${fontWeight} ${fontSize}px 'Space Grotesk', sans-serif`;
    labelContext.textAlign = textAlign;
    labelContext.textBaseline = "middle";
    const textX = textAlign === "left" ? textPadding : textAlign === "right" ? canvasWidth - textPadding : canvasWidth / 2;
    if (strokeWidth > 0) {
      labelContext.lineWidth = strokeWidth;
      labelContext.strokeStyle = outlineColor;
      labelContext.strokeText(title.replace("<br>", " "), textX, labelCanvas.height / 2);
    }
    labelContext.fillText(title.replace("<br>", " "), textX, labelCanvas.height / 2);
    const labelTexture = new THREE.CanvasTexture(labelCanvas);
    labelTexture.colorSpace = THREE.SRGBColorSpace;
    labelTexture.minFilter = THREE.NearestFilter;
    labelTexture.magFilter = THREE.NearestFilter;
    return new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: labelTexture, transparent: backgroundColor === "transparent" }));
  }

  function createWorldTitleLabel() {
    const titleGroup = new THREE.Group();
    titleGroup.name = "world-title-label";
    titleGroup.userData.editorId = "world-title-label";

    const canvas = document.createElement("canvas");
    canvas.width = 1600;
    canvas.height = 720;
    const context = canvas.getContext("2d");

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.shadowColor = "rgba(0, 0, 0, 0.35)";
    context.shadowBlur = 40;

    context.fillStyle = "#f8efe3";
    context.font = "600 150px 'Space Grotesk', sans-serif";
    const lines = ["Bonjour !", "Bienvenue sur mon", "Portfolio"];
    const titleStartY = 155;
    const titleLineGap = 150;
    lines.forEach((line, index) => {
      context.fillText(line, canvas.width / 2, titleStartY + index * titleLineGap);
    });

    context.font = "500 34px 'DM Mono', monospace";
    context.letterSpacing = "0.18em";
    context.fillStyle = "rgba(245, 227, 196, 0.92)";
    context.fillText("MATEO LEUILLIER / BTS SIO SLAM", canvas.width / 2, 640);

    context.font = "500 28px 'DM Mono', monospace";
    context.fillStyle = "rgba(216, 210, 191, 0.9)";
    context.fillText("CENTRE-VAL-DE-LOIRE / FRANCE", canvas.width / 2, 688);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;

    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide, depthWrite: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(9.4, 4.5), material);
    mesh.name = "world-title-label-mesh";
    titleGroup.add(mesh);
    titleGroup.position.set(-1.8, 5.1, -5.82);
    titleGroup.rotation.y = 0;
    return titleGroup;
  }

  function loadRoomProps() {
    const textureLoader = new THREE.TextureLoader();
    const televisionTexture = textureLoader.load("assets/textures/television.png");
    televisionTexture.colorSpace = THREE.SRGBColorSpace;
    televisionTexture.magFilter = THREE.NearestFilter;
    televisionTexture.minFilter = THREE.NearestFilter;

    onVisible(container, () => onIdle(() => {
      loadSharedModel("assets/models/television.mtl", "assets/models/television.obj").then((template) => {
        const model = template.clone();
        roomTelevision = model;
        roomTelevision.position.set(6.0, 1.02, -5.15);
        roomTelevision.rotation.y = Math.PI - 0.12;
        roomTelevision.scale.setScalar(1.28);
        applyConfiguredPosition("television", roomTelevision);
        roomTelevision.traverse((part) => {
          if (!part.isMesh) return;
          part.castShadow = false;
          part.receiveShadow = false;
          const clonedMaterial = part.material.clone();
          clonedMaterial.map = televisionTexture;
          if (part.name.toLowerCase() === "screen") {
            roomBaseScreenMap = part.material.map;
            if (roomBaseScreenMap) {
              roomBaseScreenMap.magFilter = THREE.NearestFilter;
              roomBaseScreenMap.minFilter = THREE.NearestFilter;
              roomBaseScreenMap.anisotropy = 1;
              roomBaseScreenMap.needsUpdate = true;
            }
            roomBaseScreenUvs = part.geometry.attributes.uv.clone();
            part.geometry.setAttribute("uv1", roomBaseScreenUvs.clone());
            roomDynamicScreenUvs = mapScreenUvs(part);
            roomScreenMaterial = clonedMaterial;
          }
          part.material = clonedMaterial;
        });
        scene.add(roomTelevision);
        televisionGlow = new THREE.SpotLight(0xffa85c, 5.5, 5, 0.58, 0.55, 1.5);
        televisionGlow.position.set(0, 0.62, 0.5);
        const televisionGlowTarget = new THREE.Object3D();
        televisionGlowTarget.position.set(0, 0.62, 4);
        roomTelevision.add(televisionGlow, televisionGlowTarget);
        televisionGlow.target = televisionGlowTarget;
        drawRoomScreen(projects[0] || { title: "SIGNAL", meta: "READY", description: "" }, true);
        roomTelevision.visible = false;
        prepareRoomModel(roomTelevision).then(() => {
          roomTelevision.visible = true;
        });
      }, (error) => console.error("Impossible de charger le modèle TV de la pièce.", error));
    }, { timeout: 2500 }));

    onVisible(container, () => onIdle(() => {
      loadSharedModel("assets/models/Cassette.mtl", "assets/models/Cassette.obj").then((template) => {
        projects.forEach((project, index) => {
          const cassette = template.clone();
          cassette.position.set(4.65 + index * 0.12, 0.24 + index * 0.12, -4.2 - index * 0.08);
          cassette.rotation.set(0, [-0.08, 0.12, -0.05][index] || 0, 0);
          cassette.scale.setScalar(0.96);
          applyConfiguredPosition(`cassette-${index + 1}`, cassette);
          cassette.traverse((part) => {
            if (!part.isMesh) return;
            part.castShadow = true;
            part.receiveShadow = true;
            part.material = part.material.clone();
            if (part.material.map) {
              part.material.map.magFilter = THREE.NearestFilter;
              part.material.map.minFilter = THREE.NearestFilter;
              part.material.map.anisotropy = 1;
              part.material.map.needsUpdate = true;
            }
          });
          const label = createPropLabel(project.title);
          label.position.set(0, 0.064, 0.316);
          cassette.add(label);
          const shouldBeVisible = !cassetteStates.get(index);
          cassette.visible = false;
          scene.add(cassette);
          roomCassettes[index] = cassette;
          prepareRoomModel(cassette).then(() => {
            cassette.visible = shouldBeVisible;
            markShadowsDirty();
          });
        });
      }, (error) => console.error("Impossible de charger le modèle cassette de la pièce.", error));
    }, { timeout: 2500 }));

    loadSharedModel("assets/models/cup.mtl", "assets/models/cup.obj").then((template) => {
      const model = template.clone();
      roomCup = model;
      roomCup.name = "cup";
      roomCup.position.set(-5.5, 1.78, -2.2);
      roomCup.scale.setScalar(1.35);
      applyConfiguredPosition("cup", roomCup);
      roomCup.traverse((part) => {
        if (!part.isMesh) return;
        part.castShadow = true;
        part.receiveShadow = true;
        const materials = Array.isArray(part.material) ? part.material : [part.material];
        materials.forEach((material) => {
          if (!material.map) return;
          material.map.magFilter = THREE.NearestFilter;
          material.map.minFilter = THREE.NearestFilter;
          material.map.anisotropy = 1;
          material.map.needsUpdate = true;
        });
      });
      const cupLabel = createPropLabel("MES PROJETS", { fontSize: 48, fontWeight: 700, strokeWidth: 1.6, width: 0.4, height: 0.15, canvasHeight: 128 });
      cupLabel.position.set(0, 0.30, 0.2);
      roomCup.add(cupLabel);
      roomCup.visible = false;
      scene.add(roomCup);
      prepareRoomModel(roomCup).then(() => {
        roomCup.visible = true;
        markShadowsDirty();
      });
    }, (error) => console.error("Impossible de charger le modèle cup de la pièce.", error));

    loadSharedModel("assets/models/laptop.mtl", "assets/models/laptop.obj").then((template) => {
      const model = template.clone();
      roomLaptop = model;
      roomLaptop.name = "laptop";
      roomLaptop.position.set(-5.1, 1.72, -2.2);
      roomLaptop.rotation.y = -0.9;
      roomLaptop.scale.setScalar(1.5);
      applyConfiguredPosition("laptop", roomLaptop);
      roomLaptop.traverse((part) => {
        if (!part.isMesh) return;
        part.castShadow = true;
        part.receiveShadow = true;
        const materials = Array.isArray(part.material) ? part.material : [part.material];
        materials.forEach((material) => {
          if (!material.map) return;
          material.map.magFilter = THREE.NearestFilter;
          material.map.minFilter = THREE.NearestFilter;
          material.map.anisotropy = 1;
          material.map.needsUpdate = true;
        });
      });
      const laptopScreenLabel = createPropLabel("MES COMPÉTENCES", {
        fontSize: 52,
        fontWeight: 700,
        strokeWidth: 3,
        width: 1.0,
        height: 0.42,
        canvasWidth: 900,
        canvasHeight: 180,
        textColor: "#ffffff",
        outlineColor: "#111713",
        backgroundColor: "transparent"
      });
      laptopScreenLabel.position.set(0, 0.4, 0.35);
      laptopScreenLabel.rotation.set(0.35, Math.PI, 0);
      laptopScreenLabel.material.side = THREE.FrontSide;
      laptopScreenLabel.material.depthTest = true;
      laptopScreenLabel.material.depthWrite = true;
      laptopScreenLabel.renderOrder = 20;
      roomLaptop.add(laptopScreenLabel);
      roomLaptop.visible = false;
      scene.add(roomLaptop);
      prepareRoomModel(roomLaptop).then(() => {
        roomLaptop.visible = true;
        markShadowsDirty();
      });
    }, (error) => console.error("Impossible de charger le modèle laptop de la pièce.", error));

  }

  function getEditorObjects() {
    const props = [
      { id: "world-title-label", label: "Titre d'accueil", object: scene.getObjectByName("world-title-label") },
      { id: "television", label: "Télévision", object: roomTelevision },
      { id: "cup", label: "Tasse", object: roomCup },
      { id: "laptop", label: "Laptop", object: roomLaptop },
      { id: "scratch-trophy", label: "Trophée Scratch", object: scene.getObjectByName("scratch-trophy") },
      { id: "python-trophy", label: "Trophée Python", object: scene.getObjectByName("python-trophy") },
      { id: "csharp-trophy", label: "Trophée C#", object: scene.getObjectByName("csharp-trophy") },
      { id: "html-trophy", label: "Trophée HTML", object: scene.getObjectByName("html-trophy") },
      { id: "godot-trophy", label: "Trophée Godot", object: scene.getObjectByName("godot-trophy") },
      { id: "css-trophy", label: "Trophée CSS", object: scene.getObjectByName("css-trophy") },
      ...roomCassettes.map((object, index) => ({ id: `cassette-${index + 1}`, label: `Cassette ${index + 1}`, object }))
    ];
    const furniture = [
      ["kitchen", "Cuisine / îlot"],
      ["dining-table", "Table et chaises"],
      ["sofa", "Canapé en L"],
      ["tv-stand", "Meuble TV"],
      ["shelf", "Étagère"],
      ["plant", "Plante"]
    ].map(([id, label]) => ({ id, label, object: scene.getObjectByName(id) }));
    return [...props, ...furniture].filter((entry) => entry.object);
  }

  function syncEditorFields() {
    if (!editor.selected) return;
    const { object } = editor.selected;
    ["x", "y", "z"].forEach((axis) => document.querySelector(`#editor-${axis}`).value = object.position[axis].toFixed(2));
    document.querySelector("#editor-rotation").value = THREE.MathUtils.radToDeg(object.rotation.y).toFixed(1);
    document.querySelector("#editor-scale").value = getObjectScaleValue(object).toFixed(2);
  }

  function selectEditorObject(id) {
    editor.selected = getEditorObjects().find((entry) => entry.id === id) || null;
    if (editor.selected) syncEditorFields();
  }

  function setEditorMode(isActive) {
    editor.active = isActive;
    document.body.classList.toggle("is-room-editing", isActive);
    document.querySelector("#roomEditor")?.classList.toggle("is-visible", isActive);
    if (isActive) {
      const select = document.querySelector("#editor-object");
      select.innerHTML = getEditorObjects().map((entry) => `<option value="${entry.id}">${entry.label}</option>`).join("");
      editor.cameraPosition.copy(camera.position);
      editor.cameraQuaternion.copy(camera.quaternion);
      camera.rotation.reorder("YXZ");
      editor.yaw = camera.rotation.y;
      editor.pitch = camera.rotation.x;
      camera.fov = CAMERA_FOV;
      camera.updateProjectionMatrix();
      selectEditorObject(editor.selected?.id || "television");
      return;
    }
    toggleCameraMode(false);
    editor.keys.clear();
    if (presentationCameraPose) {
      applyPresentationCamera();
    } else {
      camera.position.set(-7.2, 5.6, 1.4);
      camera.lookAt(1.2, 1.7, -2.0);
    }
    camera.fov = CAMERA_FOV;
    camera.updateProjectionMatrix();
  }

  function createRoomEditor() {
    const panel = document.createElement("aside");
    panel.id = "roomEditor";
    panel.className = "room-editor";
    panel.innerHTML = `<div class="room-editor-title">ÉDITION LIBRE</div><button type="button" id="roomEditorClose">QUITTER</button><label>Objet<select id="editor-object"></select></label><div class="editor-fields"><label>X<input id="editor-x" type="number" step="0.05"></label><label>Y<input id="editor-y" type="number" step="0.05"></label><label>Z<input id="editor-z" type="number" step="0.05"></label></div><label>Rotation Y<input id="editor-rotation" type="number" step="1"></label><label>Grossissement<input id="editor-scale" type="number" step="0.05" min="0.1" max="10"></label><label>Caméra<select id="editor-camera-position"></select></label><button type="button" id="roomEditorSave">VALIDER</button><button type="button" id="roomEditorClearCache">VIDER LE CACHE</button><p id="roomEditorStatus" role="status">Modifications non enregistrées</p><p>H : activer / quitter la caméra<br>ZQSD : se déplacer<br>A / E : descendre / monter<br>Souris : regarder autour<br>R : enregistrer la caméra</p>`;
    container.parentElement.appendChild(panel);
    const select = panel.querySelector("#editor-object");
    select.addEventListener("change", () => selectEditorObject(select.value));
    panel.querySelector("#editor-camera-position").addEventListener("change", (event) => {
      if (event.target.value !== "") applySavedCameraPosition(event.target.value);
    });
    ["x", "y", "z"].forEach((axis) => panel.querySelector(`#editor-${axis}`).addEventListener("input", (event) => {
      if (editor.selected) {
        editor.selected.object.position[axis] = Number(event.target.value) || 0;
        saveEditorPositions();
      }
    }));
    panel.querySelector("#editor-rotation").addEventListener("input", (event) => {
      if (editor.selected) {
        editor.selected.object.rotation.y = THREE.MathUtils.degToRad(Number(event.target.value) || 0);
        saveEditorPositions();
      }
    });
    panel.querySelector("#editor-scale").addEventListener("input", (event) => {
      if (editor.selected) {
        const nextScale = THREE.MathUtils.clamp(Number(event.target.value) || 1, 0.1, 10);
        editor.selected.object.scale.setScalar(nextScale);
        saveEditorPositions();
      }
    });
    panel.querySelector("#roomEditorSave").addEventListener("click", validateEditorPositions);
    panel.querySelector("#roomEditorClearCache").addEventListener("click", () => {
      clearSharedCache();
      const status = panel.querySelector("#roomEditorStatus");
      status.textContent = "Cache vidé — les ressources seront rechargées.";
    });
    panel.querySelector("#roomEditorClose").addEventListener("click", () => setEditorMode(false));
    window.addEventListener("keydown", (event) => {
      if (!editor.active) return;
      const key = event.key.toLowerCase();
      if (key === "h") {
        toggleCameraMode();
        event.preventDefault();
        return;
      }
      if (!editor.cameraMode) return;
      if (["z", "q", "s", "d", "a", "e"].includes(key)) {
        editor.keys.add(key);
        event.preventDefault();
      }
      if (key === "r") {
        saveCameraPosition();
        event.preventDefault();
      }
    });
    window.addEventListener("keyup", (event) => editor.keys.delete(event.key.toLowerCase()));
    return panel;
  }

  const pointer = { x: 0, y: 0 };
  function resize() {
    renderer.setSize(container.clientWidth, container.clientHeight, false);
    camera.aspect = container.clientWidth / Math.max(1, container.clientHeight);
    camera.updateProjectionMatrix();
  }
  function onPointerMove(event) {
    pointer.x = (event.clientX / window.innerWidth - 0.5) * 2;
    pointer.y = (event.clientY / window.innerHeight - 0.5) * 2;
  }
  function updateFreeCamera(deltaTime) {
    const distance = editor.speed * deltaTime;
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    forward.y = 0;
    forward.normalize();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    right.y = 0;
    right.normalize();
    if (editor.keys.has("z")) camera.position.addScaledVector(forward, distance);
    if (editor.keys.has("s")) camera.position.addScaledVector(forward, -distance);
    if (editor.keys.has("q")) camera.position.addScaledVector(right, -distance);
    if (editor.keys.has("d")) camera.position.addScaledVector(right, distance);
    if (editor.keys.has("a")) camera.position.y -= distance;
    if (editor.keys.has("e")) camera.position.y += distance;
    applyCameraRotation();
  }

  function getRoomInteraction(event) {
    if (editor.active || cameraTransition) return null;
    const canvasBounds = renderer.domElement.getBoundingClientRect();
    const pointerPosition = new THREE.Vector2(
      ((event.clientX - canvasBounds.left) / canvasBounds.width) * 2 - 1,
      -((event.clientY - canvasBounds.top) / canvasBounds.height) * 2 + 1
    );
    editor.raycaster.setFromCamera(pointerPosition, camera);
    const interactiveObjects = [...roomCassettes.filter(Boolean), roomTelevision].filter(Boolean);
    if (roomCup) interactiveObjects.push(roomCup);
    if (roomLaptop) interactiveObjects.push(roomLaptop);
    const plantReturnLabel = scene.getObjectByName("plant-return-label");
    const projectsLabel = scene.getObjectByName("projects-label");
    if (plantReturnLabel) interactiveObjects.push(plantReturnLabel);
    if (projectsLabel) interactiveObjects.push(projectsLabel);
    const hits = editor.raycaster.intersectObjects(interactiveObjects, true);
    const hit = hits[0];
    if (hit) {
      let hitObject = hit.object;
      while (hitObject) {
        if (hitObject.name === "plant-return-label") return { type: "return" };
        if (hitObject.name === "projects-label") return { type: "projects" };
        hitObject = hitObject.parent;
      }
      const cassetteIndex = roomCassettes.findIndex((cassette) => cassette?.getObjectById(hit.object.id));
      if (cassetteIndex !== -1) return { type: "cassette", index: cassetteIndex };
      if (roomTelevision?.getObjectById(hit.object.id)) {
        const screenMesh = roomTelevision.getObjectByName("screen");
        const actionUv = hit.object === screenMesh ? hit.uv1 : hit.uv;
        if (hit.object === screenMesh && isRoomAction(actionUv, 255, 0, 0)) return { type: "television-action", action: "red" };
        if (hit.object === screenMesh && isRoomAction(actionUv, 0, 0, 255)) return { type: "television-action", action: "blue" };
        return { type: "television" };
      }
      if (roomCup?.getObjectById(hit.object.id)) return { type: "cup" };
      if (roomLaptop?.getObjectById(hit.object.id)) return { type: "laptop" };
    }

    return null;
  }

  function handleRoomPointerMove(event) {
    const interaction = getRoomInteraction(event);
    if (interaction?.type === "television-action") {
      const bounds = renderer.domElement.getBoundingClientRect();
      const pointerPosition = new THREE.Vector2(
        ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
        -((event.clientY - bounds.top) / bounds.height) * 2 + 1
      );
      editor.raycaster.setFromCamera(pointerPosition, camera);
      const hit = editor.raycaster.intersectObject(roomTelevision.getObjectByName("screen"), false)[0];
      if (hit?.uv1) roomActionUniforms.hoverUv.value.copy(hit.uv1);
      roomActionUniforms.hasHoveredAction.value = 1;
    } else {
      roomActionUniforms.hasHoveredAction.value = 0;
    }
    renderer.domElement.style.cursor = interaction ? "pointer" : "default";
  }

  function handleRoomClick(event) {
    const interaction = getRoomInteraction(event);
    if (!interaction) return;
    if (interaction.type === "cassette") roomCassetteSelectHandler?.(interaction.index);
    if (interaction.type === "television") roomTelevisionHandler?.();
    if (interaction.type === "television-action") roomTelevisionActionHandler?.(interaction.action);
    if (interaction.type === "cup") roomCupHandler?.();
    if (interaction.type === "laptop") roomLaptopHandler?.();
    if (interaction.type === "return") roomReturnHandler?.();
    if (interaction.type === "projects") roomProjectsHandler?.();
  }
  function render(time) {
    const deltaTime = Math.min(0.05, (time - (render.previousTime || time)) / 1000);
    render.previousTime = time;
    updateDynamicLighting(time);
    if (editor.active && editor.cameraMode) {
      updateFreeCamera(deltaTime);
    } else if (!editor.active) {
      if (cameraTransition) {
        const progress = THREE.MathUtils.clamp((time - cameraTransition.startedAt) / cameraTransition.duration, 0, 1);
        const easedProgress = 1 - Math.pow(1 - progress, 3);
        camera.position.lerpVectors(cameraTransition.fromPosition, cameraTransition.toPosition, easedProgress);
        editor.pitch = THREE.MathUtils.lerp(cameraTransition.fromPitch, cameraTransition.target.rotation.x, easedProgress);
        editor.yaw = THREE.MathUtils.lerp(cameraTransition.fromYaw, cameraTransition.target.rotation.y, easedProgress);
        applyCameraRotation();
        if (progress >= 1) {
          presentationCameraPose = cameraTransition.target;
          cameraTransition = null;
          notifyProjectsFocusReached();
        }
      } else if (presentationCameraPose) {
        applyPresentationCamera();
      } else {
        const targetX = -8.4 + pointer.x * 0.42;
        const targetY = 6.2 - pointer.y * 0.18;
        camera.position.x += (targetX - camera.position.x) * 0.025;
        camera.position.y += (targetY - camera.position.y) * 0.025;
        camera.lookAt(1.4, 1.7, -2.3);
      }
    }
    renderer.render(scene, camera);
    requestAnimationFrame(render);
  }

  camera.position.set(presentationCamera.position.x, presentationCamera.position.y, presentationCamera.position.z);
  editor.pitch = presentationCamera.rotation.x;
  editor.yaw = presentationCamera.rotation.y;
  applyCameraRotation();
  resize();
  window.addEventListener("resize", resize);
  window.addEventListener("pointermove", onPointerMove, { passive: true });
  renderer.domElement.addEventListener("pointermove", handleRoomPointerMove);
  renderer.domElement.addEventListener("click", handleRoomClick);
  const editorPanel = createRoomEditor();
  const editorToggle = document.createElement("button");
  editorToggle.className = "room-editor-toggle";
  editorToggle.type = "button";
  editorToggle.textContent = "ÉDITER LA PIÈCE";
  editorToggle.addEventListener("click", () => setEditorMode(!editor.active));
  container.parentElement.appendChild(editorToggle);
  renderer.domElement.addEventListener("pointerdown", (event) => {
    if (!editor.active || !editor.selected) return;
    const bounds = renderer.domElement.getBoundingClientRect();
    editor.pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    editor.pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
    editor.raycaster.setFromCamera(editor.pointer, camera);
    editor.floor.constant = -editor.selected.object.position.y;
    if (!editor.raycaster.ray.intersectPlane(editor.floor, editor.dragStartPoint)) return;
    editor.objectStartPosition.copy(editor.selected.object.position);
    editor.dragging = true;
    renderer.domElement.setPointerCapture(event.pointerId);
  });
  renderer.domElement.addEventListener("pointermove", (event) => {
    if (!editor.active || !editor.cameraMode || editor.dragging) return;
    editor.yaw -= event.movementX * 0.003;
    editor.pitch = THREE.MathUtils.clamp(editor.pitch - event.movementY * 0.003, -1.45, 1.45);
    applyCameraRotation();
  });
  document.addEventListener("pointerlockchange", () => {
    if (document.pointerLockElement !== renderer.domElement && editor.cameraMode && !editor.pointerLockUnavailable) toggleCameraMode(false);
  });
  renderer.domElement.addEventListener("pointermove", (event) => {
    if (!editor.active || !editor.dragging || !editor.selected) return;
    const bounds = renderer.domElement.getBoundingClientRect();
    editor.pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    editor.pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
    editor.raycaster.setFromCamera(editor.pointer, camera);
    editor.floor.constant = -editor.objectStartPosition.y;
    if (editor.raycaster.ray.intersectPlane(editor.floor, editor.hitPoint)) {
      const dragDeltaX = editor.hitPoint.x - editor.dragStartPoint.x;
      const dragDeltaZ = editor.hitPoint.z - editor.dragStartPoint.z;
      editor.selected.object.position.x = editor.objectStartPosition.x + dragDeltaX;
      editor.selected.object.position.z = editor.objectStartPosition.z + dragDeltaZ;
      editor.selected.object.position.y = editor.objectStartPosition.y;
      syncEditorFields();
      saveEditorPositions();
    }
  });
  renderer.domElement.addEventListener("pointerup", () => { editor.dragging = false; });
  loadRoomProps();
  loadConfiguredPositions().then(() => requestAnimationFrame(render));

  return {
    updateScreen(project, isEjected = false) {
      drawRoomScreen(project, isEjected);
    },
    setCassetteInserted(index, isInserted) {
      cassetteStates.set(index, isInserted);
      if (roomCassettes[index]) roomCassettes[index].visible = !isInserted;
      markShadowsDirty();
    },
    setCassetteSelectHandler(handler) {
      roomCassetteSelectHandler = handler;
    },
    setTelevisionHandler(handler) {
      roomTelevisionHandler = handler;
    },
    setTelevisionActionHandler(handler) {
      roomTelevisionActionHandler = handler;
    },
    activateTelevisionFeatures() {
      activateRoomTelevisionFeatures();
    },
    setCupHandler(handler) {
      roomCupHandler = handler;
    },
    setLaptopHandler(handler) {
      roomLaptopHandler = handler;
    },
    setReturnHandler(handler) {
      roomReturnHandler = handler;
    },
    setProjectsHandler(handler) {
      roomProjectsHandler = handler;
    },
    // Lets a caller know exactly once the camera has finished travelling to
    // the "Mes Projets" position (i.e. focusOnProjects has completed), so
    // heavier work (loading the television/cassette close-up 3D modules)
    // can be deferred until it's actually needed instead of racing the
    // initial page load. If the destination was already reached before this
    // is called, the handler fires immediately rather than being missed.
    onProjectsFocusReached(handler) {
      if (projectsFocusReached) {
        handler();
        return;
      }
      projectsFocusHandler = handler;
    },
    focusOnProjects,
    focusOnInitialView,
    focusOnAchievements,
    focusOnCameraIndex
  };
}

function addZone(scene, surface, width, depth, position) {
  // The room now keeps a single classic floor without any overlay trays.
}

function addSofaL(scene, surface, wood) {
  const group = furnitureGroup(scene, "sofa", "Canapé en L");
  group.add(box(5.2, 0.36, 1.35, surface, [3.5, 0.65, 1.85]));
  group.add(box(1.35, 0.36, 3.9, surface, [1.6, 0.65, 0.45]));
  group.add(box(5.2, 1.45, 0.3, surface, [3.5, 1.35, 2.45]));
  group.add(box(0.3, 1.45, 3.9, surface, [1.0, 1.35, 0.45]));
  group.add(box(5.2, 0.2, 1.5, wood, [3.5, 0.28, 1.85]));
  group.add(box(0.2, 0.4, 3.7, wood, [1.6, 0.22, 0.45]));
  centerFurniturePivot(group);
}

function addDiningTable(scene, surface, wood) {
  const group = furnitureGroup(scene, "dining-table", "Table et chaises");
  group.position.set(-5.5, 1.55, -2.2);

  loadSharedModel("assets/models/furniture/table.mtl", "assets/models/furniture/table.obj").then((template) => {
    const model = template.clone();
    model.name = "dining-table-model";
    fitModelToHeight(model, 2.6);
    model.rotation.y = Math.PI / 2;
    model.position.set(0, -0.35, 0);
    model.traverse((part) => {
      if (!part.isMesh) return;
      part.castShadow = true;
      part.receiveShadow = true;
      const materials = Array.isArray(part.material) ? part.material : [part.material];
      materials.forEach((materialItem) => {
        if (!materialItem.map) return;
        materialItem.map.magFilter = THREE.NearestFilter;
        materialItem.map.minFilter = THREE.NearestFilter;
        materialItem.map.anisotropy = 1;
        materialItem.map.needsUpdate = true;
      });
    });
    group.add(model);
  }, (error) => console.error("Impossible de charger le modèle de table.", error));

  return group;
}

function addKitchen(scene, counter, wood) {
  const group = furnitureGroup(scene, "kitchen", "Cuisine / îlot");
  group.add(box(4.5, 0.95, 1.7, counter, [-6.3, 0.55, 2.65]));
  group.add(box(4.7, 0.12, 1.9, wood, [-6.3, 1.08, 2.65]));
  group.add(box(1.45, 0.82, 1.25, material(0x323d39, 0.7), [-6.3, 1.47, 2.65]));
  group.add(box(0.08, 1.8, 0.08, wood, [-8.45, 0.9, 2.65]));
  group.add(box(0.08, 1.8, 0.08, wood, [-4.15, 0.9, 2.65]));
  centerFurniturePivot(group);
}