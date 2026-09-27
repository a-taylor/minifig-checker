"use strict";

// Codes are the first field of the box's Data Matrix (e.g. "6627610 333S6 16536051 008506"),
// which identifies the figure. The last field is a per-box serial and is ignored.
const STORAGE_KEY = "minifig-checker-v2";

const SEED = {
  series: "71053 Shrek",
  figures: [
    ["Thelonious"],
    ["Puss in Boots", "6627610"],
    ["Gingy"],
    ["Shrek"],
    ["Dragon"],
    ["Fiona and Donkey"],
    ["Merlin"],
    ["Pinocchio"],
    ["Big Bad Wolf", "6627609"],
    ["Lord Farquaad"],
    ["Fairy Godmother"],
    ["Prince Charming", "6627616"],
  ].map(([name, code], i) => ({ id: i + 1, name, owned: false, codes: code ? [code] : [] })),
};

// ---------- State ----------

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* fall through to seed */ }
  return structuredClone(SEED);
}

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  render();
}

function figureForCode(code) {
  return state.figures.find((f) => f.codes.includes(code));
}

function assignCode(code, figure) {
  for (const f of state.figures) f.codes = f.codes.filter((c) => c !== code);
  figure.codes.push(code);
}

// ---------- Rendering ----------

const $ = (sel) => document.querySelector(sel);

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function render() {
  const owned = state.figures.filter((f) => f.owned).length;
  $("#series-title").textContent = state.series;
  $("#progress").textContent = `${owned}/${state.figures.length}`;

  const list = $("#figure-list");
  list.replaceChildren(...state.figures.map((f) => {
    const box = el("input", { type: "checkbox", checked: f.owned });
    box.addEventListener("change", () => { f.owned = box.checked; save(); });

    const codes = f.codes.length
      ? el("div", { className: "codes" }, ...f.codes.map((c) => {
          const x = el("button", { textContent: "×", ariaLabel: `Remove code ${c}` });
          x.addEventListener("click", () => {
            if (confirm(`Remove code ${c} from ${f.name}?`)) {
              f.codes = f.codes.filter((k) => k !== c);
              save();
            }
          });
          return el("span", { className: "chip" }, c, x);
        }))
      : el("div", { className: "no-codes", textContent: "No box code known yet" });

    return el("li", { className: "figure" + (f.owned ? " owned" : "") },
      box,
      el("div", { className: "figure-body" }, el("div", { className: "figure-name", textContent: f.name }), codes));
  }));
}

// ---------- Tabs ----------

function showView(name) {
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === `view-${name}`));
  document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
  if (name === "scan") startCamera(); else stopCamera();
}

document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => showView(b.dataset.view)));

// ---------- Result panel ----------

function extractCode(text) {
  const m = text.match(/\b\d{7}\b/);
  return m ? m[0] : null;
}

function button(label, cls, onClick) {
  const b = el("button", { textContent: label, className: cls || "" });
  b.addEventListener("click", onClick);
  return b;
}

function showResult(code, raw) {
  const fig = figureForCode(code);
  const banner = $("#result-banner");
  const actions = [];

  if (fig && !fig.owned) {
    banner.className = "banner need";
    banner.textContent = "NEED IT";
    $("#result-name").textContent = fig.name;
    actions.push(button("I bought it", "good", () => { fig.owned = true; save(); showResult(code, raw); }));
  } else if (fig) {
    banner.className = "banner got";
    banner.textContent = "GOT IT";
    $("#result-name").textContent = fig.name;
  } else {
    banner.className = "banner unknown";
    banner.textContent = "UNKNOWN";
    $("#result-name").textContent = "Code not seen before";
    actions.push(button("I bought it – pick figure", "good", () => pickFigure(code, true, raw)));
    actions.push(button("Identify without buying", "secondary", () => pickFigure(code, false, raw)));
  }

  $("#result-code").textContent = `Figure code ${code}`;
  actions.push(button("Scan next box", "", () => { hideResult(); resumeScanning(); }));
  $("#result-actions").replaceChildren(...actions);
  $("#result").classList.remove("hidden");
  $("#result").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function showUnreadable(raw) {
  const banner = $("#result-banner");
  banner.className = "banner unknown";
  banner.textContent = "NO CODE";
  $("#result-name").textContent = "Not a minifig box code";
  $("#result-code").textContent = `Scanned “${raw}”`;
  $("#result-actions").replaceChildren(button("Scan again", "", () => { hideResult(); resumeScanning(); }));
  $("#result").classList.remove("hidden");
}

function hideResult() {
  $("#result").classList.add("hidden");
}

function pickFigure(code, bought, raw) {
  const dlg = $("#picker");
  $("#picker-title").textContent = bought ? "Which figure was in the box?" : "Which figure is this code?";
  $("#picker-list").replaceChildren(...state.figures.map((f) =>
    button(f.name, f.owned ? "owned" : "", () => {
      assignCode(code, f);
      if (bought) f.owned = true;
      save();
      dlg.close();
      showResult(code, raw);
    })));
  dlg.showModal();
}

$("#picker-cancel").addEventListener("click", () => $("#picker").close());

$("#photo-input").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  pauseScanning();
  hideResult();
  setCameraMsg("Reading photo…");
  const results = await ZXingWASM.readBarcodes(file, { formats: ["DataMatrix"], tryHarder: true, maxNumberOfSymbols: 1 });
  setCameraMsg("Tap to scan another");
  if (!results.length) { showUnreadable("nothing — try a closer, sharper photo"); return; }
  const code = extractCode(results[0].text);
  if (code) showResult(code, results[0].text); else showUnreadable(results[0].text);
});

