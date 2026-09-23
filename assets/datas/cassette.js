import * as THREE from "three";
import { loadSharedModel, onIdle, onVisible, onVisibilityChange } from "./model-cache.js";

export function createCassetteModels(stage, projects) {
  const count = projects.length;
  const textureLoader = new THREE.TextureLoader();
  const modelObjects = [];
  let previousRenderTime = 0;
  const cassetteAngles = [0.08, -0.12, 0.18, -0.06];
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1.25, 1.25, 1.05, -1.05, 0.1, 100);
  camera.position.set(1.5, 0.66, 2.65);
  camera.lookAt(0, 0.25, 0);
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  stage.appendChild(renderer.domElement);
  scene.add(new THREE.HemisphereLight(0xfff0d0, 0x29352e, 2.8));
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.5);
  keyLight.position.set(2, 4, 3);
  scene.add(keyLight);

  const cassetteTexturePaths = [
    "textures/cassettes/cassette-jaune.png",
    "textures/cassettes/cassette-orange.png",
    "textures/cassettes/cassette-violette.png"
  ];
  const cassetteTextures = cassetteTexturePaths.map((path) => {
    const texture = textureLoader.load(path);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.anisotropy = 1;
    return texture;
  });

  let referenceWidth = 390;
  let referenceHeight = 370;
  let pixelsPerWorldX = referenceWidth / 2.5;
  let pixelsPerWorldY = referenceHeight / 2.1;
  let cassetteScale = 1.55;

  function resize() {
    const stack = document.querySelector(".cassette-stack");
    referenceWidth = stack?.clientWidth || referenceWidth;
    referenceHeight = stack?.clientHeight || referenceHeight;
    pixelsPerWorldX = referenceWidth / 2.5;
    pixelsPerWorldY = referenceHeight / 2.1;
    cassetteScale = 2.05 * Math.max(1, referenceWidth / 390);
    renderer.setSize(stage.clientWidth, stage.clientHeight, false);
    camera.left = -window.innerWidth / 2 / pixelsPerWorldX;
    camera.right = window.innerWidth / 2 / pixelsPerWorldX;
    camera.top = window.innerHeight / 2 / pixelsPerWorldY;
    camera.bottom = -window.innerHeight / 2 / pixelsPerWorldY;
    camera.updateProjectionMatrix();
  }

  onVisible(stage, () => onIdle(() => {
    loadSharedModel("assets/models/Cassette.mtl", "assets/models/Cassette.obj").then(async (model) => {
      model.traverse((part) => {
        if (!part.isMesh) return;
        const materials = Array.isArray(part.material) ? part.material : [part.material];
        materials.forEach((material) => {
          if (!material.map) return;
          material.map.colorSpace = THREE.SRGBColorSpace;
          material.map.magFilter = THREE.NearestFilter;
          material.map.minFilter = THREE.NearestFilter;
          material.map.anisotropy = 1;
          material.map.needsUpdate = true;
        });
        part.castShadow = true;
        part.receiveShadow = true;
      });

      for (let index = 0; index < count; index += 1) {
        const object = model.clone();
        const cassetteTexture = cassetteTextures[index % cassetteTextures.length];
        object.traverse((part) => {
          if (!part.isMesh) return;
          const sourceMaterials = Array.isArray(part.material) ? part.material : [part.material];
          const materials = sourceMaterials.map((material) => {
            const clonedMaterial = material.clone();
            clonedMaterial.map = cassetteTexture;
            clonedMaterial.needsUpdate = true;
            return clonedMaterial;
          });
          part.material = Array.isArray(part.material) ? materials : materials[0];
        });
        object.scale.setScalar(cassetteScale);
        object.rotation.set(0, cassetteAngles[index], 0);
        object.position.set([-0.18, 0.28, 0][index], index * 0.22, 0);

        await document.fonts.load("58px Bungee");
        const titleCanvas = document.createElement("canvas");
        titleCanvas.width = 512;
        titleCanvas.height = 64;
        const titleContext = titleCanvas.getContext("2d");
        titleContext.clearRect(0, 0, titleCanvas.width, titleCanvas.height);
        titleContext.fillStyle = "#111713";
        titleContext.font = "58px 'Bungee', sans-serif";
        titleContext.textAlign = "center";
        titleContext.textBaseline = "middle";
        titleContext.fillText(projects[index].title.replace("<br>", " "), titleCanvas.width / 2, titleCanvas.height / 2);
        const titleTexture = new THREE.CanvasTexture(titleCanvas);
        titleTexture.colorSpace = THREE.SRGBColorSpace;
        titleTexture.minFilter = THREE.NearestFilter;
        titleTexture.magFilter = THREE.NearestFilter;
        const titleMaterial = new THREE.MeshBasicMaterial({ map: titleTexture, transparent: true, depthWrite: false });
        const titlePlane = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.1), titleMaterial);
        titlePlane.position.set(0, 0.064, 0.316);
        object.add(titlePlane);

        scene.add(object);
        modelObjects.push({ object, index, appearanceStartedAt: performance.now() + index * 160 });
      }
    }, (error) => console.error("Impossible de charger le modèle cassette.", error));
  }, { timeout: 2500 }));

  // The cassette DOM elements never change identity, only their CSS
  // position/classes (via drag/settle animations elsewhere), so the element
  // lookup itself only needs to happen once. Re-running querySelector for
  // each of the 3 cassettes on every single animation frame was needless
  // DOM work stacked on top of the getBoundingClientRect() calls below
  // (which do need to run every frame, since they read live layout).
  const cassetteElementsByIndex = new Map();
  function getCassetteElement(index) {
    let cassette = cassetteElementsByIndex.get(index);
    if (!cassette || !cassette.isConnected) {
      cassette = document.querySelector(`.cassette[data-index="${index}"]`);
      cassetteElementsByIndex.set(index, cassette);
    }
    return cassette;
  }

  function render(time) {
    const deltaTime = previousRenderTime ? Math.min(50, time - previousRenderTime) : 16;
    const rotationSmoothing = 1 - Math.exp(-deltaTime / 120);
    previousRenderTime = time;
    modelObjects.forEach(({ object, index, appearanceStartedAt }) => {
      const cassette = getCassetteElement(index);
      const bounds = cassette?.getBoundingClientRect();
      if (!bounds) {
        object.visible = false;
        return;
      }
      const targetX = (bounds.left + bounds.width / 2 - window.innerWidth / 2) / pixelsPerWorldX;
      const targetY = (window.innerHeight / 2 - bounds.top - bounds.height / 2) / pixelsPerWorldY;
      const appearanceProgress = THREE.MathUtils.clamp((time - appearanceStartedAt) / 420, 0, 1);
      const appearanceEase = 1 - Math.pow(1 - appearanceProgress, 3);
      const isInserted = cassette.classList.contains("is-inserted");
      object.position.x = targetX;
      object.position.y = targetY + (1 - appearanceEase) * 0.18;
      object.visible = !isInserted && appearanceProgress > 0;
      const hoverScale = cassette.classList.contains("is-hovered") ? 1.03 : 1;
      object.scale.setScalar(cassetteScale * (0.78 + appearanceEase * 0.22) * hoverScale);
        let targetRotationX = 0;
        let targetRotationY = cassetteAngles[index] + Math.sin(time * 0.0007 + index) * 0.006;
        if (cassette.classList.contains("is-dragging")) {
          targetRotationX = Math.PI / 2;
          targetRotationY = 0.52;
        } else if (cassette.classList.contains("is-settling")) {
          const settleProgress = Number(cassette.dataset.settleProgress || 0);
          targetRotationX = Math.PI / 2 * (1 - settleProgress);
          targetRotationY = 0.52 + (cassetteAngles[index] - 0.52) * settleProgress;
        }
        object.rotation.x = THREE.MathUtils.lerp(object.rotation.x, targetRotationX, rotationSmoothing);
        object.rotation.y = THREE.MathUtils.lerp(object.rotation.y, targetRotationY, rotationSmoothing);
        object.rotation.z = THREE.MathUtils.lerp(object.rotation.z, 0, rotationSmoothing);
    });
    renderer.render(scene, camera);
    if (isVisible) requestAnimationFrame(render);
  }

  // Same reasoning as television.js: this renderer has no business drawing
  // 60 frames a second while the cassette stack is scrolled off-screen.
  let isVisible = true;
  onVisibilityChange(stage, (visible) => {
    const wasVisible = isVisible;
    isVisible = visible;
    if (visible && !wasVisible) requestAnimationFrame(render);
  });

  function reveal(index) {
    const model = modelObjects.find((entry) => entry.index === index);
    if (model) model.appearanceStartedAt = performance.now();
  }

  resize();
  window.addEventListener("resize", resize);
  requestAnimationFrame(render);

  return { reveal };
}
