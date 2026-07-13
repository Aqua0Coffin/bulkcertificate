/* ===========================================================
   Bulk Certificate Generator
   Vanilla JS, HTML5 Canvas rendering, no backend.
   One dynamic variable only: the participant's name.
   =========================================================== */

(function () {
  "use strict";

  /* ---------------------------------------------------------
     1. Font catalogue
     Google Sans cannot be legally bundled via Google Fonts,
     so the default falls back to Inter Medium as instructed.
     --------------------------------------------------------- */
  const FONT_OPTIONS = [
    { value: "Inter",            label: "Inter (default)", stack: '"Inter", sans-serif' },
    { value: "Poppins",          label: "Poppins",          stack: '"Poppins", sans-serif' },
    { value: "Roboto",           label: "Roboto",           stack: '"Roboto", sans-serif' },
    { value: "Open Sans",        label: "Open Sans",        stack: '"Open Sans", sans-serif' },
    { value: "Montserrat",       label: "Montserrat",       stack: '"Montserrat", sans-serif' },
    { value: "Lato",             label: "Lato",             stack: '"Lato", sans-serif' },
    { value: "Nunito",           label: "Nunito",           stack: '"Nunito", sans-serif' },
    { value: "Playfair Display", label: "Playfair Display", stack: '"Playfair Display", serif' },
    { value: "Merriweather",     label: "Merriweather",     stack: '"Merriweather", serif' },
    { value: "Raleway",          label: "Raleway",          stack: '"Raleway", sans-serif' },
    { value: "Oswald",           label: "Oswald",           stack: '"Oswald", sans-serif' }
  ];

  const ZOOM_PRESETS = [25, 50, 75, 100, 150, 200];
  const SNAP_THRESHOLD_SCREEN_PX = 9; // snap sensitivity, measured in on-screen pixels

  /* ---------------------------------------------------------
     2. Application state
     --------------------------------------------------------- */
  const state = {
    image: null,
    naturalWidth: 0,
    naturalHeight: 0,
    zoom: 100,

    text: {
      x: 0,
      y: 0,
      align: "center",
      fontFamily: "Inter",
      fontSize: 64,
      fontWeight: 500,
      color: "#1F2421",
      opacity: 100,
      letterSpacing: 0
    },

    selected: false,
    dragging: false,
    snap: { x: false, y: false },

    names: [],
    generated: [], // { name, filename, blob }
    casing: "as-entered" // 'as-entered' | 'title' | 'upper' | 'lower'
  };

  /* ---------------------------------------------------------
     3. DOM references
     --------------------------------------------------------- */
  const dom = {
    headerStatus: document.getElementById("headerStatus"),

    fileInput: document.getElementById("fileInput"),
    uploadZone: document.getElementById("uploadZone"),
    uploadFilename: document.getElementById("uploadFilename"),

    fontFamily: document.getElementById("fontFamily"),
    fontSize: document.getElementById("fontSize"),
    fontSizeValue: document.getElementById("fontSizeValue"),
    fontWeight: document.getElementById("fontWeight"),
    fontColor: document.getElementById("fontColor"),
    fontColorHex: document.getElementById("fontColorHex"),
    opacity: document.getElementById("opacity"),
    opacityValue: document.getElementById("opacityValue"),
    letterSpacing: document.getElementById("letterSpacing"),
    letterSpacingValue: document.getElementById("letterSpacingValue"),

    alignGroup: document.getElementById("alignGroup"),
    centerPositionBtn: document.getElementById("centerPositionBtn"),

    namesInput: document.getElementById("namesInput"),
    namesCount: document.getElementById("namesCount"),
    casingGroup: document.getElementById("casingGroup"),

    generateBtn: document.getElementById("generateBtn"),
    progressWrap: document.getElementById("progressWrap"),
    progressFill: document.getElementById("progressFill"),
    progressLabel: document.getElementById("progressLabel"),
    downloadRow: document.getElementById("downloadRow"),
    downloadIndividualBtn: document.getElementById("downloadIndividualBtn"),
    downloadZipBtn: document.getElementById("downloadZipBtn"),

    zoomGroup: document.getElementById("zoomGroup"),
    coordReadout: document.getElementById("coordReadout"),

    canvasPlaceholder: document.getElementById("canvasPlaceholder"),
    canvasStack: document.getElementById("canvasStack"),
    previewCanvas: document.getElementById("previewCanvas"),
    overlayCanvas: document.getElementById("overlayCanvas"),
    stageCanvasWrap: document.getElementById("stageCanvasWrap"),

    localFontInput: document.getElementById("localFontInput"),
    localFontChip:  document.getElementById("localFontChip")
  };

  const previewCtx = dom.previewCanvas.getContext("2d");
  const overlayCtx = dom.overlayCanvas.getContext("2d");

  // Off-screen canvas used purely for text measurement, kept in sync
  // with the active typography settings before every measurement call.
  const measureCanvas = document.createElement("canvas");
  const measureCtx = measureCanvas.getContext("2d");

  /* ---------------------------------------------------------
     4. Font helpers
     --------------------------------------------------------- */
  function fontStackFor(value) {
    const match = FONT_OPTIONS.find((f) => f.value === value);
    return match ? match.stack : '"Inter", sans-serif';
  }

  function cssFontString(textState) {
    return `${textState.fontWeight} ${textState.fontSize}px ${fontStackFor(textState.fontFamily)}`;
  }

  function populateFontDropdown() {
    FONT_OPTIONS.forEach((f) => {
      const opt = document.createElement("option");
      opt.value = f.value;
      opt.textContent = f.label;
      opt.style.fontFamily = f.stack;
      dom.fontFamily.appendChild(opt);
    });
    dom.fontFamily.value = state.text.fontFamily;
  }

  async function ensureFontReady(textState) {
    try {
      await document.fonts.load(cssFontString(textState));
    } catch (err) {
      // Fall through silently — canvas will fall back to a default glyph
      // rather than block rendering on a font loading hiccup.
    }
  }

  /* ---------------------------------------------------------
     5. Text measuring + drawing
     A single function draws the name for both the live preview
     and the final export, so what you see is what you get.
     --------------------------------------------------------- */
  function getCharWidths(ctx, text) {
    return Array.from(text).map((ch) => ctx.measureText(ch).width);
  }

  function measureSpacedWidth(ctx, text, letterSpacing) {
    const chars = Array.from(text);
    if (chars.length === 0) return 0;
    const widths = getCharWidths(ctx, text);
    const total = widths.reduce((sum, w) => sum + w, 0);
    return total + letterSpacing * (chars.length - 1);
  }

  /**
   * Draws `text` onto `ctx` anchored at (x, y) according to `textState`.
   * Returns the rendered bounding box in the same coordinate space,
   * used for the selection box and hit testing.
   */
  function drawNameOnCanvas(ctx, text, textState, x, y) {
    ctx.save();
    ctx.font = cssFontString(textState);
    ctx.fillStyle = textState.color;
    ctx.globalAlpha = textState.opacity / 100;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";

    const chars = Array.from(text);
    const widths = getCharWidths(ctx, text);
    const totalWidth = widths.reduce((s, w) => s + w, 0) + textState.letterSpacing * Math.max(chars.length - 1, 0);

    let startX;
    if (textState.align === "left") startX = x;
    else if (textState.align === "right") startX = x - totalWidth;
    else startX = x - totalWidth / 2;

    let cx = startX;
    chars.forEach((ch, i) => {
      ctx.fillText(ch, cx, y);
      cx += widths[i] + textState.letterSpacing;
    });

    ctx.restore();

    const height = textState.fontSize * 1.3;
    return {
      x: startX,
      y: y - height / 2,
      width: totalWidth,
      height
    };
  }

  function measureNameBox(text, textState) {
    measureCtx.font = cssFontString(textState);
    const totalWidth = measureSpacedWidth(measureCtx, text, textState.letterSpacing);
    const height = textState.fontSize * 1.3;

    let startX;
    if (textState.align === "left") startX = textState.x;
    else if (textState.align === "right") startX = textState.x - totalWidth;
    else startX = textState.x - totalWidth / 2;

    return { x: startX, y: textState.y - height / 2, width: totalWidth, height };
  }

  /* Applies the active casing mode to a single name string. */
  function applyCase(name) {
    switch (state.casing) {
      case "title":
        // Capitalise the first letter of every whitespace-separated word.
        return name.replace(/\S+/g, (w) =>
          w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
        );
      case "upper":
        return name.toUpperCase();
      case "lower":
        return name.toLowerCase();
      default: // 'as-entered'
        return name;
    }
  }

  function getPreviewName() {
    const raw = state.names.length > 0 ? state.names[0] : "John Doe";
    return applyCase(raw);
  }

  /* ---------------------------------------------------------
     6. Canvas + image setup
     --------------------------------------------------------- */
  function loadImageFile(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = (err) => {
        URL.revokeObjectURL(url);
        reject(err);
      };
      img.src = url;
    });
  }

  async function handleFile(file) {
    if (!file || !/^image\/(png|jpe?g)$/.test(file.type)) {
      alert("Please upload a PNG or JPG image.");
      return;
    }

    let img;
    try {
      img = await loadImageFile(file);
    } catch (err) {
      alert("That image could not be loaded. Please try a different file.");
      return;
    }

    state.image = img;
    state.naturalWidth = img.naturalWidth;
    state.naturalHeight = img.naturalHeight;

    // Reset the name to a centered anchor on every new upload.
    state.text.x = state.naturalWidth / 2;
    state.text.y = state.naturalHeight / 2;
    state.selected = false;

    // Clear any certificates generated against a previous template.
    state.generated = [];
    dom.downloadRow.hidden = true;
    dom.progressWrap.hidden = true;

    dom.uploadFilename.hidden = false;
    dom.uploadFilename.textContent = `${file.name} — ${state.naturalWidth}×${state.naturalHeight}px`;
    dom.headerStatus.textContent = `${state.naturalWidth}×${state.naturalHeight}px template loaded`;

    dom.canvasPlaceholder.hidden = true;
    dom.canvasStack.hidden = false;

    dom.previewCanvas.width = state.naturalWidth;
    dom.previewCanvas.height = state.naturalHeight;
    dom.overlayCanvas.width = state.naturalWidth;
    dom.overlayCanvas.height = state.naturalHeight;

    applyZoom(computeFitZoom());
    await renderPreview();
    renderOverlay();
    updateGenerateAvailability();
  }

  function computeFitZoom() {
    const wrap = dom.stageCanvasWrap;
    const availW = wrap.clientWidth - 72; // account for stage padding
    const availH = wrap.clientHeight - 72;
    if (availW <= 0 || availH <= 0) return 100;

    const fitPercent = Math.min(
      (availW / state.naturalWidth) * 100,
      (availH / state.naturalHeight) * 100,
      200
    );

    // Snap down to the closest preset that does not exceed the fit size,
    // so the whole certificate is visible without scrolling by default.
    let best = ZOOM_PRESETS[0];
    ZOOM_PRESETS.forEach((p) => {
      if (p <= fitPercent) best = p;
    });
    return best;
  }

  function applyZoom(percent) {
    state.zoom = percent;
    const w = (state.naturalWidth * percent) / 100;
    const h = (state.naturalHeight * percent) / 100;
    dom.canvasStack.style.width = `${w}px`;
    dom.canvasStack.style.height = `${h}px`;

    Array.from(dom.zoomGroup.children).forEach((btn) => {
      btn.classList.toggle("is-active", Number(btn.dataset.zoom) === percent);
    });
  }

  /* ---------------------------------------------------------
     7. Rendering
     --------------------------------------------------------- */
  let renderToken = 0;

  async function renderPreview() {
    if (!state.image) return;
    const myToken = ++renderToken;

    await ensureFontReady(state.text);
    if (myToken !== renderToken) return; // a newer render superseded this one

    previewCtx.clearRect(0, 0, dom.previewCanvas.width, dom.previewCanvas.height);
    previewCtx.drawImage(state.image, 0, 0, state.naturalWidth, state.naturalHeight);
    drawNameOnCanvas(previewCtx, getPreviewName(), state.text, state.text.x, state.text.y);
  }

  let renderScheduled = false;
  function scheduleRender() {
    if (renderScheduled) return;
    renderScheduled = true;
    requestAnimationFrame(() => {
      renderScheduled = false;
      renderPreview();
    });
  }

  function renderOverlay() {
    if (!state.image) return;
    overlayCtx.clearRect(0, 0, dom.overlayCanvas.width, dom.overlayCanvas.height);

    const box = measureNameBox(getPreviewName(), state.text);
    const pad = Math.max(state.text.fontSize * 0.18, 8);

    // Snap guides — drawn full-bleed across the certificate while dragging.
    if (state.dragging) {
      overlayCtx.save();
      overlayCtx.strokeStyle = "#B07F2A";
      overlayCtx.setLineDash([state.naturalWidth * 0.004 + 4, state.naturalWidth * 0.004 + 4]);
      overlayCtx.lineWidth = Math.max(state.naturalWidth * 0.0012, 1.2);

      if (state.snap.x) {
        overlayCtx.beginPath();
        overlayCtx.moveTo(state.naturalWidth / 2, 0);
        overlayCtx.lineTo(state.naturalWidth / 2, state.naturalHeight);
        overlayCtx.stroke();
      }
      if (state.snap.y) {
        overlayCtx.beginPath();
        overlayCtx.moveTo(0, state.naturalHeight / 2);
        overlayCtx.lineTo(state.naturalWidth, state.naturalHeight / 2);
        overlayCtx.stroke();
      }
      overlayCtx.restore();
    }

    // Subtle constant affordance so the draggable object is discoverable.
    overlayCtx.save();
    overlayCtx.strokeStyle = state.selected ? "#1F5C45" : "rgba(31,94,69,0.35)";
    overlayCtx.lineWidth = Math.max(state.naturalWidth * 0.0015, 1.5);
    overlayCtx.setLineDash(state.selected ? [] : [10, 8]);
    overlayCtx.strokeRect(box.x - pad, box.y - pad, box.width + pad * 2, box.height + pad * 2);
    overlayCtx.restore();

    // Corner brackets — the signature selection treatment, in brass.
    if (state.selected) {
      const bx = box.x - pad, by = box.y - pad;
      const bw = box.width + pad * 2, bh = box.height + pad * 2;
      const armLen = Math.min(bw, bh) * 0.18 + state.naturalWidth * 0.006;

      overlayCtx.save();
      overlayCtx.strokeStyle = "#B07F2A";
      overlayCtx.lineWidth = Math.max(state.naturalWidth * 0.0022, 2);
      overlayCtx.lineCap = "square";

      const corners = [
        [bx, by, 1, 1],
        [bx + bw, by, -1, 1],
        [bx, by + bh, 1, -1],
        [bx + bw, by + bh, -1, -1]
      ];
      corners.forEach(([cx, cy, dx, dy]) => {
        overlayCtx.beginPath();
        overlayCtx.moveTo(cx, cy + armLen * dy);
        overlayCtx.lineTo(cx, cy);
        overlayCtx.lineTo(cx + armLen * dx, cy);
        overlayCtx.stroke();
      });
      overlayCtx.restore();
    }
  }

  /* ---------------------------------------------------------
     8. Drag, select, and snap
     --------------------------------------------------------- */
  function screenToCanvasCoords(evt) {
    const rect = dom.overlayCanvas.getBoundingClientRect();
    const scaleX = dom.overlayCanvas.width / rect.width;
    const scaleY = dom.overlayCanvas.height / rect.height;
    return {
      x: (evt.clientX - rect.left) * scaleX,
      y: (evt.clientY - rect.top) * scaleY,
      scaleX
    };
  }

  function clamp(v, min, max) {
    return Math.min(Math.max(v, min), max);
  }

  function updateDragPosition(evt) {
    const { x, y, scaleX } = screenToCanvasCoords(evt);
    const threshold = SNAP_THRESHOLD_SCREEN_PX * scaleX;

    let nx = clamp(x, 0, state.naturalWidth);
    let ny = clamp(y, 0, state.naturalHeight);

    const centerX = state.naturalWidth / 2;
    const centerY = state.naturalHeight / 2;

    const snapX = Math.abs(nx - centerX) <= threshold;
    const snapY = Math.abs(ny - centerY) <= threshold;

    if (snapX) nx = centerX;
    if (snapY) ny = centerY;

    state.snap.x = snapX;
    state.snap.y = snapY;
    state.text.x = nx;
    state.text.y = ny;

    updateCoordReadout(nx, ny);
    scheduleRender();
    renderOverlay();
  }

  function updateCoordReadout(x, y) {
    dom.coordReadout.hidden = false;
    dom.coordReadout.textContent = `X: ${Math.round(x)}  Y: ${Math.round(y)}`;
  }

  function bindCanvasInteraction() {
    dom.overlayCanvas.addEventListener("pointerdown", (evt) => {
      if (!state.image) return;
      evt.preventDefault();
      state.selected = true;
      state.dragging = true;
      dom.overlayCanvas.classList.add("is-dragging");
      dom.overlayCanvas.setPointerCapture(evt.pointerId);
      updateDragPosition(evt);
    });

    dom.overlayCanvas.addEventListener("pointermove", (evt) => {
      if (!state.dragging) return;
      updateDragPosition(evt);
    });

    function endDrag(evt) {
      if (!state.dragging) return;
      state.dragging = false;
      state.snap.x = false;
      state.snap.y = false;
      dom.overlayCanvas.classList.remove("is-dragging");
      dom.coordReadout.hidden = true;
      // Final coordinates already live in state.text — nothing further to persist.
      renderOverlay();
    }

    dom.overlayCanvas.addEventListener("pointerup", endDrag);
    dom.overlayCanvas.addEventListener("pointercancel", endDrag);
  }

  /* ---------------------------------------------------------
     9. Typography + alignment controls
     --------------------------------------------------------- */
  function bindTypographyControls() {
    dom.fontFamily.addEventListener("change", () => {
      state.text.fontFamily = dom.fontFamily.value;
      scheduleRender();
      renderOverlay();
    });

    dom.fontSize.addEventListener("input", () => {
      state.text.fontSize = Number(dom.fontSize.value);
      dom.fontSizeValue.textContent = `${state.text.fontSize}px`;
      scheduleRender();
      renderOverlay();
    });

    dom.fontWeight.addEventListener("change", () => {
      state.text.fontWeight = Number(dom.fontWeight.value);
      scheduleRender();
      renderOverlay();
    });

    function setColor(hex) {
      if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return;
      state.text.color = hex;
      dom.fontColor.value = hex;
      dom.fontColorHex.value = hex.toUpperCase();
      scheduleRender();
    }
    dom.fontColor.addEventListener("input", () => setColor(dom.fontColor.value));
    dom.fontColorHex.addEventListener("change", () => setColor(dom.fontColorHex.value));

    dom.opacity.addEventListener("input", () => {
      state.text.opacity = Number(dom.opacity.value);
      dom.opacityValue.textContent = `${state.text.opacity}%`;
      scheduleRender();
    });

    dom.letterSpacing.addEventListener("input", () => {
      state.text.letterSpacing = Number(dom.letterSpacing.value);
      dom.letterSpacingValue.textContent = `${state.text.letterSpacing}px`;
      scheduleRender();
      renderOverlay();
    });

    dom.alignGroup.addEventListener("click", (evt) => {
      const btn = evt.target.closest(".align-btn");
      if (!btn) return;
      state.text.align = btn.dataset.align;
      Array.from(dom.alignGroup.children).forEach((b) => {
        const active = b === btn;
        b.classList.toggle("is-active", active);
        b.setAttribute("aria-pressed", String(active));
      });
      scheduleRender();
      renderOverlay();
    });

    dom.centerPositionBtn.addEventListener("click", () => {
      if (!state.image) return;
      state.text.x = state.naturalWidth / 2;
      state.text.y = state.naturalHeight / 2;
      state.selected = true;
      scheduleRender();
      renderOverlay();
    });
  }

  /* ---------------------------------------------------------
     10. Upload handling
     --------------------------------------------------------- */
  function bindUpload() {
    dom.fileInput.addEventListener("change", () => {
      if (dom.fileInput.files[0]) handleFile(dom.fileInput.files[0]);
    });

    ["dragenter", "dragover"].forEach((evtName) => {
      dom.uploadZone.addEventListener(evtName, (e) => {
        e.preventDefault();
        dom.uploadZone.classList.add("is-dragover");
      });
    });

    ["dragleave", "drop"].forEach((evtName) => {
      dom.uploadZone.addEventListener(evtName, (e) => {
        e.preventDefault();
        dom.uploadZone.classList.remove("is-dragover");
      });
    });

    dom.uploadZone.addEventListener("drop", (e) => {
      const file = e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) handleFile(file);
    });
  }

  /* ---------------------------------------------------------
     11. Zoom controls
     --------------------------------------------------------- */
  function bindZoom() {
    dom.zoomGroup.addEventListener("click", (evt) => {
      const btn = evt.target.closest(".zoom-btn");
      if (!btn || !state.image) return;
      applyZoom(Number(btn.dataset.zoom));
    });
  }

  /* ---------------------------------------------------------
     12. Bulk name list
     --------------------------------------------------------- */
  function parseNames(raw) {
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }

  function bindNamesInput() {
    dom.namesInput.addEventListener("input", () => {
      state.names = parseNames(dom.namesInput.value);
      dom.namesCount.textContent = String(state.names.length);
      updateGenerateAvailability();
      scheduleRender(); // preview swaps "John Doe" for the first real name
    });
  }

  function updateGenerateAvailability() {
    dom.generateBtn.disabled = !state.image || state.names.length === 0;
  }

  /* ---------------------------------------------------------
     13. Filename sanitizing
     --------------------------------------------------------- */
  function sanitizeFilename(name, index) {
    const cleaned = name
      .replace(/[\\/:*?"<>|]/g, "")
      .trim()
      .replace(/\s+/g, "_");
    const base = cleaned.length > 0 ? cleaned : `certificate_${index + 1}`;
    return `${base}.png`;
  }

  /* ---------------------------------------------------------
     14. Certificate generation (export pipeline)
     --------------------------------------------------------- */
  function canvasToBlob(canvas) {
    return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/png"));
  }

  async function renderCertificateForName(name) {
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = state.naturalWidth;
    exportCanvas.height = state.naturalHeight;
    const ctx = exportCanvas.getContext("2d");

    const casedName = applyCase(name);
    ctx.drawImage(state.image, 0, 0, state.naturalWidth, state.naturalHeight);
    drawNameOnCanvas(ctx, casedName, state.text, state.text.x, state.text.y);

    return canvasToBlob(exportCanvas);
  }

  async function generateCertificates() {
    if (!state.image || state.names.length === 0) return;

    await ensureFontReady(state.text);

    dom.generateBtn.disabled = true;
    dom.downloadRow.hidden = true;
    dom.progressWrap.hidden = false;

    const usedNames = {};
    const results = [];
    const total = state.names.length;

    for (let i = 0; i < total; i++) {
      const name = state.names[i];
      const blob = await renderCertificateForName(name);

      // Disambiguate duplicate names so files never overwrite each other.
      const key = name.toLowerCase();
      usedNames[key] = (usedNames[key] || 0) + 1;
      const suffix = usedNames[key] > 1 ? `_${usedNames[key]}` : "";
      const filename = sanitizeFilename(name, i).replace(/\.png$/, `${suffix}.png`);

      results.push({ name, filename, blob });

      const pct = Math.round(((i + 1) / total) * 100);
      dom.progressFill.style.width = `${pct}%`;
      dom.progressLabel.textContent = `Rendering ${i + 1} / ${total}`;

      // Yield to the UI thread periodically so large batches stay responsive.
      if (i % 8 === 7) await new Promise((r) => requestAnimationFrame(r));
    }

    state.generated = results;
    dom.progressLabel.textContent = `Done — ${total} certificate${total === 1 ? "" : "s"} ready`;
    dom.downloadRow.hidden = false;
    dom.generateBtn.disabled = false;
    dom.headerStatus.textContent = `${total} certificate${total === 1 ? "" : "s"} generated`;
  }

  /* ---------------------------------------------------------
     15. Downloads
     --------------------------------------------------------- */
  async function downloadIndividually() {
    if (state.generated.length === 0) return;
    for (let i = 0; i < state.generated.length; i++) {
      const item = state.generated[i];
      window.saveAs(item.blob, item.filename);
      // A small stagger keeps browsers from blocking rapid-fire downloads.
      await new Promise((r) => setTimeout(r, 160));
    }
  }

  async function downloadZip() {
    if (state.generated.length === 0) return;
    dom.downloadZipBtn.disabled = true;
    const originalLabel = dom.downloadZipBtn.textContent;
    dom.downloadZipBtn.textContent = "Zipping…";

    try {
      const zip = new JSZip();
      state.generated.forEach((item) => zip.file(item.filename, item.blob));
      const content = await zip.generateAsync({ type: "blob" });
      window.saveAs(content, "certificates.zip");
    } finally {
      dom.downloadZipBtn.disabled = false;
      dom.downloadZipBtn.textContent = originalLabel;
    }
  }

  function bindDownloads() {
    dom.generateBtn.addEventListener("click", generateCertificates);
    dom.downloadIndividualBtn.addEventListener("click", downloadIndividually);
    dom.downloadZipBtn.addEventListener("click", downloadZip);
  }

  /* ---------------------------------------------------------
     16b. Name casing controls
     --------------------------------------------------------- */
  function bindCasingControls() {
    if (!dom.casingGroup) return;
    dom.casingGroup.addEventListener("click", (evt) => {
      const btn = evt.target.closest(".casing-btn");
      if (!btn) return;

      state.casing = btn.dataset.case;

      Array.from(dom.casingGroup.children).forEach((b) => {
        const active = b === btn;
        b.classList.toggle("is-active", active);
        b.setAttribute("aria-pressed", String(active));
      });

      scheduleRender();
      renderOverlay();
    });
  }

  /* ---------------------------------------------------------
     16a. Local font loader
     Uses the FontFace API to register an in-memory font from a
     local file. The font lives only for this page session —
     nothing is uploaded or persisted anywhere.
     --------------------------------------------------------- */
  function bindLocalFontUpload() {
    if (!dom.localFontInput) return;

    dom.localFontInput.addEventListener("change", async () => {
      const file = dom.localFontInput.files[0];
      if (!file) return;

      // Derive a human-readable display name from the filename.
      const displayName = file.name
        .replace(/\.(ttf|otf|woff2?)$/i, "")
        .replace(/[-_]/g, " ");

      // Create a unique family name so multiple loaded fonts never collide.
      const familyName = `local-font-${Date.now()}`;

      // Build an object URL — it stays alive as long as the page is open.
      const url = URL.createObjectURL(file);

      try {
        const face = new FontFace(familyName, `url(${url})`);
        await face.load();
        document.fonts.add(face);

        // Register in FONT_OPTIONS so cssFontString() resolves correctly.
        FONT_OPTIONS.push({
          value: familyName,
          label: `${displayName} (local)`,
          stack: `"${familyName}", sans-serif`
        });

        // Add an <option> and immediately select it.
        const opt = document.createElement("option");
        opt.value = familyName;
        opt.textContent = `${displayName} (local)`;
        dom.fontFamily.appendChild(opt);
        dom.fontFamily.value = familyName;
        state.text.fontFamily = familyName;

        // Show the brass chip with the filename.
        dom.localFontChip.hidden = false;
        dom.localFontChip.textContent = file.name;
        dom.localFontChip.title = file.name;

        scheduleRender();
        renderOverlay();
      } catch (err) {
        URL.revokeObjectURL(url); // clean up only on failure
        alert(
          `Could not load "${file.name}".\n` +
          "Make sure it is a valid TTF, OTF, WOFF, or WOFF2 file."
        );
      }

      // Reset so the same file can be picked again immediately.
      dom.localFontInput.value = "";
    });
  }

  /* ---------------------------------------------------------
     16. Init
     --------------------------------------------------------- */
  function init() {
    populateFontDropdown();
    bindUpload();
    bindCanvasInteraction();
    bindTypographyControls();
    bindZoom();
    bindNamesInput();
    bindDownloads();
    bindLocalFontUpload();
    bindCasingControls();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
