const projects = [
  { title: "SOUL<br>FRACT", meta: "JEU VIDÉO + C# / .NET&nbsp;&nbsp; / &nbsp;&nbsp;2025—", description: "Un projet de jeu de rêve développé chaque semaine depuis 2023.", lead: "Soulfract est mon projet le plus important : un jeu de survie, d'exploration et de création que je développe progressivement sans moteur de jeu, avec C# et .NET.", content: "<p>Soulfract est une idée née en 2023 sur Scratch. Ce premier prototype m'a initié à la logique informatique et à la création de jeux. En 2025, le projet a évolué vers C# et .NET, sans moteur de jeu.</p><h3>Un projet au long cours</h3><p>J'avance sur Soulfract de façon hebdomadaire. Le projet me permet d'expérimenter, de progresser en programmation et de transformer progressivement une idée de jeu de rêve en réalisation concrète.</p><h3>Compétences mobilisées</h3><p>Analyser un besoin et définir des objectifs ; concevoir l'architecture d'un projet ; programmer en C# et .NET ; gérer un projet dans la durée ; effectuer une veille et m'autoformer.</p><h3>Suite du parcours</h3><p>De petits projets en développement web et en game dev seront ajoutés ici et publiés sur GitHub au fil de leur avancement.</p>" },
  { title: "PARCOURS<br>SLAM", meta: "FORMATION + OBJECTIF&nbsp;&nbsp; / &nbsp;&nbsp;2026", description: "Première année de BTS SIO option SLAM, en Centre-Val-de-Loire.", lead: "Un parcours en construction vers le métier de développeur informatique, avec une sensibilité particulière pour le game dev.", content: "<p>Je suis actuellement en première année de BTS SIO option SLAM, après un baccalauréat général obtenu avec mention assez bien.</p><h3>Mon profil</h3><p>Je suis créatif, investi, organisé et à l'aise dans le travail en équipe. J'aime le développement web et le game dev, et je souhaite devenir développeur informatique.</p><h3>Environnement de travail</h3><p>J'utilise principalement VS Code et Notepad++ pour apprendre, expérimenter et développer.</p>" },
  { title: "SOUL<br>FRACT", meta: "JEU VIDÉO + UNIVERS&nbsp;&nbsp; / &nbsp;&nbsp;2025", description: "Un jeu de survie et d'exploration où chaque âme porte la mémoire d'un autre monde.", lead: "Soulfract est un jeu de survie, d'exploration et de création dans un monde où les âmes voyagent entre les étoiles.", content: "<p>Les étoiles produisent des âmes, fragments d'une Lumière Primordiale. Lorsqu'une âme trouve un corps, elle se fond à lui et laisse une marque qui influence sa trajectoire.</p><h3>Un monde à choisir</h3><p>Le joueur se réveille dans un corps étranger, avec des souvenirs incomplets. Il peut protéger les âmes, traquer les Ombres, étudier les fusions ou chercher sa propre mission.</p><h3>La fracture</h3><p>Certains êtres abritent plusieurs âmes. Cette puissance exceptionnelle a un prix : l'instabilité, les voix et le risque de devenir une Ombre. Le monde change selon les choix du joueur.</p><div class=\"sheet-tags\"><span>EXPLORATION</span><span>SURVIE</span><span>LORE</span><span>CRÉATION</span></div>" }
];

projects[2] = {
  title: "VEILLE<br>À VENIR",
  meta: "VEILLE TECHNOLOGIQUE&nbsp;&nbsp; / &nbsp;&nbsp;À COMPLÉTER",
  description: "Une rubrique dédiée au développement web et au game dev sera bientôt ajoutée.",
  lead: "Ma veille accompagnera ma progression en développement web et en création de jeux.",
  content: "<p>Cette rubrique sera complétée au fil de ma formation avec des articles, des sources vérifiées et des notes personnelles.</p><h3>Thèmes suivis</h3><p>Développement web et game dev.</p><h3>Sources</h3><p>Les sources de veille sont encore à définir. Elles seront sélectionnées et comparées avant d'être ajoutées au portfolio.</p><div class=\"sheet-tags\"><span>WEB</span><span>GAME DEV</span><span>VEILLE</span><span>À COMPLÉTER</span></div>"
};

const DESIGN_WIDTH = 1280;
const DESIGN_HEIGHT = 720;

function resizeDesignCanvas() {
  const scale = Math.min(window.innerWidth / DESIGN_WIDTH, window.innerHeight / DESIGN_HEIGHT);
  document.documentElement.style.setProperty("--design-scale", scale.toString());
}

resizeDesignCanvas();
window.addEventListener("resize", resizeDesignCanvas);

