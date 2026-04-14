(function () {
  const elTabs = document.getElementById("profile-tabs");
  const elTabsWrap = document.getElementById("profile-tabs-wrap");
  const elMessages = document.getElementById("messages");
  const elInput = document.getElementById("composer-input");
  const elSend = document.getElementById("send-btn");
  const elComposerCliLine = document.getElementById("composer-cli-line");
  const elWorkspacePanel = document.getElementById("workspace-panel");
  const elCronPanel = document.getElementById("cron-panel");
  const btnCronToggle = document.getElementById("btn-cron-toggle");
  const elCronJobList = document.getElementById("cron-job-list");
  const btnCronOpenModal = document.getElementById("btn-cron-open-modal");
  const elCronModal = document.getElementById("cron-job-modal");
  const elCronModalForm = document.getElementById("cron-modal-form");
  const elCronModalTitle = document.getElementById("cron-modal-title");
  const elModalCronName = document.getElementById("modal-cron-name");
  const elModalCronProfile = document.getElementById("modal-cron-profile");
  const elModalCronPrompt = document.getElementById("modal-cron-prompt");
  const elProfileFilesList = document.getElementById("profile-files-list");
  const elProfileFileModal = document.getElementById("profile-file-modal");
  const elProfileFileModalTitle = document.getElementById("profile-file-modal-title");
  const elProfileFileModalHint = document.getElementById("profile-file-modal-hint");
  const elProfileFileEditor = document.getElementById("profile-file-editor");
  const elProfileFileModalStatus = document.getElementById("profile-file-modal-status");
  const btnProfileFileCancel = document.getElementById("profile-file-cancel");
  const btnProfileFileSave = document.getElementById("profile-file-save");
  const btnProfileFileModalClose = document.getElementById("profile-file-modal-close");
  const btnUiConfig = document.getElementById("btn-ui-config");
  const elSessionSelect = document.getElementById("session-select");
  const elSessionHint = document.getElementById("session-hint");
  const elSkillsCascade = document.getElementById("skills-cascade");
  const elSkillCategoryList = document.getElementById("skill-category-list");
  const elSkillNameList = document.getElementById("skill-name-list");
  const elSkillSkillsPane = document.getElementById("skill-skills-pane");
  const elSkillHint = document.getElementById("skill-hint");
  const btnComposerAttach = document.getElementById("btn-composer-attach");
  const elComposerFileInput = document.getElementById("composer-file-input");
  const elAttachModal = document.getElementById("attach-modal");
  const elAttachModalFilename = document.getElementById("attach-modal-filename");
  const elAttachModalStatus = document.getElementById("attach-modal-status");
  const btnAttachModalCancel = document.getElementById("attach-modal-cancel");
  const btnAttachModalUpload = document.getElementById("attach-modal-upload");

  /** Same default as AgentChat (cursor-agent-chat). */
  const DEFAULT_SCHEDULE = "interval:15m";

  const RESUME_BY_PROFILE_KEY = "hermes_resume_by_profile";
  const SKILL_PICK_BY_PROFILE_KEY = "hermes_skill_pick_by_profile";

  const LEADING_SKILL_LINE_RE = /^\s*skill:\s*[^\n]+\n?/;

  let skillSelectsSync = false;
  /** Last successful category id list for the active profile (from API). */
  let skillCategoriesCache = [];
  /** Skill folder names for the open category (right pane). */
  let skillSkillsCache = [];
  let skillUiCategory = "";
  let skillUiSkill = "";
  /** True when profiles/.../skills/<name>/ is a leaf skill (skill: name only, no subfolder). */
  let skillUiLeaf = false;

  function stripLeadingSkillLine(text) {
    return String(text || "").replace(LEADING_SKILL_LINE_RE, "");
  }

  function syncComposerSkillLineFromPicker() {
    if (!elInput || skillSelectsSync) return;
    const cat = String(skillUiCategory || "").trim();
    const sk = String(skillUiSkill || "").trim();
    if (skillUiLeaf) {
      if (!cat) {
        elInput.value = stripLeadingSkillLine(elInput.value);
        return;
      }
      const line = "skill: " + cat + "\n";
      const rest = stripLeadingSkillLine(elInput.value);
      elInput.value = line + rest.replace(/^\n+/, "");
      return;
    }
    if (!cat || !sk) {
      elInput.value = stripLeadingSkillLine(elInput.value);
      return;
    }
    const line = "skill: " + cat + "/" + sk + "\n";
    const rest = stripLeadingSkillLine(elInput.value);
    elInput.value = line + rest.replace(/^\n+/, "");
  }

  function setSkillsCascadeLocked(locked) {
    if (elSkillsCascade) elSkillsCascade.classList.toggle("is-locked", !!locked);
  }

  function renderCategoryList(categories, selectedCat) {
    if (!elSkillCategoryList) return;
    elSkillCategoryList.innerHTML = "";
    const noneBtn = document.createElement("button");
    noneBtn.type = "button";
    noneBtn.className =
      "skills-cascade-item" + (String(selectedCat || "").trim() === "" ? " is-active" : "");
    noneBtn.setAttribute("role", "option");
    noneBtn.setAttribute("aria-selected", String(selectedCat || "").trim() === "" ? "true" : "false");
    noneBtn.dataset.category = "";
    noneBtn.textContent = "None";
    elSkillCategoryList.appendChild(noneBtn);

    for (const c of categories) {
      if (!c || typeof c !== "string") continue;
      const btn = document.createElement("button");
      btn.type = "button";
      const on = c === selectedCat;
      btn.className = "skills-cascade-item" + (on ? " is-active" : "");
      btn.setAttribute("role", "option");
      btn.setAttribute("aria-selected", on ? "true" : "false");
      btn.dataset.category = c;
      btn.textContent = c;
      elSkillCategoryList.appendChild(btn);
    }
  }

  function showSkillPanePlaceholder(message, revealRightPane) {
    if (!elSkillNameList) return;
    if (elSkillSkillsPane) {
      if (revealRightPane) elSkillSkillsPane.classList.add("is-revealed");
      else elSkillSkillsPane.classList.remove("is-revealed");
    }
    elSkillNameList.innerHTML = "";
    const p = document.createElement("p");
    p.className = "skills-cascade-placeholder";
    p.textContent = message;
    elSkillNameList.appendChild(p);
  }

  function renderSkillList(skills, selectedSkill) {
    if (!elSkillNameList) return;
    skillSkillsCache = Array.isArray(skills) ? skills.slice() : [];
    elSkillNameList.innerHTML = "";
    if (elSkillSkillsPane) elSkillSkillsPane.classList.add("is-revealed");

    const noneBtn = document.createElement("button");
    noneBtn.type = "button";
    noneBtn.className =
      "skills-cascade-item skills-cascade-item--skill" +
      (String(selectedSkill || "").trim() === "" ? " is-active" : "");
    noneBtn.setAttribute("role", "option");
    noneBtn.setAttribute("aria-selected", String(selectedSkill || "").trim() === "" ? "true" : "false");
    noneBtn.dataset.skill = "";
    noneBtn.textContent = "None";
    noneBtn.style.animationDelay = "0s";
    elSkillNameList.appendChild(noneBtn);

    let i = 0;
    for (const s of skillSkillsCache) {
      if (!s || typeof s !== "string") continue;
      i += 1;
      const btn = document.createElement("button");
      btn.type = "button";
      const on = s === selectedSkill;
      btn.className = "skills-cascade-item skills-cascade-item--skill" + (on ? " is-active" : "");
      btn.setAttribute("role", "option");
      btn.setAttribute("aria-selected", on ? "true" : "false");
      btn.dataset.skill = s;
      btn.textContent = s;
      btn.style.animationDelay = i * 0.04 + "s";
      elSkillNameList.appendChild(btn);
    }
  }

  function loadSkillPickMap() {
    try {
      const raw = localStorage.getItem(SKILL_PICK_BY_PROFILE_KEY);
      const o = raw ? JSON.parse(raw) : {};
      return o && typeof o === "object" ? o : {};
    } catch (_) {
      return {};
    }
  }

  function saveSkillPickForProfile(profile, category, skill, leaf) {
    if (!profile) return;
    const m = loadSkillPickMap();
    const c = String(category || "").trim();
    const s = String(skill || "").trim();
    const lf = leaf === true;
    if (!c && !s && !lf) delete m[profile];
    else m[profile] = { category: c, skill: s, leaf: lf };
    try {
      localStorage.setItem(SKILL_PICK_BY_PROFILE_KEY, JSON.stringify(m));
    } catch (_) {}
  }

  function showLeafSkillPane(category) {
    if (!elSkillNameList) return;
    if (elSkillSkillsPane) elSkillSkillsPane.classList.add("is-revealed");
    elSkillNameList.innerHTML = "";
    const p = document.createElement("p");
    p.className = "skills-cascade-placeholder";
    p.textContent =
      "This folder is one skill (not a category). The composer line skill: " +
      category +
      " was added.";
    elSkillNameList.appendChild(p);
  }

  async function loadSkillsForCategory(profile, category, restoreSkill) {
    if (!elSkillNameList || !profile || !category) return;
    skillSelectsSync = true;
    skillUiLeaf = false;
    skillUiSkill = "";
    showSkillPanePlaceholder("Loading…", true);

    const attempts = [
      async () =>
        fetch(
          "/api/profiles/" +
            encodeURIComponent(profile) +
            "/skill-categories/" +
            encodeURIComponent(category) +
            "/skills"
        ),
      async () =>
        fetch("/api/profile-skills-read", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ profile, category }),
        }),
    ];
    let skills = null;
    let leafSkill = false;
    for (const run of attempts) {
      try {
        const r = await run();
        const d = await r.json().catch(() => ({}));
        if (!r.ok) continue;
        const arr = d.skills;
        if (!Array.isArray(arr)) continue;
        skills = arr;
        leafSkill = d.leaf_skill === true;
        break;
      } catch (_) {}
    }

    if (skills == null) {
      showSkillPanePlaceholder("Could not load skills for this category.", true);
      skillSelectsSync = false;
      syncComposerSkillLineFromPicker();
      return;
    }

    if (leafSkill) {
      skillUiLeaf = true;
      skillUiSkill = "";
      showLeafSkillPane(category);
      skillSelectsSync = false;
      syncComposerSkillLineFromPicker();
      return;
    }

    if (skills.length === 0) {
      showSkillPanePlaceholder("No skills in this category.", true);
      skillSelectsSync = false;
      syncComposerSkillLineFromPicker();
      return;
    }

    const rs = (restoreSkill != null ? String(restoreSkill) : "").trim();
    if (rs && skills.indexOf(rs) >= 0) {
      skillUiSkill = rs;
    } else {
      skillUiSkill = "";
    }
    renderSkillList(skills, skillUiSkill);
    skillSelectsSync = false;
    syncComposerSkillLineFromPicker();
  }

  async function loadSkillCategoriesForProfile(profile) {
    if (!elSkillCategoryList || !profile) return;
    skillSelectsSync = true;
    skillCategoriesCache = [];
    skillUiCategory = "";
    skillUiSkill = "";
    skillUiLeaf = false;
    skillSkillsCache = [];
    renderCategoryList([], "");
    showSkillPanePlaceholder("Select a category", false);

    if (elSkillHint) {
      elSkillHint.textContent = "";
      elSkillHint.hidden = true;
    }

    const attempts = [
      async () => fetch("/api/profiles/" + encodeURIComponent(profile) + "/skill-categories"),
      async () =>
        fetch("/api/profile-skill-categories-read", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ profile }),
        }),
    ];
    let lastStatus = 0;
    let lastDetail = "";
    let categories = null;
    for (const run of attempts) {
      try {
        const r = await run();
        lastStatus = r.status;
        const d = await r.json().catch(() => ({}));
        if (!r.ok) {
          lastDetail = formatApiDetail(d, r.statusText || "error");
          continue;
        }
        categories = d.categories;
        if (!Array.isArray(categories)) {
          lastDetail = "invalid categories payload";
          continue;
        }
        break;
      } catch (e) {
        lastDetail = String(e);
        lastStatus = 0;
      }
    }

    if (categories == null && elSkillHint) {
      elSkillHint.textContent =
        "Skills could not be loaded (HTTP " +
        lastStatus +
        "). " +
        (lastDetail ? String(lastDetail).slice(0, 180) : "");
      elSkillHint.hidden = false;
    }

    if (categories == null) {
      categories = [];
    }
    skillCategoriesCache = categories.slice();

    const pick = loadSkillPickMap()[profile] || {};
    const wantCat = pick.category || "";
    const wantSkill = pick.skill || "";
    const catOk = wantCat && skillCategoriesCache.indexOf(wantCat) >= 0;
    skillUiCategory = catOk ? wantCat : "";
    skillUiSkill = "";
    renderCategoryList(skillCategoriesCache, skillUiCategory);
    skillSelectsSync = false;

    if (skillUiCategory) {
      await loadSkillsForCategory(profile, skillUiCategory, wantSkill);
    } else {
      showSkillPanePlaceholder("Select a category", false);
      syncComposerSkillLineFromPicker();
    }
  }

  /** Match hermes_runner.get_profile_file_names() defaults when API omits profile_files (older server image). */
  const DEFAULT_PROFILE_FILES = ["SOUL.md", "config.yaml"];

  function normalizeProfileFilesFromApi(pf) {
    if (Array.isArray(pf) && pf.length > 0) return pf.slice();
    if (Array.isArray(pf) && pf.length === 0) return [];
    return DEFAULT_PROFILE_FILES.slice();
  }

  function coerceTs(v) {
    if (v == null || v === "") return undefined;
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : undefined;
  }

  /** @param {{ role: string; text: string; ts?: unknown }} m */
  function mapApiMessage(m) {
    const o = { role: m.role, text: m.text };
    const ts = coerceTs(m.ts);
    if (ts !== undefined) o.ts = ts;
    return o;
  }

  const TS_STORAGE_KEY = "hermes_user_ts";

  function loadTsCache() {
    try {
      const raw = localStorage.getItem(TS_STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (_) { return {}; }
  }

  function saveTsCache(cache) {
    try { localStorage.setItem(TS_STORAGE_KEY, JSON.stringify(cache)); } catch (_) {}
  }

  function profileTsCacheKey(profile, idx, text) {
    return profile + "\0" + idx + "\0" + String(text || "").slice(0, 80);
  }

  function persistUserTs(profile, messages) {
    const cache = loadTsCache();
    let changed = false;
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      if (m.role !== "user") continue;
      const ts = coerceTs(m.ts);
      if (ts === undefined) continue;
      const k = profileTsCacheKey(profile, i, m.text);
      if (cache[k] !== ts) { cache[k] = ts; changed = true; }
    }
    if (changed) saveTsCache(cache);
  }

  function restoreUserTs(profile, messages) {
    const cache = loadTsCache();
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      if (m.role !== "user" || m.ts !== undefined) continue;
      const k = profileTsCacheKey(profile, i, m.text);
      const ts = coerceTs(cache[k]);
      if (ts !== undefined) m.ts = ts;
    }
  }

  /** @param {number | undefined} ts unix seconds or ms */
  function formatMessageTs(ts) {
    const n = coerceTs(ts);
    if (n === undefined) return "";
    const ms = n > 1e12 ? n : n * 1000;
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return "";
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, "0");
    const da = String(d.getDate()).padStart(2, "0");
    const h = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    return y + "-" + mo + "-" + da + " " + h + ":" + mi;
  }

  /** @type {string | null} */
  let cronModalEditingId = null;
  let cronModalEditingEnabled = true;
  /** @type {string | null} */
  let profileFileEditingName = null;
  /** @type {"profile" | "ui-config" | null} */
  let profileFileModalMode = null;

  /** @type {File | null} */
  let attachPendingFile = null;

  if (elTabsWrap) {
    elTabsWrap.addEventListener(
      "wheel",
      (e) => {
        const el = elTabsWrap;
        if (el.scrollWidth <= el.clientWidth + 1) return;
        const move = e.deltaY + e.deltaX;
        if (!move) return;
        const maxScroll = el.scrollWidth - el.clientWidth;
        const next = el.scrollLeft + move;
        if (next < 0 && el.scrollLeft <= 0) return;
        if (next > maxScroll && el.scrollLeft >= maxScroll - 1) return;
        e.preventDefault();
        el.scrollLeft = Math.max(0, Math.min(maxScroll, next));
      },
      { passive: false }
    );
  }

  const state = {
    profiles: [],
    active: null,
    /** @type {Record<string, { role: string; text: string; extraClass?: string; ts?: number }[]>} */
    history: {},
    /** @type {Record<string, number>} */
    revByProfile: {},
    cronPanelOpen: false,
    /** @type {string[]} */
    profileFiles: [],
  };

  /** @type {HTMLElement | null} */
  let pendingNode = null;

  function showPending() {
    hidePending();
    const wrap = document.createElement("div");
    wrap.className = "bubble assistant agent-pending";
    wrap.setAttribute("role", "status");
    wrap.setAttribute("aria-live", "polite");
    wrap.innerHTML =
      '<span class="agent-pending-label">Hermes is thinking</span>' +
      '<span class="agent-pending-cycle" aria-hidden="true"><span></span><span></span><span></span></span>';
    elMessages.appendChild(wrap);
    pendingNode = wrap;
    elMessages.setAttribute("aria-busy", "true");
    elMessages.scrollTop = elMessages.scrollHeight;
  }

  function hidePending() {
    if (pendingNode && pendingNode.parentNode) {
      pendingNode.parentNode.removeChild(pendingNode);
    }
    pendingNode = null;
    elMessages.removeAttribute("aria-busy");
  }

  function renderBubble(entry) {
    const div = document.createElement("div");
    div.className = "bubble " + entry.role + (entry.extraClass ? " " + entry.extraClass : "");
    if (entry.role === "user") {
      const label = formatMessageTs(entry.ts);
      if (label) {
        div.classList.add("bubble-with-ts");
        const tsEl = document.createElement("div");
        tsEl.className = "bubble-ts";
        tsEl.setAttribute("aria-label", "Sent at " + label);
        tsEl.textContent = label;
        div.appendChild(tsEl);
      }
      const textEl = document.createElement("div");
      textEl.className = "bubble-text";
      textEl.textContent = entry.text;
      div.appendChild(textEl);
    } else {
      div.textContent = entry.text;
    }
    elMessages.appendChild(div);
  }

  function renderMessages() {
    hidePending();
    elMessages.innerHTML = "";
    const list = state.active ? state.history[state.active] || [] : [];
    for (const entry of list) {
      renderBubble(entry);
    }
    elMessages.scrollTop = elMessages.scrollHeight;
  }

  function appendToActive(role, text, extraClass, ts) {
    if (!state.active) return;
    if (!state.history[state.active]) state.history[state.active] = [];
    const entry = { role, text, extraClass };
    if (role === "user") {
      const c = coerceTs(ts);
      entry.ts = c !== undefined ? c : Date.now() / 1000;
    }
    state.history[state.active].push(entry);
    if (role === "user") persistUserTs(state.active, state.history[state.active]);
    renderBubble(entry);
    elMessages.scrollTop = elMessages.scrollHeight;
  }

  function loadResumeMap() {
    try {
      const raw = localStorage.getItem(RESUME_BY_PROFILE_KEY);
      const o = raw ? JSON.parse(raw) : {};
      return o && typeof o === "object" ? o : {};
    } catch (_) {
      return {};
    }
  }

  function saveResumeForProfile(profile, sessionId) {
    const m = loadResumeMap();
    if (!sessionId) delete m[profile];
    else m[profile] = sessionId;
    try {
      localStorage.setItem(RESUME_BY_PROFILE_KEY, JSON.stringify(m));
    } catch (_) {}
  }

  async function loadSessionsForProfile(profile) {
    if (!elSessionSelect || !profile) return;
    while (elSessionSelect.options.length > 1) {
      elSessionSelect.remove(1);
    }
    if (elSessionHint) {
      elSessionHint.textContent = "";
      elSessionHint.hidden = true;
    }
    const attempts = [
      { fromProfiles: false, run: async () => fetch("/api/sessions/" + encodeURIComponent(profile)) },
      { fromProfiles: false, run: async () => fetch("/api/sessions?profile=" + encodeURIComponent(profile)) },
      {
        fromProfiles: false,
        run: async () =>
          fetch("/api/sessions-read", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ profile }),
          }),
      },
      {
        fromProfiles: false,
        run: async () =>
          fetch("/api/profiles-sessions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ profile }),
          }),
      },
      {
        fromProfiles: true,
        run: async () =>
          fetch("/api/profiles?sessions_profile=" + encodeURIComponent(profile)),
      },
    ];
    let lastStatus = 0;
    let lastDetail = "";
    for (const att of attempts) {
      try {
        const r = await att.run();
        lastStatus = r.status;
        const d = await r.json().catch(() => ({}));
        if (!r.ok) {
          lastDetail = formatApiDetail(d, r.statusText || "error");
          continue;
        }
        let payload = d;
        if (att.fromProfiles) {
          if (d.sessions_list == null) {
            lastDetail =
              "GET /api/profiles had no sessions_list (proxy may strip query strings, or old server).";
            continue;
          }
          payload = d.sessions_list;
        }
        const sessions = payload.sessions || [];
        if (payload.error && elSessionHint) {
          elSessionHint.textContent =
            payload.error +
            (payload.stderr ? " " + String(payload.stderr).slice(0, 200) : "");
          elSessionHint.hidden = false;
        }
        for (const s of sessions) {
          if (!s || !s.id) continue;
          const opt = document.createElement("option");
          opt.value = s.id;
          opt.textContent = s.label || s.id;
          elSessionSelect.appendChild(opt);
        }
        const want = loadResumeMap()[profile] || "";
        if (want && Array.from(elSessionSelect.options).some((o) => o.value === want)) {
          elSessionSelect.value = want;
        } else {
          elSessionSelect.value = "";
        }
        return;
      } catch (e) {
        lastDetail = String(e);
        lastStatus = 0;
      }
    }
    if (elSessionHint) {
      elSessionHint.textContent =
        "Sessions could not be loaded. All methods failed (HTTP " +
        lastStatus +
        "). Rebuild/restart with latest server.py (POST /api/profiles-sessions or GET /api/profiles?sessions_profile=), or fix /api proxy. " +
        (lastDetail ? String(lastDetail).slice(0, 180) : "");
      elSessionHint.hidden = false;
    }
  }

  function updateComposerAttachEnabled() {
    if (!btnComposerAttach) return;
    const ok = !!(state.active && state.profiles.includes(state.active));
    btnComposerAttach.disabled = !ok;
  }

  function isAttachModalOpen() {
    return elAttachModal && !elAttachModal.classList.contains("is-hidden");
  }

  function closeAttachModal() {
    attachPendingFile = null;
    if (elComposerFileInput) elComposerFileInput.value = "";
    if (elAttachModal) {
      elAttachModal.classList.add("is-hidden");
      elAttachModal.setAttribute("aria-hidden", "true");
    }
    if (elAttachModalFilename) elAttachModalFilename.textContent = "";
    if (elAttachModalStatus) {
      elAttachModalStatus.textContent = "";
      elAttachModalStatus.hidden = true;
    }
  }

  function openAttachModalForFile(file) {
    if (!file || !elAttachModal) return;
    attachPendingFile = file;
    if (elAttachModalFilename) elAttachModalFilename.textContent = file.name || "(unnamed)";
    if (elAttachModalStatus) {
      elAttachModalStatus.textContent = "";
      elAttachModalStatus.hidden = true;
    }
    elAttachModal.classList.remove("is-hidden");
    elAttachModal.setAttribute("aria-hidden", "false");
  }

  async function confirmAttachUpload() {
    const prof = state.active;
    const f = attachPendingFile;
    if (!prof || !f || !elInput || !elAttachModalStatus) return;
    elAttachModalStatus.textContent = "";
    elAttachModalStatus.hidden = true;
    const fd = new FormData();
    fd.set("profile", prof);
    fd.set("file", f, f.name || "upload.bin");
    try {
      const r = await fetch("/api/profile-upload", { method: "POST", body: fd });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        elAttachModalStatus.textContent = formatApiDetail(data, "Upload failed.");
        elAttachModalStatus.hidden = false;
        return;
      }
      const absPath = data.path || "";
      const fname = data.filename || f.name || "file";
      const block =
        "[Attached file: " +
        fname +
        " — absolute path for tools]\n" +
        absPath +
        "\n";
      const cur = elInput.value.trimEnd();
      if (!cur) {
        elInput.value = block;
      } else {
        const gap = cur.endsWith("\n") ? "\n" : "\n\n";
        elInput.value = cur + gap + block;
      }
      elInput.focus();
      closeAttachModal();
    } catch (e) {
      elAttachModalStatus.textContent = String(e);
      elAttachModalStatus.hidden = false;
    }
  }

  async function setActiveProfile(name) {
    if (!name || !state.profiles.includes(name)) return;
    await Promise.all([
      fetchHistory(name),
      loadSessionsForProfile(name),
      loadSkillCategoriesForProfile(name),
    ]);
    state.active = name;
    const tabs = elTabs.querySelectorAll(".profile-tab");
    tabs.forEach((btn) => {
      const sel = btn.getAttribute("data-profile") === name;
      btn.setAttribute("aria-selected", sel ? "true" : "false");
      btn.tabIndex = sel ? 0 : -1;
    });
    renderMessages();
    elSend.disabled = false;
    if (elSessionSelect) elSessionSelect.disabled = false;
    setSkillsCascadeLocked(false);
    void refreshCliPreview();
    renderProfileFilesList();
    updateComposerAttachEnabled();
  }

  function renderProfileFilesList() {
    if (!elProfileFilesList) return;
    elProfileFilesList.innerHTML = "";
    const names = state.profileFiles || [];
    const prof = state.active;
    if (!names.length) {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.type = "button";
      b.disabled = true;
      b.textContent = "No profile_files in config";
      li.appendChild(b);
      elProfileFilesList.appendChild(li);
      return;
    }
    if (!prof) {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.type = "button";
      b.disabled = true;
      b.textContent = "Select a profile";
      li.appendChild(b);
      elProfileFilesList.appendChild(li);
      return;
    }
    for (const name of names) {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = name;
      btn.addEventListener("click", () => void openProfileFileModal(name));
      li.appendChild(btn);
      elProfileFilesList.appendChild(li);
    }
  }

  function formatApiDetail(data, fallback) {
    const d = data && data.detail;
    if (typeof d === "string") return d;
    if (Array.isArray(d) && d.length && typeof d[0] === "object" && d[0].msg != null) {
      return String(d[0].msg);
    }
    return fallback;
  }

  function setProfileFileStatus(msg, kind) {
    if (!elProfileFileModalStatus) return;
    elProfileFileModalStatus.textContent = msg || "";
    elProfileFileModalStatus.classList.remove("is-error", "is-info");
    if (kind === "error") elProfileFileModalStatus.classList.add("is-error");
    else if (kind === "info") elProfileFileModalStatus.classList.add("is-info");
  }

  function closeProfileFileModal() {
    if (elProfileFileModal) {
      elProfileFileModal.classList.add("is-hidden");
      elProfileFileModal.setAttribute("aria-hidden", "true");
    }
    profileFileEditingName = null;
    profileFileModalMode = null;
    if (elProfileFileEditor) {
      elProfileFileEditor.value = "";
      elProfileFileEditor.placeholder = "";
    }
    setProfileFileStatus("", null);
  }

  async function loadProfileFileFromApi(prof, filename) {
    const attempts = [
      async () => {
        const r = await fetch(
          "/api/profiles/" +
            encodeURIComponent(prof) +
            "/files/" +
            encodeURIComponent(filename)
        );
        const data = await r.json().catch(() => ({}));
        return { r, data };
      },
      async () => {
        const r = await fetch(
          "/api/profile-file?profile=" +
            encodeURIComponent(prof) +
            "&filename=" +
            encodeURIComponent(filename)
        );
        const data = await r.json().catch(() => ({}));
        return { r, data };
      },
      async () => {
        const r = await fetch("/api/profile-file-read", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ profile: prof, filename }),
        });
        const data = await r.json().catch(() => ({}));
        return { r, data };
      },
    ];

    let last = /** @type {{ r: Response; data: object }} */ ({ r: null, data: {} });
    for (const run of attempts) {
      try {
        const { r, data } = await run();
        last = { r, data };
        if (r.ok) return { r, data };
      } catch (e) {
        last = {
          r: { ok: false, status: 0 },
          data: { detail: String(e) },
        };
      }
    }
    return last;
  }

  async function loadUiConfigFromApi() {
    const attempts = [
      async () => {
        const r = await fetch("/api/ui-config");
        const data = await r.json().catch(() => ({}));
        return { r, data };
      },
      async () => {
        const r = await fetch("/api/ui-config-read", { method: "POST" });
        const data = await r.json().catch(() => ({}));
        return { r, data };
      },
    ];
    let last = /** @type {{ r: Response | null; data: object }} */ ({ r: null, data: {} });
    for (const run of attempts) {
      try {
        const { r, data } = await run();
        last = { r, data };
        if (r.ok) return { r, data };
      } catch (e) {
        last = {
          r: { ok: false, status: 0 },
          data: { detail: String(e) },
        };
      }
    }
    return last;
  }

  async function openProfileFileModal(filename) {
    const prof = state.active;
    if (!prof || !elProfileFileModal || !elProfileFileEditor) return;
    profileFileModalMode = "profile";
    profileFileEditingName = filename;
    setProfileFileStatus("", null);
    if (elProfileFileModalTitle) elProfileFileModalTitle.textContent = filename + ": " + prof;
    if (elProfileFileModalHint) {
      elProfileFileModalHint.innerHTML =
        "File in this profile folder (<code>profiles/" +
        prof +
        "/" +
        filename +
        "</code> on the server process (HERMES_HOME). Save creates the file if it is missing.";
    }
    elProfileFileEditor.value = "";
    elProfileFileEditor.placeholder = "Loading…";
    elProfileFileModal.classList.remove("is-hidden");
    elProfileFileModal.setAttribute("aria-hidden", "false");
    try {
      const { r, data } = await loadProfileFileFromApi(prof, filename);
      elProfileFileEditor.placeholder = "";
      if (!r || !r.ok) {
        const detail = formatApiDetail(data, "Could not load file.");
        const hint404 =
          "All load methods returned 404. The running server is missing the profile-file routes (rebuild/restart with latest server.py), or a proxy is not forwarding /api to this app. " +
          "If the file exists on your PC, the container may use a different HERMES_HOME than you expect.";
        const hint =
          r && r.status === 404 ? detail + " " + hint404 : detail;
        setProfileFileStatus(hint, "error");
        elProfileFileEditor.placeholder = "Load failed. You can type here and try Save.";
        return;
      }
      elProfileFileEditor.value = data.content != null ? data.content : "";
      if (!data.exists) {
        setProfileFileStatus("No file on disk yet for this server HERMES_HOME. Saving will create it.", "info");
      } else {
        setProfileFileStatus("", null);
      }
      requestAnimationFrame(() => {
        elProfileFileEditor.focus();
        const len = elProfileFileEditor.value.length;
        elProfileFileEditor.setSelectionRange(len, len);
      });
    } catch (e) {
      elProfileFileEditor.placeholder = "";
      setProfileFileStatus(String(e), "error");
      elProfileFileEditor.placeholder = "Load failed. You can type here and try Save.";
    }
  }

  async function openUiConfigModal() {
    if (!elProfileFileModal || !elProfileFileEditor) return;
    profileFileModalMode = "ui-config";
    profileFileEditingName = "config.toml";
    setProfileFileStatus("", null);
    if (elProfileFileModalTitle) elProfileFileModalTitle.textContent = "config.toml (UI server)";
    if (elProfileFileModalHint) {
      elProfileFileModalHint.innerHTML =
        "Hermes minimal UI <code>config.toml</code> on the machine running this server (same directory as <code>server.py</code>). Restart uvicorn for changes to Hermes launcher, timeouts, <code>profile_files</code>, or server-side UI text.";
    }
    elProfileFileEditor.value = "";
    elProfileFileEditor.placeholder = "Loading…";
    elProfileFileModal.classList.remove("is-hidden");
    elProfileFileModal.setAttribute("aria-hidden", "false");
    try {
      const { r, data } = await loadUiConfigFromApi();
      elProfileFileEditor.placeholder = "";
      if (!r || !r.ok) {
        const detail = formatApiDetail(data, "Could not load config.");
        const hint404 =
          " UI config routes missing or proxy blocks them. Rebuild/restart with latest server.py or fix /api proxy.";
        const hint = r && r.status === 404 ? detail + hint404 : detail;
        setProfileFileStatus(hint, "error");
        elProfileFileEditor.placeholder = "Load failed. You can type here and try Save.";
        return;
      }
      elProfileFileEditor.value = data.content != null ? data.content : "";
      if (!data.exists) {
        setProfileFileStatus("No config.toml on the server yet. Saving will create it.", "info");
      } else {
        setProfileFileStatus("", null);
      }
      requestAnimationFrame(() => {
        elProfileFileEditor.focus();
        const len = elProfileFileEditor.value.length;
        elProfileFileEditor.setSelectionRange(len, len);
      });
    } catch (e) {
      elProfileFileEditor.placeholder = "";
      setProfileFileStatus(String(e), "error");
      elProfileFileEditor.placeholder = "Load failed. You can type here and try Save.";
    }
  }

  async function saveProfileFileToApi(prof, filename, content) {
    const attempts = [
      async () =>
        fetch(
          "/api/profiles/" +
            encodeURIComponent(prof) +
            "/files/" +
            encodeURIComponent(filename),
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content }),
          }
        ),
      async () =>
        fetch("/api/profile-file", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ profile: prof, filename, content }),
        }),
      async () =>
        fetch("/api/profile-file-write", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ profile: prof, filename, content }),
        }),
    ];

    let lastR = /** @type {Response | null} */ (null);
    let lastData = {};
    for (const run of attempts) {
      try {
        const r = await run();
        const data = await r.json().catch(() => ({}));
        lastR = r;
        lastData = data;
        if (r.ok) return { r, data };
      } catch (e) {
        lastData = { detail: String(e) };
      }
    }
    return { r: lastR, data: lastData };
  }

  async function saveUiConfigToApi(content) {
    const attempts = [
      async () =>
        fetch("/api/ui-config", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
        }),
      async () =>
        fetch("/api/ui-config-write", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
        }),
    ];
    let lastR = /** @type {Response | null} */ (null);
    let lastData = {};
    for (const run of attempts) {
      try {
        const r = await run();
        const data = await r.json().catch(() => ({}));
        lastR = r;
        lastData = data;
        if (r.ok) return { r, data };
      } catch (e) {
        lastData = { detail: String(e) };
      }
    }
    return { r: lastR, data: lastData };
  }

  async function saveProfileFile() {
    if (!elProfileFileEditor) return;
    if (profileFileModalMode === "ui-config") {
      setProfileFileStatus("", null);
      try {
        const { r, data } = await saveUiConfigToApi(elProfileFileEditor.value);
        if (!r || !r.ok) {
          const msg = formatApiDetail(data, "Save failed.");
          const extra404 =
            " UI config save routes failed. Rebuild/restart the server with latest server.py or fix /api proxy.";
          const msgOut = r && r.status === 404 ? msg + extra404 : msg;
          setProfileFileStatus(msgOut, "error");
          return;
        }
        closeProfileFileModal();
      } catch (e) {
        setProfileFileStatus(String(e), "error");
      }
      return;
    }
    const prof = state.active;
    const name = profileFileEditingName;
    if (!prof || !name) return;
    setProfileFileStatus("", null);
    try {
      const { r, data } = await saveProfileFileToApi(prof, name, elProfileFileEditor.value);
      if (!r || !r.ok) {
        const msg = formatApiDetail(data, "Save failed.");
        const extra404 =
          " All save routes failed. Rebuild/restart the server with latest server.py or fix /api proxy.";
        const msgOut = r && r.status === 404 ? msg + extra404 : msg;
        setProfileFileStatus(msgOut, "error");
        return;
      }
      closeProfileFileModal();
    } catch (e) {
      setProfileFileStatus(String(e), "error");
    }
  }

  function shQuoteCliArg(s) {
    const t = String(s);
    if (/^[-a-zA-Z0-9_./:@\\]+$/.test(t)) return t;
    return "'" + t.replace(/'/g, "'\\''") + "'";
  }

  /** Short launcher for the footer only (real subprocess still uses full path on the server). */
  function launcherArgvForDisplay(launcher) {
    if (!Array.isArray(launcher) || launcher.length === 0) {
      return ["hermes"];
    }
    const exe = String(launcher[0]);
    const base = exe.replace(/^.*[/\\]/, "").replace(/\.exe$/i, "");
    if (
      launcher.length >= 3 &&
      launcher[1] === "-m" &&
      launcher[2] === "hermes_cli.main" &&
      /^python/i.test(base)
    ) {
      return ["python", "-m", "hermes_cli.main"];
    }
    if (launcher.length === 1) {
      return [base || exe];
    }
    return launcher.slice();
  }

  function buildCliProtoLine(launcher, profileName, st) {
    const extra = (st && st.extra_args && String(st.extra_args).trim()) || "";
    const addQ = !st || st.adds_quiet_flag !== false;
    let line = launcher.map(shQuoteCliArg).join(" ");
    line += " --profile " + shQuoteCliArg(profileName) + " chat";
    if (addQ) line += " -Q";
    line += " -q " + shQuoteCliArg("<message>");
    if (extra) line += " " + extra;
    return line;
  }

  async function refreshCliPreview() {
    if (!elComposerCliLine) return;
    const profileOk = state.active && state.profiles.includes(state.active);
    const profileName = profileOk ? state.active : "";
    const resume =
      elSessionSelect && elSessionSelect.value ? String(elSessionSelect.value).trim() : "";

    const params = new URLSearchParams();
    if (profileName) params.set("profile", profileName);
    if (resume) params.set("resume_session_id", resume);
    try {
      const r = await fetch("/api/cli-preview?" + params.toString());
      if (r.ok) {
        const d = await r.json();
        const ui = d.ui || {};
        const caption =
          typeof ui.cli_caption === "string" && ui.cli_caption.trim()
            ? ui.cli_caption.trim() + ": "
            : "CLI: ";
        elComposerCliLine.textContent = caption + (d.display || "");
        return;
      }
    } catch (_) {}

    const fallbackProfile = profileOk ? state.active : "<profile>";
    let health = null;
    try {
      const r = await fetch("/api/health");
      if (r.ok) health = await r.json();
    } catch (_) {}

    let line;
    if (health && Array.isArray(health.hermes_launcher) && health.hermes_launcher.length) {
      const st = health.hermes_chat_settings || {};
      line = buildCliProtoLine(
        launcherArgvForDisplay(health.hermes_launcher),
        fallbackProfile,
        st
      );
    } else {
      line =
        "python -m hermes_cli.main --profile " +
        fallbackProfile +
        " chat -Q -q " +
        shQuoteCliArg("<message>");
    }
    if (resume) {
      line += " --resume " + shQuoteCliArg(resume);
    }
    const uiFb = health && health.ui ? health.ui : {};
    const capFb =
      typeof uiFb.cli_caption === "string" && uiFb.cli_caption.trim()
        ? uiFb.cli_caption.trim() + ": "
        : "CLI: ";
    elComposerCliLine.textContent = capFb + line;
  }

  function buildTabs(profiles) {
    elTabs.innerHTML = "";
    profiles.forEach((p) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "profile-tab";
      btn.setAttribute("role", "tab");
      btn.setAttribute("data-profile", p);
      btn.setAttribute("id", "tab-" + p);
      btn.setAttribute("aria-controls", "messages");
      btn.textContent = p;
      btn.addEventListener("click", () => void setActiveProfile(p));
      btn.addEventListener("keydown", (ev) => {
        const n = profiles.length;
        const idx = profiles.indexOf(p);
        if (ev.key === "ArrowRight" || ev.key === "ArrowDown") {
          ev.preventDefault();
          const next = profiles[(idx + 1) % n];
          void setActiveProfile(next);
          elTabs.querySelector('[data-profile="' + next + '"]').focus();
        } else if (ev.key === "ArrowLeft" || ev.key === "ArrowUp") {
          ev.preventDefault();
          const prev = profiles[(idx - 1 + n) % n];
          void setActiveProfile(prev);
          elTabs.querySelector('[data-profile="' + prev + '"]').focus();
        }
      });
      elTabs.appendChild(btn);
      if (!state.history[p]) state.history[p] = [];
    });
  }

  async function fetchHistory(profile) {
    const r = await fetch("/api/history/" + encodeURIComponent(profile));
    if (!r.ok) return;
    const d = await r.json();
    const msgs = (d.messages || []).map(mapApiMessage);
    restoreUserTs(profile, msgs);
    state.history[profile] = msgs;
    state.revByProfile[profile] = d.rev || 0;
  }

  function fillCronProfileSelect() {
    if (!elModalCronProfile) return;
    const cur = elModalCronProfile.value;
    elModalCronProfile.innerHTML = "";
    for (const p of state.profiles) {
      const opt = document.createElement("option");
      opt.value = p;
      opt.textContent = p;
      elModalCronProfile.appendChild(opt);
    }
    if (cur && state.profiles.includes(cur)) elModalCronProfile.value = cur;
    else if (state.active) elModalCronProfile.value = state.active;
  }

  /** Ported from AgentChat `updateChatScheduleUI`. */
  function updateChatScheduleUI() {
    const stel = document.getElementById("chat-schedule-type");
    if (!stel || !elCronModalForm) return;
    const type = stel.value;
    elCronModalForm.querySelectorAll(".chat-schedule-ui").forEach((u) => {
      u.classList.add("hidden");
      u.classList.remove("schedule-ui-grid");
    });
    const active = document.getElementById("chat-ui-" + type);
    if (!active) return;
    if (type === "interval" || type === "weekly") {
      active.classList.remove("hidden");
      active.classList.add("schedule-ui-grid");
    } else {
      active.classList.remove("hidden");
    }
  }

  /** Ported from AgentChat `formatScheduleDisplay`. */
  function formatScheduleDisplay(schedule) {
    if (!schedule) return "-";
    const s = String(schedule);
    if (s.startsWith("interval:")) {
      const val = s.replace("interval:", "");
      const num = val.slice(0, -1);
      const unit = val.slice(-1);
      const unitMap = { s: "seconds", m: "minutes", h: "hours", d: "days" };
      return "Every " + num + " " + (unitMap[unit] || unit);
    }
    if (s.startsWith("cron:")) {
      const cron = s.replace("cron:", "").trim();
      const parts = cron.split(/\s+/);
      if (parts.length === 5) {
        if (parts[2] === "*" && parts[3] === "*" && parts[4] === "*") {
          return "Daily at " + parts[1].padStart(2, "0") + ":" + parts[0].padStart(2, "0");
        }
        if (parts[2] === "*" && parts[3] === "*" && parts[4] !== "*") {
          const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
          const d = parseInt(parts[4], 10);
          const dayLabel = days[d] != null ? days[d] : parts[4];
          return "Weekly (" + dayLabel + ") at " + parts[1].padStart(2, "0") + ":" + parts[0].padStart(2, "0");
        }
      }
      return "Cron: " + cron;
    }
    if (s.startsWith("date:")) {
      return "Once on " + s.replace("date:", "").trim();
    }
    return s;
  }

  /** Ported from AgentChat `openChatScheduleModal` (schedule parsing only). */
  function applyScheduleToModal(sched) {
    const s = sched && String(sched).trim() ? String(sched).trim() : DEFAULT_SCHEDULE;
    if (s.startsWith("interval:")) {
      document.getElementById("chat-schedule-type").value = "interval";
      const valStr = s.replace("interval:", "");
      const unit = valStr.slice(-1);
      const valRaw = valStr.slice(0, -1);
      const valNum = parseInt(valRaw, 10);
      if (unit === "s") {
        document.getElementById("chat-interval-unit").value = "m";
        document.getElementById("chat-interval-val").value = String(
          Math.max(1, Math.round((Number.isFinite(valNum) ? valNum : 60) / 60)),
        );
      } else {
        document.getElementById("chat-interval-val").value = valRaw || "15";
        document.getElementById("chat-interval-unit").value =
          unit === "m" || unit === "h" || unit === "d" ? unit : "m";
      }
    } else if (s.startsWith("date:")) {
      document.getElementById("chat-schedule-type").value = "once";
      const rawOnce = s.replace("date:", "").trim().replace(" ", "T");
      const elOnce = document.getElementById("chat-once-datetime");
      elOnce.value = rawOnce.length >= 16 ? rawOnce.slice(0, 16) : rawOnce;
    } else if (s.startsWith("cron:")) {
      const cron = s.replace("cron:", "").trim();
      const parts = cron.split(/\s+/);
      if (parts.length === 5 && parts[2] === "*" && parts[3] === "*" && parts[4] === "*") {
        document.getElementById("chat-schedule-type").value = "daily";
        document.getElementById("chat-daily-time").value =
          parts[1].padStart(2, "0") + ":" + parts[0].padStart(2, "0");
      } else if (parts.length === 5 && parts[2] === "*" && parts[3] === "*" && parts[4] !== "*") {
        document.getElementById("chat-schedule-type").value = "weekly";
        document.getElementById("chat-weekly-time").value =
          parts[1].padStart(2, "0") + ":" + parts[0].padStart(2, "0");
        document.getElementById("chat-weekly-day").value = parts[4];
      } else {
        document.getElementById("chat-schedule-type").value = "cron";
        document.getElementById("chat-cron-expr").value = cron;
      }
    } else {
      document.getElementById("chat-schedule-type").value = "interval";
    }
    updateChatScheduleUI();
  }

  /** Ported from AgentChat `saveChatSchedule`. */
  function buildScheduleStringFromModal() {
    const type = document.getElementById("chat-schedule-type").value;
    let newSchedule = "";
    if (type === "interval") {
      const val = document.getElementById("chat-interval-val").value;
      const unit = document.getElementById("chat-interval-unit").value;
      newSchedule = "interval:" + val + unit;
    } else if (type === "daily") {
      const time = document.getElementById("chat-daily-time").value;
      if (!time) {
        window.alert("Please select a time");
        return null;
      }
      const hm = time.split(":");
      newSchedule = "cron:" + parseInt(hm[1], 10) + " " + parseInt(hm[0], 10) + " * * *";
    } else if (type === "weekly") {
      const day = document.getElementById("chat-weekly-day").value;
      const time = document.getElementById("chat-weekly-time").value;
      if (!time) {
        window.alert("Please select a time");
        return null;
      }
      const hm = time.split(":");
      newSchedule = "cron:" + parseInt(hm[1], 10) + " " + parseInt(hm[0], 10) + " * * " + day;
    } else if (type === "once") {
      const dt = document.getElementById("chat-once-datetime").value;
      if (!dt) {
        window.alert("Please select a date and time");
        return null;
      }
      newSchedule = "date:" + dt.replace("T", " ") + ":00";
    } else if (type === "cron") {
      newSchedule = "cron:" + document.getElementById("chat-cron-expr").value.trim();
    }
    return newSchedule;
  }

  function isCronModalOpen() {
    return elCronModal && !elCronModal.classList.contains("is-hidden");
  }

  function isProfileFileModalOpen() {
    return elProfileFileModal && !elProfileFileModal.classList.contains("is-hidden");
  }

  function openCronModalAdd() {
    if (!elCronModal) return;
    cronModalEditingId = null;
    cronModalEditingEnabled = true;
    elCronModalTitle.textContent = "Add job";
    elCronModalForm.reset();
    applyScheduleToModal(DEFAULT_SCHEDULE);
    fillCronProfileSelect();
    if (state.active && elModalCronProfile) elModalCronProfile.value = state.active;
    elCronModal.classList.remove("is-hidden");
    elCronModal.setAttribute("aria-hidden", "false");
    elModalCronName.focus();
  }

  function openCronModalEdit(j) {
    if (!elCronModal) return;
    cronModalEditingId = j.id || null;
    cronModalEditingEnabled = !!j.enabled;
    elCronModalTitle.textContent = "Edit job";
    fillCronProfileSelect();
    elModalCronName.value = j.name || "";
    if (elModalCronProfile) elModalCronProfile.value = j.profile || state.active || "";
    elModalCronPrompt.value = j.prompt || "";
    applyScheduleToModal(j.schedule || DEFAULT_SCHEDULE);
    elCronModal.classList.remove("is-hidden");
    elCronModal.setAttribute("aria-hidden", "false");
    elModalCronName.focus();
  }

  function closeCronModal() {
    if (elCronModal) {
      elCronModal.classList.add("is-hidden");
      elCronModal.setAttribute("aria-hidden", "true");
    }
    cronModalEditingId = null;
  }

  function setCronPanel(open) {
    state.cronPanelOpen = open;
    if (btnCronToggle) btnCronToggle.setAttribute("aria-pressed", open ? "true" : "false");
    if (elWorkspacePanel) elWorkspacePanel.classList.toggle("is-hidden", open);
    if (elCronPanel) {
      elCronPanel.classList.toggle("is-hidden", !open);
      elCronPanel.setAttribute("aria-hidden", open ? "false" : "true");
    }
    if (open) {
      fillCronProfileSelect();
      loadCrons();
    }
  }

  function formatTime(ts) {
    if (ts == null || ts === "") return "never";
    const n = typeof ts === "number" ? ts * 1000 : Date.parse(ts);
    if (Number.isNaN(n)) return String(ts);
    return new Date(n).toLocaleString();
  }

  async function loadCrons() {
    if (!elCronJobList) return;
    const r = await fetch("/api/crons");
    if (!r.ok) {
      elCronJobList.textContent = "Could not load jobs.";
      return;
    }
    const data = await r.json();
    const jobs = data.jobs || [];
    elCronJobList.innerHTML = "";
    if (jobs.length === 0) {
      elCronJobList.innerHTML = '<p class="pane-placeholder">No scheduled jobs yet.</p>';
      return;
    }
    for (const j of jobs) {
      const card = document.createElement("div");
      card.className = "cron-job-card";
      const en = !!j.enabled;
      card.innerHTML =
        '<div class="cron-job-card-top">' +
        '<span class="cron-job-name"></span>' +
        '<span class="badge"></span>' +
        "</div>" +
        '<div class="cron-job-meta">' +
        '<div class="cron-job-meta-primary"></div>' +
        '<div class="cron-job-meta-last"></div>' +
        '<div class="cron-job-meta-next"></div>' +
        "</div>" +
        '<p class="cron-job-hint"></p>' +
        '<div class="cron-job-actions">' +
        '<button type="button" class="btn-run">Run now</button>' +
        '<button type="button" class="btn-edit">Edit</button>' +
        '<button type="button" class="btn-pause"></button>' +
        '<button type="button" class="danger btn-del">Delete</button>' +
        "</div>";
      card.querySelector(".cron-job-name").textContent = j.name || j.id;
      const badge = card.querySelector(".badge");
      badge.textContent = en ? "on" : "off";
      badge.className = "badge " + (en ? "badge-on" : "badge-off");
      card.querySelector(".cron-job-meta-primary").textContent =
        "Profile: " + (j.profile || "?") + " · " + formatScheduleDisplay(j.schedule);
      card.querySelector(".cron-job-meta-last").textContent =
        "last run: " + formatTime(j.last_run_at);
      const nextTxt =
        j.next_run_at != null && j.next_run_at !== ""
          ? formatTime(
              typeof j.next_run_at === "number" ? j.next_run_at : Number(j.next_run_at),
            )
          : "n/a";
      card.querySelector(".cron-job-meta-next").textContent = "next-run: " + nextTxt;
      const cmd = String(j.prompt || "")
        .trim()
        .replace(/\s+/g, " ");
      const hint =
        cmd.length > 120 ? cmd.slice(0, 120) + "\u2026" : cmd;
      card.querySelector(".cron-job-hint").textContent = hint || "(no prompt)";
      const id = j.id;
      card.querySelector(".btn-edit").addEventListener("click", () => openCronModalEdit(j));
      card.querySelector(".btn-run").addEventListener("click", async () => {
        await fetch("/api/crons/" + encodeURIComponent(id) + "/run", { method: "POST" });
        await loadCrons();
        const bump = () => void pollAllHistories();
        bump();
        setTimeout(bump, 2500);
        setTimeout(bump, 8000);
      });
      const btnPause = card.querySelector(".btn-pause");
      btnPause.textContent = en ? "Pause" : "Resume";
      btnPause.addEventListener("click", async () => {
        await fetch("/api/crons/" + encodeURIComponent(id), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: !en }),
        });
        await loadCrons();
      });
      card.querySelector(".btn-del").addEventListener("click", async () => {
        if (!confirm("Delete this job?")) return;
        await fetch("/api/crons/" + encodeURIComponent(id), { method: "DELETE" });
        await loadCrons();
      });
      elCronJobList.appendChild(card);
    }
  }

  if (btnCronToggle) {
    btnCronToggle.addEventListener("click", () => setCronPanel(!state.cronPanelOpen));
  }

  if (btnCronOpenModal) {
    btnCronOpenModal.addEventListener("click", () => openCronModalAdd());
  }

  document.getElementById("chat-schedule-type")?.addEventListener("change", () => updateChatScheduleUI());

  document.getElementById("scheduleCancel")?.addEventListener("click", () => closeCronModal());

  if (elCronModal) {
    elCronModal.addEventListener("mousedown", (ev) => {
      if (ev.button !== 0) return;
      if (ev.target === elCronModal) closeCronModal();
    });
  }

  if (elProfileFileModal) {
    elProfileFileModal.addEventListener("mousedown", (ev) => {
      if (ev.button !== 0) return;
      if (ev.target === elProfileFileModal) closeProfileFileModal();
    });
  }

  if (elAttachModal) {
    elAttachModal.addEventListener("mousedown", (ev) => {
      if (ev.button !== 0) return;
      if (ev.target === elAttachModal) closeAttachModal();
    });
  }

  btnComposerAttach?.addEventListener("click", () => {
    if (btnComposerAttach.disabled) return;
    elComposerFileInput?.click();
  });

  elComposerFileInput?.addEventListener("change", () => {
    const f = elComposerFileInput.files && elComposerFileInput.files[0];
    if (f) openAttachModalForFile(f);
  });

  btnAttachModalCancel?.addEventListener("click", () => closeAttachModal());
  btnAttachModalUpload?.addEventListener("click", () => void confirmAttachUpload());

  btnProfileFileCancel?.addEventListener("click", () => closeProfileFileModal());
  btnProfileFileModalClose?.addEventListener("click", () => closeProfileFileModal());
  btnProfileFileSave?.addEventListener("click", () => void saveProfileFile());
  if (btnUiConfig) {
    btnUiConfig.addEventListener("click", () => void openUiConfigModal());
  }

  document.addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape") return;
    if (isCronModalOpen()) {
      ev.preventDefault();
      closeCronModal();
      return;
    }
    if (isAttachModalOpen()) {
      ev.preventDefault();
      closeAttachModal();
      return;
    }
    if (isProfileFileModalOpen()) {
      ev.preventDefault();
      closeProfileFileModal();
    }
  });

  if (elCronModalForm) {
    elCronModalForm.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const name = elModalCronName.value.trim();
      const profile = elModalCronProfile.value;
      const prompt = elModalCronPrompt.value.trim();
      if (!name || !profile || !prompt) {
        alert("Name, profile, and prompt are required.");
        return;
      }
      const newSchedule = buildScheduleStringFromModal();
      if (newSchedule == null || newSchedule === "") return;
      const editing = cronModalEditingId;
      const en = editing ? cronModalEditingEnabled : true;
      const body = { name, profile, prompt, enabled: en, schedule: newSchedule };
      const url = editing ? "/api/crons/" + encodeURIComponent(editing) : "/api/crons";
      const method = editing ? "PATCH" : "POST";
      const r = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        const msg = err.detail;
        alert(typeof msg === "string" ? msg : JSON.stringify(msg) || "Could not save job");
        return;
      }
      closeCronModal();
      await loadCrons();
    });
  }

  let pollHistoryTimer = null;

  async function pollAllHistories() {
    const profiles = state.profiles;
    if (!profiles.length) return;
    const active = state.active;
    let activeUpdated = false;
    const awaitingChat = pendingNode !== null;
    await Promise.all(
      profiles.map(async (p) => {
        try {
          const r = await fetch("/api/history/" + encodeURIComponent(p));
          if (!r.ok) return;
          const d = await r.json();
          const rev = d.rev || 0;
          if (rev > (state.revByProfile[p] || 0)) {
            if (awaitingChat && p === active) {
              return;
            }
            state.revByProfile[p] = rev;
            const msgs = (d.messages || []).map(mapApiMessage);
            restoreUserTs(p, msgs);
            state.history[p] = msgs;
            if (p === active) activeUpdated = true;
          }
        } catch (_) {}
      })
    );
    if (activeUpdated) renderMessages();
  }

  function startHistoryPoll() {
    if (pollHistoryTimer) clearInterval(pollHistoryTimer);
    pollHistoryTimer = setInterval(() => void pollAllHistories(), 2000);
  }

  let pollCronsTimer = null;
  function startCronListPoll() {
    if (pollCronsTimer) clearInterval(pollCronsTimer);
    pollCronsTimer = setInterval(() => {
      if (state.cronPanelOpen) loadCrons();
    }, 5000);
  }

  async function loadProfiles() {
    const r = await fetch("/api/profiles");
    if (!r.ok) throw new Error("profiles " + r.status);
    const data = await r.json();
    const profiles = data.profiles || [];
    state.profileFiles = normalizeProfileFilesFromApi(data.profile_files);
    if (profiles.length === 0) {
      elSend.disabled = true;
      if (elSessionSelect) elSessionSelect.disabled = true;
      setSkillsCascadeLocked(true);
      state.profiles = [];
      state.active = null;
      void refreshCliPreview();
      renderProfileFilesList();
      elMessages.innerHTML = "";
      const div = document.createElement("div");
      div.className = "bubble meta";
      div.textContent =
        "No subfolders found under profiles/. Set HERMES_HOME if Hermes data lives elsewhere.";
      elMessages.appendChild(div);
      updateComposerAttachEnabled();
      return;
    }
    state.profiles = profiles;
    buildTabs(profiles);
    await Promise.all(profiles.map((p) => fetchHistory(p)));
    if (profiles.length) await setActiveProfile(profiles[0]);
    fillCronProfileSelect();
  }

  async function send() {
    const profile = state.active;
    const text = elInput.value.trim();
    if (!profile || !text) return;

    elSend.disabled = true;
    appendToActive("user", text);
    elInput.value = "";
    showPending();

    try {
      const resume_session_id =
        elSessionSelect && elSessionSelect.value ? String(elSessionSelect.value).trim() : "";
      const payload = { profile, message: text };
      if (resume_session_id) payload.resume_session_id = resume_session_id;
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await r.json().catch(() => ({}));
      hidePending();
      if (!r.ok) {
        const msg = data.detail || data.message || JSON.stringify(data) || r.statusText;
        appendToActive("assistant", String(msg), "error");
        return;
      }
      if (data.messages && Array.isArray(data.messages) && data.messages.length) {
        const msgs = data.messages.map(mapApiMessage);
        restoreUserTs(profile, msgs);
        persistUserTs(profile, msgs);
        state.history[profile] = msgs;
        if (data.rev != null) state.revByProfile[profile] = data.rev;
        renderMessages();
        return;
      }
      let out = data.stdout || "";
      if (data.stderr && data.stderr.trim()) {
        out += (out ? "\n\n" : "") + "[stderr]\n" + data.stderr;
      }
      if (data.returncode !== 0) {
        out += (out ? "\n\n" : "") + "[exit " + data.returncode + "]";
      }
      if (!out.trim()) {
        out = "(empty output)";
      }
      appendToActive("assistant", out);
    } catch (e) {
      hidePending();
      appendToActive("assistant", String(e), "error");
    } finally {
      hidePending();
      elSend.disabled = !state.active;
    }
  }

  elSessionSelect?.addEventListener("change", () => {
    if (state.active) saveResumeForProfile(state.active, elSessionSelect.value);
    void refreshCliPreview();
  });

  elSkillCategoryList?.addEventListener("click", (ev) => {
    if (skillSelectsSync) return;
    const profile = state.active;
    if (!profile) return;
    const btn = ev.target.closest(".skills-cascade-item");
    if (!btn || !elSkillCategoryList.contains(btn)) return;
    const cat = String(btn.dataset.category || "").trim();
    skillUiCategory = cat;
    skillUiSkill = "";
    skillUiLeaf = false;
    renderCategoryList(skillCategoriesCache, skillUiCategory);
    saveSkillPickForProfile(profile, skillUiCategory, "", false);
    if (!skillUiCategory) {
      showSkillPanePlaceholder("Select a category", false);
      syncComposerSkillLineFromPicker();
      return;
    }
    void loadSkillsForCategory(profile, skillUiCategory, "").then(() => {
      saveSkillPickForProfile(profile, skillUiCategory, skillUiSkill, skillUiLeaf);
    });
  });

  elSkillNameList?.addEventListener("click", (ev) => {
    if (skillSelectsSync) return;
    const profile = state.active;
    if (!profile) return;
    const btn = ev.target.closest(".skills-cascade-item");
    if (!btn || !elSkillNameList.contains(btn)) return;
    const sk = String(btn.dataset.skill || "").trim();
    skillUiSkill = sk;
    renderSkillList(skillSkillsCache, skillUiSkill);
    saveSkillPickForProfile(profile, skillUiCategory, skillUiSkill, false);
    syncComposerSkillLineFromPicker();
  });

  elSend.addEventListener("click", send);
  elInput.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && !ev.shiftKey) {
      ev.preventDefault();
      send();
    }
  });

  loadProfiles()
    .then(() => {
      startHistoryPoll();
      startCronListPoll();
    })
    .catch((e) => {
      elMessages.innerHTML = "";
      const div = document.createElement("div");
      div.className = "bubble meta";
      div.textContent = "Failed to load profiles: " + e;
      elMessages.appendChild(div);
    });
})();
