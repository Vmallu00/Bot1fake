/* FakePixel SkyBlock Builder - Web Panel */

(() => {
  "use strict";

  const socket = typeof io === "function" ? io() : null;

  const state = {
    bots: [],
    schematics: [],
    builds: [],
    trades: [],
    coop: [],
    errors: [],
    activity: [],
    connected: false,
    currentPage: "dashboard"
  };

  const $ = (id) => document.getElementById(id);

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function collection(value) {
    if (Array.isArray(value)) return value;

    if (value && typeof value === "object") {
      return Object.entries(value).map(([id, item]) => ({
        ...(item || {}),
        id: item?.id || id
      }));
    }

    return [];
  }

  function botId(bot) {
    return bot?.id || bot?.username || bot?.name;
  }

  function formatDate(value) {
    if (!value) return "—";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return escapeHtml(value);
    }

    return date.toLocaleString();
  }

  function formatBytes(bytes) {
    const n = Number(bytes);

    if (!Number.isFinite(n) || n <= 0) return "0 B";

    const units = ["B", "KB", "MB", "GB", "TB"];
    const index = Math.min(
      Math.floor(Math.log(n) / Math.log(1024)),
      units.length - 1
    );

    return `${(n / Math.pow(1024, index)).toFixed(index ? 1 : 0)} ${
      units[index]
    }`;
  }

  function toast(message, type = "info") {
    const container = $("toastContainer");

    if (!container) return;

    const item = document.createElement("div");
    item.className = `toast toast-${type}`;
    item.textContent = message;

    container.appendChild(item);

    setTimeout(() => {
      item.classList.add("toast-hide");

      setTimeout(() => item.remove(), 300);
    }, 3500);
  }

  async function request(url, options = {}) {
    const config = {
      credentials: "same-origin",
      ...options,
      headers: {
        ...(options.body instanceof FormData
          ? {}
          : { "Content-Type": "application/json" }),
        ...(options.headers || {})
      }
    };

    const response = await fetch(url, config);

    if (!response.ok) {
      let message = `HTTP ${response.status}`;

      try {
        const data = await response.json();
        message = data.error || data.message || message;
      } catch (_) {}

      throw new Error(message);
    }

    const type = response.headers.get("content-type") || "";

    if (type.includes("application/json")) {
      return response.json();
    }

    return response.text();
  }

  async function tryRequest(urls, options = {}) {
    let lastError;

    for (const url of urls) {
      try {
        return await request(url, options);
      } catch (error) {
        lastError = error;

        if (error.message.startsWith("HTTP 4")) {
          continue;
        }
      }
    }

    throw lastError || new Error("Request failed");
  }

  function setConnection(connected, text) {
    state.connected = connected;

    const dot = $("connectionDot");
    const label = $("connectionText");

    if (dot) {
      dot.classList.toggle("online", connected);
      dot.classList.toggle("offline", !connected);
    }

    if (label) {
      label.textContent = text || (connected ? "Connected" : "Disconnected");
    }
  }

  function addActivity(message, type = "info") {
    state.activity.unshift({
      message,
      type,
      time: Date.now()
    });

    state.activity = state.activity.slice(0, 100);

    renderDashboardActivity();
  }

  function addError(error) {
    const item = {
      message:
        typeof error === "string"
          ? error
          : error?.message || "Unknown error",
      time: Date.now()
    };

    state.errors.unshift(item);
    state.errors = state.errors.slice(0, 100);

    renderErrors();
    updateStats();
  }

  function normalizeState(data) {
    if (!data || typeof data !== "object") return;

    if (data.state && typeof data.state === "object") {
      data = data.state;
    }

    if (data.bots !== undefined) {
      state.bots = collection(data.bots);
    }

    if (data.schematics !== undefined) {
      state.schematics = collection(data.schematics);
    }

    if (data.builds !== undefined) {
      state.builds = collection(data.builds);
    }

    if (data.trades !== undefined) {
      state.trades = collection(data.trades);
    }

    if (data.coop !== undefined) {
      state.coop = collection(data.coop);
    }

    if (data.coopRequests !== undefined) {
      state.coop = collection(data.coopRequests);
    }

    if (data.errors !== undefined) {
      state.errors = collection(data.errors);
    }
  }

  async function loadState() {
    try {
      const data = await request("/api/state");

      normalizeState(data);

      renderEverything();

      setConnection(true, "Connected");
    } catch (error) {
      addError(error);
      setConnection(false, "API unavailable");
    }
  }

  async function loadResources() {
    const endpoints = [
      ["bots", "/api/bots"],
      ["schematics", "/api/schematics"],
      ["builds", "/api/builds"],
      ["trades", "/api/trades"],
      ["coop", "/api/coop"]
    ];

    await Promise.allSettled(
      endpoints.map(async ([key, url]) => {
        try {
          const data = await request(url);

          if (Array.isArray(data)) {
            state[key] = data;
          } else if (data?.items) {
            state[key] = collection(data.items);
          } else if (data?.[key]) {
            state[key] = collection(data[key]);
          }
        } catch (_) {
          // /api/state can provide these resources.
        }
      })
    );

    renderEverything();
  }

  function updateStats() {
    const online = state.bots.filter((bot) => {
      const status = String(
        bot.status || bot.state || bot.connection || ""
      ).toLowerCase();

      return (
        bot.online === true ||
        status === "online" ||
        status === "connected" ||
        status === "building"
      );
    }).length;

    const activeBuilds = state.builds.filter((build) => {
      const status = String(build.status || "").toLowerCase();

      return [
        "building",
        "running",
        "active",
        "waiting-materials",
        "paused",
        "blocked"
      ].includes(status);
    }).length;

    if ($("statOnlineBots")) {
      $("statOnlineBots").textContent = online;
    }

    if ($("statActiveBuilds")) {
      $("statActiveBuilds").textContent = activeBuilds;
    }

    if ($("statSchematics")) {
      $("statSchematics").textContent = state.schematics.length;
    }

    if ($("statErrors")) {
      $("statErrors").textContent = state.errors.length;
    }
  }

  function statusClass(status) {
    const value = String(status || "").toLowerCase();

    if (
      ["online", "connected", "building", "running", "active"].includes(
        value
      )
    ) {
      return "online";
    }

    if (
      ["offline", "disconnected", "error", "failed", "blocked"].includes(
        value
      )
    ) {
      return "offline";
    }

    return "warning";
  }

  function renderDashboardBots() {
    const container = $("dashboardBots");

    if (!container) return;

    if (!state.bots.length) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🤖</div>
          <h3>No bots configured</h3>
          <p>Add your first FakePixel bot to get started.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = state.bots
      .slice(0, 6)
      .map((bot) => {
        const id = botId(bot);
        const status =
          bot.status ||
          bot.state ||
          (bot.online ? "online" : "offline");

        return `
          <div class="bot-row">
            <div class="bot-avatar">⚡</div>

            <div class="bot-info">
              <strong>${escapeHtml(bot.username || bot.name || id)}</strong>
              <span>${escapeHtml(bot.targetUsername || "No island target")}</span>
            </div>

            <span class="status ${statusClass(status)}">
              ${escapeHtml(status)}
            </span>
          </div>
        `;
      })
      .join("");
  }

  function renderDashboardBuilds() {
    const container = $("dashboardBuilds");

    if (!container) return;

    const builds = state.builds.slice(0, 6);

    if (!builds.length) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🏗️</div>
          <h3>No builds</h3>
          <p>Create a build from an uploaded schematic.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = builds
      .map((build) => {
        const total = Number(build.totalBlocks || build.total || 0);
        const completed = Number(
          build.completedBlocks || build.completed || build.placed || 0
        );

        const percent =
          total > 0
            ? Math.min(100, Math.round((completed / total) * 100))
            : Number(build.progress || 0);

        return `
          <div class="build-row">
            <div class="build-info">
              <strong>${escapeHtml(
                build.name || build.schematicName || "Unnamed build"
              )}</strong>

              <span>
                ${escapeHtml(build.status || "unknown")}
                · ${completed}/${total || "?"} blocks
              </span>
            </div>

            <div class="progress">
              <div class="progress-bar" style="width:${percent}%"></div>
            </div>

            <span>${percent}%</span>
          </div>
        `;
      })
      .join("");
  }

  function renderDashboardActivity() {
    const container = $("dashboardActivity");

    if (!container) return;

    if (!state.activity.length) {
      container.innerHTML = `
        <div class="empty-state">
          <p>No recent activity.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = state.activity
      .slice(0, 20)
      .map(
        (item) => `
          <div class="activity-item">
            <span class="activity-dot ${escapeHtml(item.type)}"></span>
            <div>
              <span>${escapeHtml(item.message)}</span>
              <small>${formatDate(item.time)}</small>
            </div>
          </div>
        `
      )
      .join("");
  }

  function renderBots() {
    const container = $("botsContainer");

    if (!container) return;

    if (!state.bots.length) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🤖</div>
          <h3>No bots yet</h3>
          <p>Click "Add Bot" to configure a FakePixel account.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = state.bots
      .map((bot) => {
        const id = botId(bot);

        const status =
          bot.status ||
          bot.state ||
          (bot.online ? "online" : "offline");

        const building =
          bot.building === true ||
          String(status).toLowerCase() === "building";

        return `
          <div class="card bot-card">
            <div class="card-header">
              <div>
                <div class="card-title">
                  <span class="bot-avatar">⚡</span>
                  ${escapeHtml(bot.username || bot.name || id)}
                </div>

                <span class="status ${statusClass(status)}">
                  ${escapeHtml(status)}
                </span>
              </div>
            </div>

            <div class="card-body">
              <div class="detail-grid">
                <div>
                  <small>Target Island</small>
                  <strong>${escapeHtml(
                    bot.targetUsername || "Not configured"
                  )}</strong>
                </div>

                <div>
                  <small>Position</small>
                  <strong>${escapeHtml(formatPosition(bot.position))}</strong>
                </div>

                <div>
                  <small>Build</small>
                  <strong>${building ? "Building" : "Idle"}</strong>
                </div>

                <div>
                  <small>Registered</small>
                  <strong>${bot.registered ? "Yes" : "Pending"}</strong>
                </div>
              </div>
            </div>

            <div class="card-actions">
              <button class="btn btn-secondary"
                data-action="bot-command"
                data-id="${escapeHtml(id)}">
                Command
              </button>

              <button class="btn btn-secondary"
                data-action="bot-restart"
                data-id="${escapeHtml(id)}">
                Restart
              </button>

              <button class="btn btn-secondary"
                data-action="bot-reconnect"
                data-id="${escapeHtml(id)}">
                Reconnect
              </button>

              <button class="btn btn-danger"
                data-action="bot-delete"
                data-id="${escapeHtml(id)}">
                Delete
              </button>
            </div>
          </div>
        `;
      })
      .join("");
  }

  function formatPosition(position) {
    if (!position) return "Unknown";

    const x = Number(position.x);
    const y = Number(position.y);
    const z = Number(position.z);

    if ([x, y, z].every(Number.isFinite)) {
      return `${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}`;
    }

    return String(position);
  }

  function renderSchematics() {
    const container = $("schematicsContainer");

    if (!container) return;

    if (!state.schematics.length) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📐</div>
          <h3>No schematics</h3>
          <p>Upload a .schem or .schematic file.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = state.schematics
      .map((schematic) => {
        const id = schematic.id;
        const dimensions =
          schematic.width && schematic.height && schematic.length
            ? `${schematic.width} × ${schematic.height} × ${schematic.length}`
            : "Unknown size";

        const blocks =
          schematic.blockCount ||
          schematic.totalBlocks ||
          schematic.blocks?.length ||
          0;

        return `
          <div class="card schematic-card">
            <div class="card-header">
              <div>
                <div class="card-title">
                  📐 ${escapeHtml(
                    schematic.nickname ||
                      schematic.name ||
                      schematic.filename ||
                      "Unnamed"
                  )}
                </div>

                <span class="muted">
                  ${escapeHtml(schematic.filename || "")}
                </span>
              </div>
            </div>

            <div class="card-body">
              <div class="detail-grid">
                <div>
                  <small>Dimensions</small>
                  <strong>${escapeHtml(dimensions)}</strong>
                </div>

                <div>
                  <small>Blocks</small>
                  <strong>${escapeHtml(blocks)}</strong>
                </div>

                <div>
                  <small>Materials</small>
                  <strong>${escapeHtml(
                    schematic.materialCount ||
                      schematic.materials?.length ||
                      "—"
                  )}</strong>
                </div>
              </div>
            </div>

            <div class="card-actions">
              <button class="btn btn-primary"
                data-action="inspect-schematic"
                data-id="${escapeHtml(id)}">
                Inspect
              </button>

              <button class="btn btn-danger"
                data-action="delete-schematic"
                data-id="${escapeHtml(id)}">
                Delete
              </button>
            </div>
          </div>
        `;
      })
      .join("");
  }

  function renderBuilds() {
    const container = $("buildsContainer");

    if (!container) return;

    if (!state.builds.length) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🏗️</div>
          <h3>No builds</h3>
          <p>Create a build using one of your schematics.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = state.builds
      .map((build) => {
        const total = Number(build.totalBlocks || build.total || 0);
        const completed = Number(
          build.completedBlocks || build.completed || build.placed || 0
        );

        const percent =
          total > 0
            ? Math.min(100, Math.round((completed / total) * 100))
            : Number(build.progress || 0);

        const status = build.status || "unknown";

        return `
          <div class="card build-card">
            <div class="card-header">
              <div>
                <div class="card-title">
                  🏗️ ${escapeHtml(
                    build.name || build.schematicName || "Build"
                  )}
                </div>

                <span class="status ${statusClass(status)}">
                  ${escapeHtml(status)}
                </span>
              </div>

              <strong>${percent}%</strong>
            </div>

            <div class="card-body">
              <div class="progress">
                <div class="progress-bar" style="width:${percent}%"></div>
              </div>

              <div class="detail-grid">
                <div>
                  <small>Bot</small>
                  <strong>${escapeHtml(build.botId || build.bot || "—")}</strong>
                </div>

                <div>
                  <small>Blocks</small>
                  <strong>${completed}/${total || "?"}</strong>
                </div>

                <div>
                  <small>Position</small>
                  <strong>
                    ${escapeHtml(
                      build.x !== undefined
                        ? `${build.x}, ${build.y}, ${build.z}`
                        : "—"
                    )}
                  </strong>
                </div>

                <div>
                  <small>Updated</small>
                  <strong>${formatDate(
                    build.updatedAt || build.updated
                  )}</strong>
                </div>
              </div>
            </div>

            <div class="card-actions">
              <button class="btn btn-secondary"
                data-action="build-pause"
                data-id="${escapeHtml(build.id)}">
                Pause
              </button>

              <button class="btn btn-primary"
                data-action="build-resume"
                data-id="${escapeHtml(build.id)}">
                Resume
              </button>

              <button class="btn btn-danger"
                data-action="build-cancel"
                data-id="${escapeHtml(build.id)}">
                Cancel
              </button>
            </div>
          </div>
        `;
      })
      .join("");
  }

  function renderTrades() {
    const container = $("tradesContainer");

    if (!container) return;

    if (!state.trades.length) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🤝</div>
          <h3>No trades</h3>
          <p>Incoming verified trades will appear here.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = state.trades
      .map((trade) => {
        const status = trade.status || "pending";

        return `
          <div class="card">
            <div class="card-header">
              <div>
                <div class="card-title">🤝 Trade</div>
                <span class="status ${statusClass(status)}">
                  ${escapeHtml(status)}
                </span>
              </div>
            </div>

            <div class="card-body">
              <div class="detail-grid">
                <div>
                  <small>Bot</small>
                  <strong>${escapeHtml(trade.botId || "—")}</strong>
                </div>

                <div>
                  <small>Trader</small>
                  <strong>${escapeHtml(trade.trader || "—")}</strong>
                </div>

                <div>
                  <small>Expected</small>
                  <strong>${escapeHtml(
                    trade.expectedItem ||
                      trade.expectedItems ||
                      "—"
                  )}</strong>
                </div>
              </div>
            </div>

            <div class="card-actions">
              <button class="btn btn-primary"
                data-action="trade-approve"
                data-id="${escapeHtml(trade.id)}">
                Approve
              </button>

              <button class="btn btn-danger"
                data-action="trade-deny"
                data-id="${escapeHtml(trade.id)}">
                Deny
              </button>
            </div>
          </div>
        `;
      })
      .join("");
  }

  function renderCoop() {
    const container = $("coopContainer");

    if (!container) return;

    if (!state.coop.length) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">👥</div>
          <h3>No co-op requests</h3>
          <p>Incoming co-op requests will appear here.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = state.coop
      .map((request) => {
        const status = request.status || "pending";

        return `
          <div class="card">
            <div class="card-header">
              <div>
                <div class="card-title">👥 Co-op Request</div>
                <span class="status ${statusClass(status)}">
                  ${escapeHtml(status)}
                </span>
              </div>
            </div>

            <div class="card-body">
              <div class="detail-grid">
                <div>
                  <small>Bot</small>
                  <strong>${escapeHtml(request.botId || "—")}</strong>
                </div>

                <div>
                  <small>Requester</small>
                  <strong>${escapeHtml(
                    request.username ||
                      request.requester ||
                      "Unknown"
                  )}</strong>
                </div>

                <div>
                  <small>Expected</small>
                  <strong>${request.expected ? "Yes" : "No"}</strong>
                </div>
              </div>
            </div>

            <div class="card-actions">
              <button class="btn btn-primary"
                data-action="coop-accept"
                data-id="${escapeHtml(request.id)}">
                Accept
              </button>

              <button class="btn btn-danger"
                data-action="coop-reject"
                data-id="${escapeHtml(request.id)}">
                Reject
              </button>
            </div>
          </div>
        `;
      })
      .join("");
  }

  function renderConsole() {
    const output = $("consoleOutput");

    if (!output) return;

    if (!state.activity.length) {
      output.innerHTML = `
        <div class="console-line muted">
          Waiting for bot activity...
        </div>
      `;
      return;
    }

    output.innerHTML = state.activity
      .slice()
      .reverse()
      .map(
        (item) => `
          <div class="console-line">
            <span class="console-time">
              ${escapeHtml(new Date(item.time).toLocaleTimeString())}
            </span>

            <span class="console-type">
              [${escapeHtml(item.type || "info")}]
            </span>

            <span>${escapeHtml(item.message)}</span>
          </div>
        `
      )
      .join("");

    output.scrollTop = output.scrollHeight;
  }

  function renderErrors() {
    const container = $("errorsContainer");

    if (!container) return;

    if (!state.errors.length) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">✓</div>
          <h3>No errors</h3>
          <p>The system has no recorded errors.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = state.errors
      .map(
        (error) => `
          <div class="error-row">
            <div>
              <strong>⚠ ${escapeHtml(error.message)}</strong>
              <small>${formatDate(error.time || error.createdAt)}</small>
            </div>
          </div>
        `
      )
      .join("");
  }

  function renderEverything() {
    updateStats();

    renderDashboardBots();
    renderDashboardBuilds();
    renderDashboardActivity();

    renderBots();
    renderSchematics();
    renderBuilds();
    renderTrades();
    renderCoop();
    renderConsole();
    renderErrors();

    populateSelectors();
  }

  function populateSelectors() {
    const botSelect = $("buildBot");
    const schematicSelect = $("buildSchematic");

    if (botSelect) {
      const current = botSelect.value;

      botSelect.innerHTML = `
        <option value="">Select bot</option>
        ${state.bots
          .map(
            (bot) => `
              <option value="${escapeHtml(botId(bot))}">
                ${escapeHtml(bot.username || bot.name || botId(bot))}
              </option>
            `
          )
          .join("")}
      `;

      if (current) botSelect.value = current;
    }

    if (schematicSelect) {
      const current = schematicSelect.value;

      schematicSelect.innerHTML = `
        <option value="">Select schematic</option>
        ${state.schematics
          .map(
            (schematic) => `
              <option value="${escapeHtml(schematic.id)}">
                ${escapeHtml(
                  schematic.nickname ||
                    schematic.name ||
                    schematic.filename ||
                    schematic.id
                )}
              </option>
            `
          )
          .join("")}
      `;

      if (current) schematicSelect.value = current;
    }
  }

  function showPage(page) {
    state.currentPage = page;

    document.querySelectorAll("[data-page]").forEach((element) => {
      element.classList.toggle(
        "active",
        element.dataset.page === page
      );
    });

    document.querySelectorAll(".page").forEach((element) => {
      element.classList.toggle(
        "active",
        element.id === `page-${page}`
      );
    });

    const titles = {
      dashboard: ["Dashboard", "FakePixel SkyBlock control center"],
      bots: ["Bots", "Manage your Minecraft bots"],
      schematics: ["Schematics", "Upload and inspect structures"],
      builds: ["Builds", "Monitor and control active builds"],
      trades: ["Trades", "Review verified item transfers"],
      coop: ["Co-op", "Manage incoming co-op requests"],
      console: ["Console", "Live bot console and commands"],
      errors: ["Errors", "System and bot error history"]
    };

    const title = titles[page] || titles.dashboard;

    if ($("pageTitle")) $("pageTitle").textContent = title[0];
    if ($("pageSubtitle")) $("pageSubtitle").textContent = title[1];

    document.body.classList.remove("mobile-sidebar-open");
  }

  async function addBot() {
    const form = $("botForm");

    if (!form) return;

    const formData = new FormData(form);

    const username =
      formData.get("username") ||
      formData.get("name");

    const password = formData.get("password");

    const targetUsername =
      formData.get("targetUsername") ||
      formData.get("target");

    if (!username || !password) {
      toast("Username and password are required.", "error");
      return;
    }

    const payload = {
      username: String(username).trim(),
      password: String(password),
      targetUsername: String(targetUsername || "").trim()
    };

    try {
      const result = await tryRequest(
        ["/api/bots", "/api/bot"],
        {
          method: "POST",
          body: JSON.stringify(payload)
        }
      );

      if (result?.bot) {
        state.bots = [
          ...state.bots.filter(
            (bot) => botId(bot) !== botId(result.bot)
          ),
          result.bot
        ];
      }

      form.reset();

      closeModal("botModal");

      addActivity(`Bot ${payload.username} added`, "success");
      toast("Bot added successfully.", "success");

      await loadState();
      await loadResources();
    } catch (error) {
      addError(error);
      toast(error.message, "error");
    }
  }

  async function uploadSchematic() {
    const input = $("schematicFile");

    if (!input?.files?.length) {
      toast("Select a schematic file first.", "error");
      return;
    }

    const file = input.files[0];

    const form = new FormData();
    form.append("file", file);

    const nickname =
      $("schematicNickname")?.value?.trim() ||
      file.name.replace(/\.(schem|schematic)$/i, "");

    form.append("nickname", nickname);

    try {
      const result = await tryRequest(
        ["/api/schematics/upload", "/api/schematics"],
        {
          method: "POST",
          body: form
        }
      );

      const schematic = result?.schematic || result;

      if (schematic && typeof schematic === "object") {
        state.schematics.push(schematic);
      }

      input.value = "";

      if ($("schematicNickname")) {
        $("schematicNickname").value = "";
      }

      addActivity(`Uploaded ${file.name}`, "success");
      toast("Schematic uploaded.", "success");

      await loadState();
      await loadResources();
    } catch (error) {
      addError(error);
      toast(error.message, "error");
    }
  }

  async function createBuild() {
    const form = $("buildForm");

    if (!form) return;

    const formData = new FormData(form);

    const payload = {
      botId: String(formData.get("botId") || ""),
      schematicId: String(formData.get("schematicId") || ""),
      name: String(formData.get("name") || "").trim(),
      x: Number(formData.get("x")),
      y: Number(formData.get("y")),
      z: Number(formData.get("z"))
    };

    if (!payload.botId || !payload.schematicId) {
      toast("Select a bot and schematic.", "error");
      return;
    }

    if (
      !Number.isFinite(payload.x) ||
      !Number.isFinite(payload.y) ||
      !Number.isFinite(payload.z)
    ) {
      toast("Enter valid X, Y and Z coordinates.", "error");
      return;
    }

    try {
      const result = await request("/api/builds", {
        method: "POST",
        body: JSON.stringify(payload)
      });

      if (result?.build) {
        state.builds.push(result.build);
      }

      closeModal("buildModal");

      addActivity(
        `Build ${payload.name || payload.schematicId} created`,
        "success"
      );

      toast("Build created.", "success");

      await loadState();
      await loadResources();
    } catch (error) {
      addError(error);
      toast(error.message, "error");
    }
  }

  async function sendCommand() {
    const bot = $("commandBot")?.value;
    const input = $("commandInput");

    const command = input?.value?.trim();

    if (!bot || !command) {
      toast("Select a bot and enter a command.", "error");
      return;
    }

    try {
      await tryRequest(
        [
          `/api/bots/${encodeURIComponent(bot)}/command`,
          `/api/bots/${encodeURIComponent(bot)}/cmd`
        ],
        {
          method: "POST",
          body: JSON.stringify({ command })
        }
      );

      input.value = "";

      addActivity(`[${bot}] > ${command}`, "command");
      toast("Command sent.", "success");
    } catch (error) {
      addError(error);
      toast(error.message, "error");
    }
  }

  async function botAction(id, action) {
    try {
      const endpoints = {
        restart: `/api/bots/${encodeURIComponent(id)}/restart`,
        reconnect: `/api/bots/${encodeURIComponent(id)}/reconnect`,
        connect: `/api/bots/${encodeURIComponent(id)}/connect`,
        disconnect: `/api/bots/${encodeURIComponent(id)}/disconnect`
      };

      await request(endpoints[action], {
        method: "POST"
      });

      addActivity(`Bot ${id}: ${action}`, "success");
      toast(`Bot ${action} requested.`, "success");

      await loadState();
    } catch (error) {
      addError(error);
      toast(error.message, "error");
    }
  }

  async function deleteBot(id) {
    if (!confirm(`Delete bot "${id}"?`)) return;

    try {
      await request(`/api/bots/${encodeURIComponent(id)}`, {
        method: "DELETE"
      });

      state.bots = state.bots.filter(
        (bot) => botId(bot) !== id
      );

      addActivity(`Bot ${id} deleted`, "warning");
      toast("Bot deleted.", "success");

      renderEverything();
    } catch (error) {
      addError(error);
      toast(error.message, "error");
    }
  }

  async function deleteSchematic(id) {
    if (!confirm("Delete this schematic?")) return;

    try {
      await request(`/api/schematics/${encodeURIComponent(id)}`, {
        method: "DELETE"
      });

      state.schematics = state.schematics.filter(
        (schematic) => schematic.id !== id
      );

      addActivity(`Schematic ${id} deleted`, "warning");
      toast("Schematic deleted.", "success");

      renderEverything();
    } catch (error) {
      addError(error);
      toast(error.message, "error");
    }
  }

  async function inspectSchematic(id) {
    try {
      const data = await tryRequest([
        `/api/schematics/${encodeURIComponent(id)}`,
        `/api/schematics/${encodeURIComponent(id)}/inspect`
      ]);

      const schematic = data?.schematic || data;

      if ($("inspectTitle")) {
        $("inspectTitle").textContent =
          schematic.nickname ||
          schematic.name ||
          schematic.filename ||
          "Schematic";
      }

      if ($("inspectContent")) {
        const materials = collection(schematic.materials);

        $("inspectContent").innerHTML = `
          <div class="detail-grid">
            <div>
              <small>Dimensions</small>
              <strong>
                ${escapeHtml(
                  schematic.width !== undefined
                    ? `${schematic.width} × ${schematic.height} × ${schematic.length}`
                    : "Unknown"
                )}
              </strong>
            </div>

            <div>
              <small>Total Blocks</small>
              <strong>
                ${escapeHtml(
                  schematic.blockCount ||
                    schematic.totalBlocks ||
                    "Unknown"
                )}
              </strong>
            </div>
          </div>

          <h4>Materials</h4>

          <div class="material-list">
            ${
              materials.length
                ? materials
                    .map(
                      (material) => `
                        <div class="material-row">
                          <span>
                            ${escapeHtml(
                              material.name ||
                                material.block ||
                                material.id ||
                                "Unknown"
                            )}
                          </span>

                          <strong>
                            ${escapeHtml(
                              material.count ||
                                material.quantity ||
                                material.amount ||
                                0
                            )}
                          </strong>
                        </div>
                      `
                    )
                    .join("")
                : "<p>No material information available.</p>"
            }
          </div>
        `;

        openModal("inspectModal");
      }
    } catch (error) {
      addError(error);
      toast(error.message, "error");
    }
  }

  async function buildAction(id, action) {
    try {
      await request(
        `/api/builds/${encodeURIComponent(id)}/${action}`,
        {
          method: "POST"
        }
      );

      addActivity(`Build ${id}: ${action}`, "success");
      toast(`Build ${action}.`, "success");

      await loadState();
    } catch (error) {
      addError(error);
      toast(error.message, "error");
    }
  }

  async function tradeAction(id, action) {
    try {
      await request(
        `/api/trades/${encodeURIComponent(id)}/${action}`,
        {
          method: "POST"
        }
      );

      addActivity(`Trade ${id}: ${action}`, "success");
      toast(`Trade ${action}.`, "success");

      await loadState();
    } catch (error) {
      addError(error);
      toast(error.message, "error");
    }
  }

  async function coopAction(id, action) {
    try {
      await request(
        `/api/coop/${encodeURIComponent(id)}/${action}`,
        {
          method: "POST"
        }
      );

      addActivity(`Co-op request ${id}: ${action}`, "success");
      toast(`Co-op ${action}.`, "success");

      await loadState();
    } catch (error) {
      addError(error);
      toast(error.message, "error");
    }
  }

  function openModal(id) {
    const modal = $(id);

    if (!modal) return;

    modal.classList.add("open");
    modal.removeAttribute("hidden");
  }

  function closeModal(id) {
    const modal = $(id);

    if (!modal) return;

    modal.classList.remove("open");
    modal.setAttribute("hidden", "");
  }

  function bindEvents() {
    document.addEventListener("click", async (event) => {
      const pageButton = event.target.closest("[data-page]");

      if (pageButton) {
        event.preventDefault();
        showPage(pageButton.dataset.page);
        return;
      }

      const actionElement = event.target.closest("[data-action]");

      if (!actionElement) return;

      const action = actionElement.dataset.action;
      const id = actionElement.dataset.id;

      try {
        switch (action) {
          case "bot-command":
            if ($("commandBot")) {
              $("commandBot").value = id;
            }

            showPage("console");

            $("commandInput")?.focus();
            break;

          case "bot-restart":
            await botAction(id, "restart");
            break;

          case "bot-reconnect":
            await botAction(id, "reconnect");
            break;

          case "bot-delete":
            await deleteBot(id);
            break;

          case "delete-schematic":
            await deleteSchematic(id);
            break;

          case "inspect-schematic":
            await inspectSchematic(id);
            break;

          case "build-pause":
            await buildAction(id, "pause");
            break;

          case "build-resume":
            await buildAction(id, "resume");
            break;

          case "build-cancel":
            await buildAction(id, "cancel");
            break;

          case "trade-approve":
            await tradeAction(id, "approve");
            break;

          case "trade-deny":
            await tradeAction(id, "deny");
            break;

          case "coop-accept":
            await coopAction(id, "accept");
            break;

          case "coop-reject":
            await coopAction(id, "reject");
            break;
        }
      } catch (error) {
        addError(error);
      }
    });

    document.querySelectorAll("[data-modal-close]").forEach((button) => {
      button.addEventListener("click", () => {
        closeModal(button.dataset.modalClose);
      });
    });

    document.querySelectorAll(".modal").forEach((modal) => {
      modal.addEventListener("click", (event) => {
        if (event.target === modal) {
          closeModal(modal.id);
        }
      });
    });

    $("addBotButton")?.addEventListener("click", () => {
      openModal("botModal");
    });

    $("newBuildButton")?.addEventListener("click", () => {
      populateSelectors();
      openModal("buildModal");
    });

    $("uploadSchematicButton")?.addEventListener("click", () => {
      $("schematicFile")?.click();
    });

    $("schematicFile")?.addEventListener("change", () => {
      if ($("schematicFile").files.length) {
        uploadSchematic();
      }
    });

    $("botForm")?.addEventListener("submit", (event) => {
      event.preventDefault();
      addBot();
    });

    $("buildForm")?.addEventListener("submit", (event) => {
      event.preventDefault();
      createBuild();
    });

    $("sendCommandButton")?.addEventListener("click", sendCommand);

    $("commandInput")?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        sendCommand();
      }
    });

    $("refreshButton")?.addEventListener("click", async () => {
      await loadState();
      await loadResources();
      toast("Panel refreshed.", "success");
    });

    $("clearConsoleButton")?.addEventListener("click", () => {
      state.activity = [];
      renderConsole();
      renderDashboardActivity();
    });

    $("clearErrorsButton")?.addEventListener("click", () => {
      state.errors = [];
      renderErrors();
      updateStats();
    });

    $("mobileMenuButton")?.addEventListener("click", () => {
      document.body.classList.toggle("mobile-sidebar-open");
    });
  }

  function bindSocket() {
    if (!socket) {
      setConnection(false, "Socket unavailable");
      return;
    }

    socket.on("connect", () => {
      setConnection(true, "Connected");
      addActivity("WebSocket connected", "success");
    });

    socket.on("disconnect", () => {
      setConnection(false, "Disconnected");
      addActivity("WebSocket disconnected", "warning");
    });

    socket.on("connect_error", (error) => {
      setConnection(false, "Connection error");
      addError(error);
    });

    socket.on("state", (data) => {
      normalizeState(data);
      renderEverything();
    });

    socket.on("log", (data) => {
      const message =
        typeof data === "string"
          ? data
          : data?.message || JSON.stringify(data);

      addActivity(message, data?.type || "info");
      renderConsole();
    });

    socket.on("chat", (data) => {
      const message =
        typeof data === "string"
          ? data
          : data?.message || JSON.stringify(data);

      addActivity(message, "chat");
      renderConsole();
    });

    socket.on("build", (data) => {
      if (data?.build) {
        const index = state.builds.findIndex(
          (build) => build.id === data.build.id
        );

        if (index >= 0) {
          state.builds[index] = data.build;
        } else {
          state.builds.push(data.build);
        }
      } else if (data?.id) {
        const index = state.builds.findIndex(
          (build) => build.id === data.id
        );

        if (index >= 0) {
          state.builds[index] = {
            ...state.builds[index],
            ...data
          };
        }
      }

      addActivity(
        data?.message || "Build update received",
        "build"
      );

      renderBuilds();
      renderDashboardBuilds();
      updateStats();
    });

    socket.on("error", (data) => {
      addError(data);

      addActivity(
        data?.message || "Bot error received",
        "error"
      );

      renderConsole();
    });

    socket.on("trade", (data) => {
      if (data?.trade) {
        const index = state.trades.findIndex(
          (trade) => trade.id === data.trade.id
        );

        if (index >= 0) {
          state.trades[index] = data.trade;
        } else {
          state.trades.unshift(data.trade);
        }
      }

      addActivity(
        data?.message || "Trade update received",
        "trade"
      );

      renderTrades();
    });

    socket.on("coop", (data) => {
      if (data?.request) {
        const index = state.coop.findIndex(
          (item) => item.id === data.request.id
        );

        if (index >= 0) {
          state.coop[index] = data.request;
        } else {
          state.coop.unshift(data.request);
        }
      }

      addActivity(
        data?.message || "Co-op request received",
        "coop"
      );

      renderCoop();
    });

    socket.on("bot", (data) => {
      if (!data) return;

      const bot = data.bot || data;
      const id = botId(bot);

      if (!id) return;

      const index = state.bots.findIndex(
        (item) => botId(item) === id
      );

      if (index >= 0) {
        state.bots[index] = {
          ...state.bots[index],
          ...bot
        };
      } else {
        state.bots.push(bot);
      }

      renderBots();
      renderDashboardBots();
      updateStats();
    });
  }

  async function init() {
    bindEvents();
    bindSocket();

    showPage("dashboard");

    await loadState();
    await loadResources();

    setInterval(async () => {
      if (!state.connected) {
        await loadState();
      }
    }, 10000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
