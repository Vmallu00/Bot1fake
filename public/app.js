(() => {
  "use strict";

  const state = {
    bots: [],
    schematics: [],
    builds: [],
    trades: [],
    coop: [],
    errors: [],
    activity: [],
    connected: false
  };

  const $ = (id) => document.getElementById(id);

  /* -----------------------------
     HELPERS
  ----------------------------- */

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function list(value) {
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

  function toast(message, type = "info") {
    const container = $("toastContainer");

    if (!container) {
      alert(message);
      return;
    }

    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.textContent = message;

    container.appendChild(toast);

    setTimeout(() => {
      toast.remove();
    }, 3500);
  }

  async function api(url, options = {}) {
    const config = {
      method: "GET",
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
      let message = `Request failed: ${response.status}`;

      try {
        const data = await response.json();
        message = data.error || data.message || message;
      } catch (_) {}

      throw new Error(message);
    }

    const type =
      response.headers.get("content-type") || "";

    if (type.includes("application/json")) {
      return response.json();
    }

    return response.text();
  }

  /* -----------------------------
     MODAL FIX
  ----------------------------- */

  function openModal(id) {
    const modal = $(id);

    if (!modal) {
      console.error(`Modal not found: ${id}`);
      toast(`Modal "${id}" is missing from index.html`, "error");
      return;
    }

    modal.hidden = false;
    modal.removeAttribute("hidden");

    modal.style.display = "flex";
    modal.classList.add("open");
    modal.classList.add("active");

    document.body.classList.add("modal-open");
  }

  function closeModal(id) {
    const modal = $(id);

    if (!modal) return;

    modal.classList.remove("open");
    modal.classList.remove("active");

    modal.style.display = "none";
    modal.hidden = true;

    document.body.classList.remove("modal-open");
  }

  /* -----------------------------
     LOAD STATE
  ----------------------------- */

  async function loadState() {
    try {
      const data = await api("/api/state");

      const source = data?.state || data;

      state.bots = list(source?.bots);
      state.schematics = list(source?.schematics);
      state.builds = list(source?.builds);
      state.trades = list(source?.trades);
      state.coop = list(
        source?.coop || source?.coopRequests
      );
      state.errors = list(source?.errors);

      renderAll();

      state.connected = true;

      const text = $("connectionText");
      if (text) text.textContent = "Connected";

      const dot = $("connectionDot");
      if (dot) {
        dot.classList.add("online");
        dot.classList.remove("offline");
      }
    } catch (error) {
      console.error(error);

      state.connected = false;

      const text = $("connectionText");
      if (text) text.textContent = "API Error";

      toast(error.message, "error");
    }
  }

  /* -----------------------------
     BOT RENDER
  ----------------------------- */

  function renderBots() {
    const container = $("botsContainer");

    if (!container) return;

    if (!state.bots.length) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🤖</div>
          <h3>No bots yet</h3>
          <p>Click "Add Bot" to configure a FakePixel bot.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = state.bots.map(bot => {
      const id = botId(bot);

      const status =
        bot.status ||
        bot.state ||
        (bot.online ? "online" : "offline");

      return `
        <div class="card bot-card">

          <div class="card-header">

            <div>
              <div class="card-title">
                ⚡ ${escapeHtml(
                  bot.username ||
                  bot.name ||
                  id
                )}
              </div>

              <span class="status">
                ${escapeHtml(status)}
              </span>
            </div>

          </div>

          <div class="card-body">

            <div class="detail-grid">

              <div>
                <small>Target Island</small>
                <strong>
                  ${escapeHtml(
                    bot.targetUsername ||
                    "Not configured"
                  )}
                </strong>
              </div>

              <div>
                <small>Registered</small>
                <strong>
                  ${bot.registered ? "Yes" : "Pending"}
                </strong>
              </div>

            </div>

          </div>

          <div class="card-actions">

            <button
              class="btn btn-secondary"
              data-action="bot-command"
              data-id="${escapeHtml(id)}">
              Command
            </button>

            <button
              class="btn btn-secondary"
              data-action="bot-reconnect"
              data-id="${escapeHtml(id)}">
              Reconnect
            </button>

            <button
              class="btn btn-danger"
              data-action="bot-delete"
              data-id="${escapeHtml(id)}">
              Delete
            </button>

          </div>

        </div>
      `;
    }).join("");
  }

  /* -----------------------------
     SELECTORS
  ----------------------------- */

  function populateBotSelector() {
    const select = $("buildBot");

    if (!select) return;

    select.innerHTML = `
      <option value="">Select bot</option>
      ${state.bots.map(bot => `
        <option value="${escapeHtml(botId(bot))}">
          ${escapeHtml(
            bot.username ||
            bot.name ||
            botId(bot)
          )}
        </option>
      `).join("")}
    `;
  }

  function populateSchematicSelector() {
    const select = $("buildSchematic");

    if (!select) return;

    select.innerHTML = `
      <option value="">Select schematic</option>
      ${state.schematics.map(item => `
        <option value="${escapeHtml(item.id)}">
          ${escapeHtml(
            item.nickname ||
            item.name ||
            item.filename ||
            item.id
          )}
        </option>
      `).join("")}
    `;
  }

  /* -----------------------------
     ADD BOT
  ----------------------------- */

  async function addBot() {
    const form = $("botForm");

    if (!form) {
      toast("Bot form not found.", "error");
      return;
    }

    const formData = new FormData(form);

    const username = String(
      formData.get("username") || ""
    ).trim();

    const password = String(
      formData.get("password") || ""
    );

    const targetUsername = String(
      formData.get("targetUsername") ||
      formData.get("target") ||
      ""
    ).trim();

    if (!username) {
      toast("Enter the Minecraft username.", "error");
      return;
    }

    if (!password) {
      toast("Enter the Minecraft password.", "error");
      return;
    }

    const payload = {
      username,
      password,
      targetUsername
    };

    try {
      const result = await api("/api/bots", {
        method: "POST",
        body: JSON.stringify(payload)
      });

      const bot = result?.bot || result;

      if (bot && typeof bot === "object") {
        state.bots = [
          ...state.bots.filter(
            x => botId(x) !== botId(bot)
          ),
          bot
        ];
      }

      /*
       * Password is intentionally NOT displayed,
       * logged, or stored in the browser state.
       */

      form.reset();

      closeModal("botModal");

      toast(
        `${username} added successfully.`,
        "success"
      );

      renderBots();
      populateBotSelector();

      await loadState();

    } catch (error) {
      console.error(error);
      toast(error.message, "error");
    }
  }

  /* -----------------------------
     DELETE BOT
  ----------------------------- */

  async function deleteBot(id) {
    if (!confirm(`Delete bot "${id}"?`)) {
      return;
    }

    try {
      await api(
        `/api/bots/${encodeURIComponent(id)}`,
        {
          method: "DELETE"
        }
      );

      state.bots = state.bots.filter(
        bot => botId(bot) !== id
      );

      renderBots();
      populateBotSelector();

      toast("Bot deleted.", "success");

    } catch (error) {
      toast(error.message, "error");
    }
  }

  /* -----------------------------
     BOT ACTIONS
  ----------------------------- */

  async function botAction(id, action) {
    try {
      await api(
        `/api/bots/${encodeURIComponent(id)}/${action}`,
        {
          method: "POST"
        }
      );

      toast(
        `Bot ${action} requested.`,
        "success"
      );

      await loadState();

    } catch (error) {
      toast(error.message, "error");
    }
  }

  /* -----------------------------
     NAVIGATION
  ----------------------------- */

  function showPage(page) {
    document
      .querySelectorAll("[data-page]")
      .forEach(button => {
        button.classList.toggle(
          "active",
          button.dataset.page === page
        );
      });

    document
      .querySelectorAll(".page")
      .forEach(element => {
        element.classList.toggle(
          "active",
          element.id === `page-${page}`
        );
      });

    const titles = {
      dashboard: [
        "Dashboard",
        "FakePixel SkyBlock control center"
      ],
      bots: [
        "Bots",
        "Manage your Minecraft bots"
      ],
      schematics: [
        "Schematics",
        "Upload and inspect structures"
      ],
      builds: [
        "Builds",
        "Monitor and control builds"
      ],
      trades: [
        "Trades",
        "Review item transfers"
      ],
      coop: [
        "Co-op",
        "Manage co-op requests"
      ],
      console: [
        "Console",
        "Live bot console"
      ],
      errors: [
        "Errors",
        "System and bot errors"
      ]
    };

    const title =
      titles[page] ||
      titles.dashboard;

    if ($("pageTitle")) {
      $("pageTitle").textContent = title[0];
    }

    if ($("pageSubtitle")) {
      $("pageSubtitle").textContent = title[1];
    }
  }

  /* -----------------------------
     EVENTS
  ----------------------------- */

  function bindEvents() {

    /*
     * ADD BOT
     *
     * Supports:
     * id="addBotButton"
     */
    document.addEventListener(
      "click",
      async event => {

        const addButton =
          event.target.closest(
            "#addBotButton"
          );

        if (addButton) {
          event.preventDefault();
          event.stopPropagation();

          console.log(
            "[Panel] Add Bot clicked"
          );

          openModal("botModal");
          return;
        }

        const closeButton =
          event.target.closest(
            "[data-modal-close]"
          );

        if (closeButton) {
          event.preventDefault();

          closeModal(
            closeButton.dataset.modalClose
          );

          return;
        }

        const pageButton =
          event.target.closest(
            "[data-page]"
          );

        if (pageButton) {
          event.preventDefault();

          showPage(
            pageButton.dataset.page
          );

          return;
        }

        const action =
          event.target.closest(
            "[data-action]"
          );

        if (!action) return;

        const type =
          action.dataset.action;

        const id =
          action.dataset.id;

        if (type === "bot-delete") {
          await deleteBot(id);
        }

        if (type === "bot-reconnect") {
          await botAction(
            id,
            "reconnect"
          );
        }

        if (type === "bot-command") {
          if ($("commandBot")) {
            $("commandBot").value = id;
          }

          showPage("console");

          $("commandInput")?.focus();
        }
      }
    );

    /*
     * Close modal when clicking outside it.
     */
    document.addEventListener(
      "click",
      event => {

        if (
          event.target.classList.contains(
            "modal"
          )
        ) {
          closeModal(
            event.target.id
          );
        }
      }
    );

    /*
     * Bot form.
     */
    const botForm = $("botForm");

    if (botForm) {
      botForm.addEventListener(
        "submit",
        event => {
          event.preventDefault();
          addBot();
        }
      );
    }

    /*
     * New build.
     */
    $("newBuildButton")?.addEventListener(
      "click",
      () => {
        populateBotSelector();
        populateSchematicSelector();
        openModal("buildModal");
      }
    );

    /*
     * Refresh.
     */
    $("refreshButton")?.addEventListener(
      "click",
      () => loadState()
    );

    /*
     * Mobile menu.
     */
    $("mobileMenuButton")?.addEventListener(
      "click",
      () => {
        document.body.classList.toggle(
          "mobile-sidebar-open"
        );
      }
    );
  }

  /* -----------------------------
     RENDER
  ----------------------------- */

  function renderAll() {
    renderBots();
    populateBotSelector();
    populateSchematicSelector();

    if ($("statOnlineBots")) {
      $("statOnlineBots").textContent =
        state.bots.filter(
          bot =>
            bot.online === true ||
            String(
              bot.status || ""
            ).toLowerCase() === "online"
        ).length;
    }

    if ($("statSchematics")) {
      $("statSchematics").textContent =
        state.schematics.length;
    }

    if ($("statActiveBuilds")) {
      $("statActiveBuilds").textContent =
        state.builds.filter(
          build =>
            !["completed", "cancelled", "failed"]
              .includes(
                String(
                  build.status || ""
                ).toLowerCase()
              )
        ).length;
    }

    if ($("statErrors")) {
      $("statErrors").textContent =
        state.errors.length;
    }
  }

  /* -----------------------------
     SOCKET.IO
  ----------------------------- */

  function setupSocket() {
    if (typeof io !== "function") {
      console.warn(
        "Socket.IO client not available."
      );
      return;
    }

    const socket = io();

    socket.on("connect", () => {
      state.connected = true;

      if ($("connectionText")) {
        $("connectionText").textContent =
          "Connected";
      }
    });

    socket.on("disconnect", () => {
      state.connected = false;

      if ($("connectionText")) {
        $("connectionText").textContent =
          "Disconnected";
      }
    });

    socket.on("state", data => {
      const source =
        data?.state || data;

      if (source?.bots) {
        state.bots =
          list(source.bots);
      }

      if (source?.schematics) {
        state.schematics =
          list(source.schematics);
      }

      if (source?.builds) {
        state.builds =
          list(source.builds);
      }

      renderAll();
    });

    socket.on("bot", data => {
      const bot =
        data?.bot || data;

      if (!bot) return;

      const id = botId(bot);

      const index =
        state.bots.findIndex(
          x => botId(x) === id
        );

      if (index >= 0) {
        state.bots[index] = {
          ...state.bots[index],
          ...bot
        };
      } else {
        state.bots.push(bot);
      }

      renderAll();
    });

    socket.on("error", data => {
      console.error(
        "[Bot Error]",
        data
      );
    });
  }

  /* -----------------------------
     START
  ----------------------------- */

  async function init() {
    console.log(
      "FakePixel SkyBlock Builder loaded."
    );

    bindEvents();

    setupSocket();

    showPage("dashboard");

    await loadState();
  }

  if (
    document.readyState === "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      init
    );
  } else {
    init();
  }

})();
