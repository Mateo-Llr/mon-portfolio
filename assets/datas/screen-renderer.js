const SCREEN_WIDTH = 960;
const SCREEN_HEIGHT = 540;

function cleanText(value = "") {
  return value.replace(/<[^>]+>/g, "").replaceAll("&nbsp;", " ").trim();
}

function wrapText(context, text, maxWidth) {
  const lines = [];
  let line = "";
  text.split(/\s+/).forEach((word) => {
    const candidate = `${line} ${word}`.trim();
    if (line && context.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  });
  if (line) lines.push(line);
  return lines;
}

function drawBadge(context, text, x, y, color = "#4fc1bb") {
  context.font = "500 12px 'DM Mono', monospace";
  const width = context.measureText(text).width + 22;
  context.strokeStyle = color;
  context.lineWidth = 1.2;
  context.strokeRect(x, y - 16, width, 28);
  context.fillStyle = color;
  context.fillText(text, x + 11, y + 3);
  return x + width + 10;
}

export function drawProjectScreen(canvas, project, index, isEjected = false, requestedScale = 1) {
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
  context.save();
  context.fillStyle = "#0f1c1a";
  context.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);

  context.strokeStyle = "rgba(93, 169, 163, .12)";
  context.lineWidth = 1;
  for (let x = 0; x <= SCREEN_WIDTH; x += 52) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, SCREEN_HEIGHT);
    context.stroke();
  }
  for (let y = 0; y <= SCREEN_HEIGHT; y += 52) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(SCREEN_WIDTH, y);
    context.stroke();
  }

  const layoutScale = Math.min(1, Math.max(0.72, requestedScale));
  context.save();
  context.translate((SCREEN_WIDTH - SCREEN_WIDTH * layoutScale) / 2, (SCREEN_HEIGHT - SCREEN_HEIGHT * layoutScale) / 2);
  context.scale(layoutScale, layoutScale);

  if (isEjected) {
    context.fillStyle = "#b9e8dc";
    context.font = "400 58px 'Bebas Neue', sans-serif";
    context.fillText("SIGNAL", 82, 160);
    context.fillText("PAUSE", 82, 216);
    context.fillStyle = "#90aaa4";
    context.font = "400 18px 'Space Grotesk', sans-serif";
    context.fillText("Insérez une cassette pour découvrir un projet.", 82, 284);
  } else {
    context.fillStyle = "#91aaa4";
    context.font = "500 13px 'DM Mono', monospace";
    context.fillText(project.date || `ARCHIVE / 0${index + 1}`, 82, 52);
    context.fillText("FERMER  X", 782, 52);

    context.fillStyle = "#b9e8dc";
    context.shadowColor = "rgba(185, 232, 220, .25)";
    context.shadowBlur = 8;
    context.font = "400 68px 'Bebas Neue', sans-serif";
    const title = project.title.replace("<br>", "\n").split("\n");
    title.forEach((line, lineIndex) => context.fillText(line, 82, 150 + lineIndex * 62));
    context.shadowBlur = 0;

    const toolsMatch = project.projectMeta?.match(/sheet-tools">([\s\S]*?)<\/div><div class="sheet-tags/);
    const tools = toolsMatch ? [...toolsMatch[1].matchAll(/<span>(.*?)<\/span>/g)].map((match) => cleanText(match[1])) : [];
    const tags = [...(project.projectMeta || "").matchAll(/sheet-tags">(.*?)<\/div>/g)].flatMap((match) => [...match[1].matchAll(/<span>(.*?)<\/span>/g)].map((tag) => cleanText(tag[1])));
    let badgeX = 500;
    tools.forEach((tool) => {
      badgeX = drawBadge(context, tool, badgeX, 126, "#b9e8dc");
    });
    badgeX = 500;
    tags.slice(0, 4).forEach((tag) => {
      badgeX = drawBadge(context, tag, badgeX, 164, "#4fc1bb");
      if (badgeX > 900) badgeX = 570;
    });

    context.fillStyle = "#eee9d8";
    context.font = "500 24px 'Space Grotesk', sans-serif";
    wrapText(context, project.lead || project.description, 820).slice(0, 2).forEach((line, lineIndex) => {
      context.fillText(line, 82, 274 + lineIndex * 28);
    });

    const sections = [...(project.content || "").matchAll(/<h3>(.*?)<\/h3>\s*<p>(.*?)<\/p>/g)].slice(0, 2);
    let sectionX = 82;
    sections.forEach(([fullMatch, heading, body]) => {
      context.fillStyle = "#4fc1bb";
      context.font = "500 12px 'DM Mono', monospace";
      context.fillText(cleanText(heading), sectionX, 348);
      context.fillStyle = "#aabbb3";
      context.font = "400 15px 'Space Grotesk', sans-serif";
      wrapText(context, cleanText(body), 380).slice(0, 4).forEach((line, lineIndex) => {
        context.fillText(line, sectionX, 374 + lineIndex * 18);
      });
      sectionX = 500;
    });
  }

  context.restore();
  context.globalCompositeOperation = "screen";
  context.globalAlpha = 0.14;
  context.fillStyle = "#b8c39d";
  const scanOffset = Math.floor(Date.now() / 90) % 6;
  for (let y = scanOffset; y < SCREEN_HEIGHT; y += 6) context.fillRect(0, y, SCREEN_WIDTH, 2);
  context.globalCompositeOperation = "source-over";
  context.globalAlpha = 1;
  const vignette = context.createRadialGradient(SCREEN_WIDTH / 2, SCREEN_HEIGHT / 2, SCREEN_WIDTH * 0.18, SCREEN_WIDTH / 2, SCREEN_HEIGHT / 2, SCREEN_WIDTH * 0.72);
  vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
  vignette.addColorStop(1, "rgba(0, 0, 0, .55)");
  context.fillStyle = vignette;
  context.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
  context.restore();
}