const projectSheet = document.querySelector("#projectSheet");
const sheetKicker = document.querySelector("#sheetKicker");
const sheetIndex = document.querySelector("#sheetIndex");
const sheetTitle = document.querySelector("#sheetTitle");
const sheetMeta = document.querySelector("#sheetMeta");
const sheetLead = document.querySelector("#sheetLead");
const sheetContent = document.querySelector("#sheetContent");
const wallCopy = document.querySelector(".wall-copy");

let roomScene = {
  updateScreen() {},
  setCassetteInserted() {},
  setCassetteSelectHandler() {},
  setTelevisionHandler() {},
  setTelevisionActionHandler() {},
  onProjectsFocusReached() {},
  activateTelevisionFeatures() {},
  setCupHandler() {},
  setLaptopHandler() {},
  setReturnHandler() {},
  setProjectsHandler() {},
  focusOnProjects() {},
  focusOnInitialView() {},
  focusOnAchievements() {},
  focusOnCameraIndex() {}
};

function startWallCopyAnimation() {
  if (!wallCopy || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const textNodes = [];
  const walker = document.createTreeWalker(wallCopy, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_SKIP;
      if (parent.closest("em")) return NodeFilter.FILTER_REJECT;
      return node.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    }
  });

  let currentNode = walker.nextNode();
  while (currentNode) {
    textNodes.push(currentNode);
    currentNode = walker.nextNode();
  }

  let characterIndex = 0;
  textNodes.forEach((textNode) => {
    const fragment = document.createDocumentFragment();
    textNode.textContent.split(/(\s+)/).forEach((token) => {
      if (/^\s+$/.test(token)) {
        [...token].forEach((character) => {
          const span = document.createElement("span");
          span.className = "typewriter-character is-space";
          span.textContent = character;
          span.style.setProperty("--character-delay", `${characterIndex * 24}ms`);
          fragment.appendChild(span);
          characterIndex += 1;
        });
        return;
      }

      if (!token) return;
      const word = document.createElement("span");
      word.className = "typewriter-word";
      [...token].forEach((character) => {
        const span = document.createElement("span");
        span.className = "typewriter-character";
        span.textContent = character;
        span.style.setProperty("--character-delay", `${characterIndex * 24}ms`);
        word.appendChild(span);
        characterIndex += 1;
      });
      fragment.appendChild(word);
    });
    textNode.replaceWith(fragment);
  });

  wallCopy.classList.add("is-typing");
}

let insertedCassetteIndex = null;

async function scheduleThreeSceneInitialization() {
  try {
    const { createRoomScene } = await import("./assets/datas/room.js");
    roomScene = createRoomScene(document.querySelector("#roomModel"), projects);
    roomScene.setTelevisionHandler(() => roomScene.focusOnProjects());
    roomScene.setTelevisionActionHandler(() => roomScene.focusOnProjects());
    roomScene.onProjectsFocusReached(() => roomScene.activateTelevisionFeatures());
    roomScene.setCassetteSelectHandler((index) => selectProject(index));
    roomScene.setCupHandler(() => roomScene.focusOnProjects());
    roomScene.setLaptopHandler(() => roomScene.focusOnCameraIndex(5));
    roomScene.setReturnHandler(() => roomScene.focusOnInitialView());
    roomScene.setProjectsHandler(() => roomScene.focusOnAchievements());
    roomScene.updateScreen(projects[0], true);
  } catch (error) {
    console.error("Impossible de charger la scène 3D.", error);
  }
}

requestAnimationFrame(() => requestAnimationFrame(scheduleThreeSceneInitialization));
startWallCopyAnimation();

function selectProject(index, openSheet = true) {
  const project = projects[index];
  if (!project) return;

  if (insertedCassetteIndex !== null && insertedCassetteIndex !== index) {
    roomScene.setCassetteInserted?.(insertedCassetteIndex, false);
  }

  roomScene.setCassetteInserted?.(index, true);
  roomScene.updateScreen?.(project, false);
  insertedCassetteIndex = index;

  if (openSheet) openProjectSheet(index);
}

function openProjectSheet(index) {
  const project = projects[index];
  if (!project) return;

  sheetKicker.textContent = `ARCHIVE / 0${index + 1}`;
  sheetIndex.textContent = `PROJECT 0${index + 1}`;
  sheetTitle.innerHTML = project.title;
  sheetMeta.innerHTML = project.meta;
  sheetLead.textContent = project.lead;
  sheetContent.innerHTML = project.content;
  projectSheet.classList.add("is-visible");
  projectSheet.setAttribute("aria-hidden", "false");
  document.body.classList.add("is-sheet-open");
}

function closeProjectSheet() {
  projectSheet.classList.remove("is-visible");
  projectSheet.setAttribute("aria-hidden", "true");
  document.body.classList.remove("is-sheet-open");
}

document.querySelectorAll("[data-close-sheet]").forEach((element) => {
  element.addEventListener("click", closeProjectSheet);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeProjectSheet();
});