// ---------- Camera + scanning ----------

const video = $("#video");
const canvas = document.createElement("canvas");
const ctx = canvas.getContext("2d", { willReadFrequently: true });
let stream = null;
let scanning = false;
let paused = false;

ZXingWASM.prepareZXingModule({
  overrides: { locateFile: (path, prefix) => (path.endsWith(".wasm") ? "vendor/" + path : prefix + path) },
});

function setCameraMsg(text) {
  const m = $("#camera-msg");
  m.textContent = text;
  m.hidden = !text;
}

async function startCamera() {
  if (stream) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    setCameraMsg("Camera not available — type the code below");
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
    setCameraMsg("Point at the square code on the bottom of the box");
    scanning = true;
    if (!paused) scanLoop();
  } catch (e) {
    stream = null;
    setCameraMsg("Tap to start camera");
  }
}

function stopCamera() {
  scanning = false;
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
  video.srcObject = null;
}

function pauseScanning() { paused = true; }

function resumeScanning() {
  paused = false;
  if (stream) {
    setCameraMsg("Point at the square code on the bottom of the box");
    scanLoop();
  } else {
    startCamera();
  }
}

$(".camera").addEventListener("click", () => {
  if (!stream) startCamera();
  else if (paused) { hideResult(); resumeScanning(); }
});

let loopRunning = false;

async function scanLoop() {
  if (loopRunning) return;
  loopRunning = true;
  $(".camera").classList.add("scanning");
  try {
    while (scanning && !paused) {
      const text = await scanFrame();
      if (text && scanning && !paused) {
        paused = true;
        setCameraMsg("Tap to scan another");
        if (navigator.vibrate) navigator.vibrate(80);
        const code = extractCode(text);
        if (code) showResult(code, text); else showUnreadable(text);
      }
      await new Promise((r) => setTimeout(r, 120));
    }
  } finally {
    $(".camera").classList.remove("scanning");
    loopRunning = false;
  }
}

async function scanFrame() {
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return null;
  // Crop the centre square (matches what the user sees) and cap its size for speed.
  const side = Math.min(vw, vh);
  const out = Math.min(side, 1000);
  canvas.width = canvas.height = out;
  ctx.drawImage(video, (vw - side) / 2, (vh - side) / 2, side, side, 0, 0, out, out);
  const results = await ZXingWASM.readBarcodes(ctx.getImageData(0, 0, out, out), {
    formats: ["DataMatrix"],
    tryHarder: true,
    maxNumberOfSymbols: 1,
  });
  return results.length ? results[0].text : null;
}

// ---------- Settings ----------

$("#btn-clear").addEventListener("click", () => {
  if (!confirm("Mark every figure as not owned?")) return;
  state.figures.forEach((f) => { f.owned = false; });
  save();
});

$("#btn-new-series").addEventListener("click", () => {
  const name = $("#new-series-name").value.trim();
  const names = $("#new-series-figs").value.split("\n").map((s) => s.trim()).filter(Boolean);
  if (!name || names.length === 0) { alert("Enter a series name and at least one figure."); return; }
  if (!confirm(`Replace ${state.series} with ${name} (${names.length} figures)? All current figures and codes will be deleted.`)) return;
  state = { series: name, figures: names.map((n, i) => ({ id: i + 1, name: n, owned: false, codes: [] })) };
  $("#new-series-name").value = "";
  $("#new-series-figs").value = "";
  save();
  showView("collection");
});

$("#btn-export").addEventListener("click", async () => {
  const json = JSON.stringify(state, null, 2);
  const filename = `minifigs-${state.series.replace(/[^\w-]+/g, "-")}.json`;
  const file = new File([json], filename, { type: "application/json" });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return; } catch (e) { if (e.name === "AbortError") return; }
  }
  const a = el("a", { href: URL.createObjectURL(file), download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

$("#import-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (typeof data.series !== "string" || !Array.isArray(data.figures)) throw new Error("bad shape");
    if (!confirm(`Replace current data with ${data.series} from the file?`)) return;
    state = data;
    save();
    showView("collection");
  } catch (err) {
    alert("That file isn't a Minifig Checker backup.");
  }
});

// ---------- Boot ----------

const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;

function fitHeight() {
  // Only needed as a home-screen app, where iOS may under-report the viewport height.
  if (standalone && innerHeight < screen.height) {
    document.documentElement.style.setProperty("--app-h", `${screen.height}px`);
  }
}

async function showAbout() {
  const keys = "caches" in window ? await caches.keys() : [];
  const version = keys.map((k) => k.replace("minifig-checker-", "")).sort().pop() || "dev";
  $("#about").textContent =
    `Version ${version} · screen ${screen.height}pt · viewport ${innerHeight}pt${standalone ? " · home screen" : ""}`;
}

render();
fitHeight();
showAbout();

if ("serviceWorker" in navigator) {
  // Reload once when an updated service worker takes over, so updates show on the next open
  // rather than the one after. Skipped on first install, when there was no controller.
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (hadController && !reloading) { reloading = true; location.reload(); }
  });

  navigator.serviceWorker.register("sw.js").then((reg) => {
    // iOS often resumes the app instead of relaunching it, so check for updates on resume too.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") reg.update().catch(() => {});
    });
  }).catch(() => {});
}
