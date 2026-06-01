// ===== 情侣点单系统 - 美团风格 =====
const MENU_ITEMS = [
  { emoji: "🍜", name: "火鸡面" },
  { emoji: "🍕", name: "披萨" },
  { emoji: "🍔", name: "汉堡" },
  { emoji: "🍣", name: "寿司" },
  { emoji: "🍗", name: "炸鸡" },
  { emoji: "🧋", name: "奶茶" },
  { emoji: "🍰", name: "蛋糕" },
  { emoji: "🍦", name: "冰淇淋" },
  { emoji: "🥟", name: "饺子" },
  { emoji: "🌮", name: "塔可" },
  { emoji: "🍟", name: "薯条" },
  { emoji: "🥤", name: "可乐" },
];

// ===== 状态管理 =====
let state = {
  screen: "welcome",
  role: null,
  pairId: null,
  password: null,
  partnerConnected: false,
  orders: [],
  ws: null,
  reconnectTimer: null,
  soundEnabled: true,
  girlTab: "order",
  notificationPermission: "default",
  bannerOrderId: null,
};

// ========== 浏览器通知 ==========
function requestNotificationPermission() {
  if (!("Notification" in window)) return;
  if (Notification.permission === "granted") {
    state.notificationPermission = "granted";
    return;
  }
  if (Notification.permission === "denied") {
    state.notificationPermission = "denied";
    return;
  }
  setTimeout(() => {
    Notification.requestPermission().then(perm => {
      state.notificationPermission = perm;
    });
  }, 2000);
}

function showBrowserNotification(title, body) {
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  try {
    const n = new Notification(title, {
      body,
      icon: "data:image/svg+xml,%3Csvg xmlns=''http://www.w3.org/2000/svg'' viewBox=''0 0 100 100''%3E%3Ctext y=''.9em'' font-size=''80''%3E💕%3C/text%3E%3C/svg%3E",
      tag: "couple-order",
      requireInteraction: true,
      vibrate: [200, 100, 200, 100, 200],
    });
    n.onclick = () => { window.focus(); n.close(); };
    setTimeout(() => n.close(), 6000);
  } catch (e) { /* ignore */ }
}

function updatePageTitle() {
  const pendingCount = state.orders.filter(o => o.status === "pending").length;
  if (pendingCount > 0 && state.role === "boyfriend") {
    document.title = `🔔(${pendingCount}) 情侣点单`;
  } else if (pendingCount > 0 && state.role === "girlfriend") {
    document.title = `(${pendingCount}) 情侣点单`;
  } else {
    document.title = "❤️ 情侣点单";
  }
}

// ========== 新订单横幅（男友端） ==========
function showOrderBanner(order) {
  state.bannerOrderId = order.id;
  render();
  setTimeout(() => {
    if (state.bannerOrderId === order.id) {
      state.bannerOrderId = null;
      render();
    }
  }, 8000);
}

function dismissBanner() {
  state.bannerOrderId = null;
  render();
}

// ========== WebSocket ==========
function connect() {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = protocol + "//" + location.host;
  const ws = new WebSocket(wsUrl);
  state.ws = ws;

  ws.onopen = () => {
    console.log("[WS] 已连接");
    if (state.role === "boyfriend" && state.pairId && state.password) {
      send({ type: "create_pair", password: state.password });
    } else if (state.role === "girlfriend" && state.pairId && state.password) {
      send({ type: "join_pair", pairId: state.pairId, password: state.password });
    }
  };

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    handleMessage(msg);
  };

  ws.onclose = () => {
    console.log("[WS] 断开，3秒后重连...");
    scheduleReconnect();
  };

  ws.onerror = () => { ws.close(); };
}

function scheduleReconnect() {
  if (state.reconnectTimer) return;
  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = null;
    connect();
  }, 3000);
}

function send(data) {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify(data));
  }
}

// ========== 消息处理 ==========
function handleMessage(msg) {
  switch (msg.type) {
    case "pair_created":
      state.pairId = msg.pairId;
      state.screen = "boy-main";
      render();
      break;

    case "pair_joined":
      state.screen = "girl-main";
      render();
      toast("配对成功！❤️");
      break;

    case "partner_connected":
      state.partnerConnected = true;
      render();
      toast(msg.message);
      playSound("connect");
      break;

    case "partner_disconnected":
      state.partnerConnected = false;
      render();
      toast(msg.message);
      break;

    case "new_order":
      state.orders.unshift(msg.order);
      updatePageTitle();
      showOrderBanner(msg.order);
      playSound("new_order");
      vibrate();
      showBrowserNotification(
        "🔔 女朋友下单啦！",
        msg.order.item + (msg.order.quantity > 1 ? " x" + msg.order.quantity : "") + (msg.order.note ? " — " + msg.order.note : "")
      );
      render();
      break;

    case "order_placed":
      state.orders.unshift(msg.order);
      updatePageTitle();
      render();
      toast("下单成功！等待男朋友接单 ⏳");
      playSound("order");
      break;

    case "order_updated":
      const idx = state.orders.findIndex(o => o.id === msg.order.id);
      if (idx !== -1) state.orders[idx] = msg.order;
      updatePageTitle();
      if (state.bannerOrderId === msg.order.id && msg.order.status !== "pending") {
        state.bannerOrderId = null;
      }
      render();
      if (state.role === "girlfriend") {
        const labels = { accepted: "男朋友已接单 ✅", done: "已完成 ✅" };
        toast(labels[msg.order.status] || "状态已更新");
        playSound("update");
        // 女朋友端也通知
        if (msg.order.status === "accepted") {
          showBrowserNotification("✅ 男朋友接单了！", "你的 " + msg.order.item + " 已被接单，马上安排~");
        }
      }
      break;

    case "orders_list":
      state.orders = msg.orders;
      updatePageTitle();
      render();
      break;

    case "pair_left":
      resetState();
      render();
      break;

    case "error":
      toast(msg.message);
      break;
  }
}

function resetState() {
  state.screen = "welcome";
  state.role = null;
  state.pairId = null;
  state.password = null;
  state.partnerConnected = false;
  state.orders = [];
  state.bannerOrderId = null;
  document.title = "❤️ 情侣点单";
}

// ===== 动作函数 =====
function act_selectRole(role) {
  state.role = role;
  state.screen = role === "boyfriend" ? "setup-boy" : "setup-girl";
  if (role === "boyfriend") requestNotificationPermission();
  render();
}

function act_createPair() {
  const pw = document.getElementById("password-input").value.trim();
  if (pw.length < 4) { toast("密码至少4位"); return; }
  state.password = pw;
  send({ type: "create_pair", password: pw });
  requestNotificationPermission();
}

function act_joinPair() {
  const code = document.getElementById("join-code-input").value.trim();
  const pw = document.getElementById("join-password-input").value.trim();
  if (!code || code.length !== 6) { toast("请输入6位配对码"); return; }
  if (!pw || pw.length < 4) { toast("密码至少4位"); return; }
  state.pairId = code;
  state.password = pw;
  send({ type: "join_pair", pairId: code, password: pw });
  requestNotificationPermission();
}

function act_placeOrder(item, note = "", quantity = 1) {
  send({ type: "place_order", item, note, quantity });
}

function act_quickOrder(item) {
  act_placeOrder(item);
  toast("已下单：" + item);
}

function act_customOrder() {
  const input = document.getElementById("custom-input");
  const noteInput = document.getElementById("custom-note");
  const qtyInput = document.getElementById("custom-qty");
  const item = input.value.trim();
  if (!item) { toast("请输入想点的东西"); return; }
  const note = noteInput ? noteInput.value.trim() : "";
  const qty = qtyInput ? parseInt(qtyInput.value) || 1 : 1;
  act_placeOrder(item, note, qty);
  input.value = "";
  if (noteInput) noteInput.value = "";
  if (qtyInput) qtyInput.value = "1";
}

function act_updateOrder(orderId, status) {
  send({ type: "update_order", orderId, status });
}

function act_leavePair() {
  if (confirm("确定要退出配对吗？")) {
    send({ type: "leave_pair" });
    resetState();
    render();
  }
}

function act_goBack() {
  if (state.screen === "boy-main" || state.screen === "girl-main") {
    act_leavePair();
  } else {
    resetState();
    render();
  }
}

function act_toggleSound() {
  state.soundEnabled = !state.soundEnabled;
  render();
}

function act_dismissBanner() {
  dismissBanner();
}

// ===== 音效（增强版） =====
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playSound(type) {
  if (!state.soundEnabled) return;
  try {
    if (type === "new_order") {
      // 美团风格：叮~叮咚~
      playTone(880, 0.12, 0, 0.1);
      setTimeout(() => playTone(1100, 0.18, 0, 0.1), 120);
      setTimeout(() => playTone(1320, 0.25, 0, 0.08), 300);
    } else if (type === "order") {
      playTone(660, 0.15, 0, 0.1);
      setTimeout(() => playTone(880, 0.2, 0, 0.1), 150);
    } else if (type === "connect") {
      playTone(523, 0.3, 0, 0.1);
    } else if (type === "update") {
      playTone(660, 0.15, 0, 0.1);
    }
  } catch (e) { /* ignore */ }
}

function playTone(freq, duration, delay, volume) {
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  gain.gain.value = volume || 0.1;
  osc.frequency.value = freq;
  osc.type = "sine";
  osc.start(audioCtx.currentTime + (delay || 0));
  osc.stop(audioCtx.currentTime + (delay || 0) + duration);
}

// ===== 振动 =====
function vibrate() {
  if (navigator.vibrate) {
    navigator.vibrate([200, 80, 200, 80, 300]);
  }
}

// ===== Toast =====
function toast(message) {
  const existing = document.querySelector(".toast");
  if (existing) existing.remove();
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2500);
}

// ===== 渲染 =====
function render() {
  const app = document.getElementById("app");
  switch (state.screen) {
    case "welcome": app.innerHTML = renderWelcome(); break;
    case "setup-boy": app.innerHTML = renderSetupBoy(); break;
    case "setup-girl": app.innerHTML = renderSetupGirl(); break;
    case "boy-main": app.innerHTML = renderBoyMain(); break;
    case "girl-main": app.innerHTML = renderGirlMain(); break;
  }
  bindEvents();
  updatePageTitle();
}

function bindEvents() {
  document.querySelectorAll(".input").forEach(inp => {
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        if (state.screen === "setup-boy") act_createPair();
        if (state.screen === "setup-girl") act_joinPair();
      }
    });
  });
  const customInput = document.getElementById("custom-input");
  if (customInput) {
    customInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") act_customOrder();
    });
  }
  const bannerDismiss = document.getElementById("banner-dismiss");
  if (bannerDismiss) {
    bannerDismiss.addEventListener("click", act_dismissBanner);
  }
  const banner = document.querySelector(".order-banner");
  if (banner) {
    banner.addEventListener("click", function(e) {
      if (e.target.id !== "banner-dismiss") {
        state.bannerOrderId = null;
        render();
        document.querySelector(".order-list")?.scrollIntoView({ behavior: "smooth" });
      }
    });
  }
}

// ===== 欢迎页 =====
function renderWelcome() {
  return `
    <div class="welcome">
      <div class="heart">💕</div>
      <h1>情侣点单系统</h1>
      <p class="subtitle">女朋友想吃什么？<br>一键下单，男友即刻收到通知！</p>
      <div class="role-btns">
        <div class="role-btn boy" onclick="act_selectRole(''boyfriend'')">
          <span class="emoji">👦</span> 我是男朋友
        </div>
        <div class="role-btn girl" onclick="act_selectRole(''girlfriend'')">
          <span class="emoji">👧</span> 我是女朋友
        </div>
      </div>
    </div>`;
}

// ===== 男友端：创建配对 =====
function renderSetupBoy() {
  return `
    <div class="setup">
      <button class="btn btn-outline btn-sm" style="align-self:flex-start" onclick="act_goBack()">← 返回</button>
      <h2>🔐 设置配对密码</h2>
      <div class="card">
        <p style="margin-bottom:12px;color:var(--gray-600);font-size:14px">
          设置一个密码，女朋友用它来和你配对。
        </p>
        <input class="input" id="password-input" type="password" placeholder="设置密码（至少4位）" autocomplete="off">
        <button class="btn btn-primary btn-block" style="margin-top:12px" onclick="act_createPair()">
          创建配对码
        </button>
      </div>
      <div class="info-box">
        💡 创建后你会得到一个6位配对码<br>把配对码和密码告诉女朋友即可
      </div>
    </div>`;
}

// ===== 女友端：加入配对 =====
function renderSetupGirl() {
  return `
    <div class="setup">
      <button class="btn btn-outline btn-sm" style="align-self:flex-start" onclick="act_goBack()">← 返回</button>
      <h2>🔗 加入配对</h2>
      <div class="card">
        <p style="margin-bottom:12px;color:var(--gray-600);font-size:14px">
          输入男朋友给你的配对码和密码。
        </p>
        <input class="input" id="join-code-input" type="text" placeholder="6位配对码" maxlength="6" inputmode="numeric" pattern="[0-9]*" autocomplete="off">
        <input class="input" id="join-password-input" type="password" placeholder="配对密码" style="margin-top:10px" autocomplete="off">
        <button class="btn btn-primary btn-block" style="margin-top:12px" onclick="act_joinPair()">
          连接男朋友 💕
        </button>
      </div>
    </div>`;
}

// ===== 男友主界面 =====
function renderBoyMain() {
  const dotClass = state.partnerConnected ? "connected" : "waiting";
  const dotLabel = state.partnerConnected ? "已连接" : "等待中...";
  const pendingCount = state.orders.filter(o => o.status === "pending").length;
  const bannerOrder = state.bannerOrderId
    ? state.orders.find(o => o.id === state.bannerOrderId)
    : null;

  return `
    <div class="order-list">
      <div class="top-bar">
        <span class="title">👦 男朋友 · 接单中心</span>
        <div style="display:flex;align-items:center;gap:8px">
          <button class="sound-btn" onclick="act_toggleSound()">` + (state.soundEnabled ? "🔔" : "🔕") + `</button>
          <span class="connected-badge">
            <span class="status-dot ` + dotClass + `"></span>` + dotLabel + `
          </span>
        </div>
      </div>

      ` + (bannerOrder ? `
        <div class="order-banner" id="order-banner">
          <div class="banner-icon">🔔</div>
          <div class="banner-content">
            <div class="banner-title">女朋友刚刚下单了！</div>
            <div class="banner-detail">📦 <strong>` + escapeHtml(bannerOrder.item) + `</strong>` + (bannerOrder.quantity > 1 ? ` x` + bannerOrder.quantity : "") + `</div>
            ` + (bannerOrder.note ? `<div class="banner-note">📝 ` + escapeHtml(bannerOrder.note) + `</div>` : "") + `
          </div>
          <button class="banner-dismiss" id="banner-dismiss">✕</button>
        </div>
      ` : "") + `

      <div class="card pair-code-display">
        <div style="font-size:13px;color:var(--gray-600)">你的配对码</div>
        <div class="code">` + state.pairId + `</div>
        <div class="hint">告诉女朋友这个配对码和密码</div>
        ` + (!state.partnerConnected ? '<div style="margin-top:8px;color:var(--yellow);font-size:14px">⏳ 等待女朋友连接...</div>' : "") + `
      </div>

      ` + (pendingCount > 0 ? `
        <div class="pending-alert">
          🔔 ` + pendingCount + ` 条新订单待处理
        </div>
      ` : "") + `

      <h2>📋 订单列表</h2>

      ` + (state.orders.length === 0 ? `
        <div class="empty">
          <div class="empty-emoji">📭</div>
          还没有订单，等待女朋友下单吧~
        </div>
      ` : state.orders.map(o => renderBoyOrder(o)).join("")) + `

      <button class="btn btn-outline btn-block" style="margin-top:12px" onclick="act_leavePair()">
        退出配对
      </button>
    </div>`;
}

function renderBoyOrder(o) {
  const time = new Date(o.time).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  const statusLabels = { pending: "待处理", accepted: "已接单", done: "已完成" };
  const statusBadge = `<span class="badge badge-` + o.status + `">` + statusLabels[o.status] + `</span>`;

  let actions = "";
  if (o.status === "pending") {
    actions = `<button class="btn btn-blue btn-sm" onclick="act_updateOrder(''` + o.id + `'',''accepted'')">✅ 接单</button>`;
  }
  if (o.status === "accepted") {
    actions = `<button class="btn btn-primary btn-sm" onclick="act_updateOrder(''` + o.id + `'',''done'')">🎉 完成</button>`;
  }

  return `
    <div class="order-card ` + o.status + `">
      <div class="order-header">
        <div>
          <span class="order-item">` + escapeHtml(o.item) + `</span>
          ` + (o.quantity > 1 ? `<span class="order-qty"> x` + o.quantity + `</span>` : "") + `
        </div>
        ` + statusBadge + `
      </div>
      ` + (o.note ? `<div class="order-note">📝 ` + escapeHtml(o.note) + `</div>` : "") + `
      <div class="order-time">🕐 ` + time + `</div>
      ` + (actions ? `<div class="order-actions">` + actions + `</div>` : "") + `
    </div>`;
}

// ===== 女友主界面 =====
function renderGirlMain() {
  const tab = state.girlTab;
  const dotClass = state.partnerConnected ? "connected" : "waiting";
  const dotLabel = state.partnerConnected ? "已连接" : "等待男朋友...";

  return `
    <div class="order-panel">
      <div class="top-bar">
        <span class="title">👧 女朋友 · 点单</span>
        <div style="display:flex;align-items:center;gap:8px">
          <button class="sound-btn" onclick="act_toggleSound()">` + (state.soundEnabled ? "🔔" : "🔕") + `</button>
          <span class="connected-badge">
            <span class="status-dot ` + dotClass + `"></span>` + dotLabel + `
          </span>
        </div>
      </div>

      <div class="tab-bar">
        <button class="tab-btn ` + (tab === "order" ? "active" : "") + `" onclick="state.girlTab=''order'';render()">🍽️ 我要点单</button>
        <button class="tab-btn ` + (tab === "my-orders" ? "active" : "") + `" onclick="state.girlTab=''my-orders'';render()">📋 我的订单
          ` + (state.orders.filter(o => o.status === "pending").length > 0 ? ` (` + state.orders.filter(o => o.status === "pending").length + `)` : "") + `
        </button>
      </div>

      ` + (tab === "order" ? renderGirlOrderPanel() : renderGirlMyOrders()) + `

      <button class="btn btn-outline btn-block" style="margin-top:12px" onclick="act_leavePair()">
        退出配对
      </button>
    </div>`;
}

function renderGirlOrderPanel() {
  return `
    <div class="menu-grid">
      ` + MENU_ITEMS.map(item => `
        <div class="menu-item" onclick="act_quickOrder(''` + item.name + `'')">
          <span class="menu-emoji">` + item.emoji + `</span>` + item.name + `
        </div>
      `).join("") + `
    </div>

    <div class="custom-order">
      <div style="font-weight:600;font-size:15px;margin-bottom:8px">✨ 自定义点单</div>
      <div style="display:flex;gap:8px">
        <input class="input" id="custom-input" placeholder="想吃什么？" style="flex:1" autocomplete="off">
        <input class="input" id="custom-note" placeholder="备注（选填）" style="flex:1" autocomplete="off">
      </div>
      <div style="display:flex;gap:8px;align-items:center;margin-top:8px">
        <span style="font-size:14px;color:var(--gray-600)">数量：</span>
        <input class="input" id="custom-qty" type="number" value="1" min="1" max="99" style="width:70px;text-align:center" autocomplete="off">
        <button class="btn btn-primary" style="flex:1" onclick="act_customOrder()">📩 下单</button>
      </div>
    </div>
  `;
}

function renderGirlMyOrders() {
  if (state.orders.length === 0) {
    return `
      <div class="empty">
        <div class="empty-emoji">📭</div>
        还没有点过单，去点单吧~
      </div>`;
  }

  return `
    <div class="my-orders">
      ` + state.orders.map(o => {
        const time = new Date(o.time).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
        const statusEmoji = { pending: "⏳", accepted: "✅", done: "🎉" };
        const statusLabel = { pending: "等待接单", accepted: "已接单", done: "已完成" };
        return `
          <div class="my-order-card">
            <div>
              <div style="font-weight:600">` + escapeHtml(o.item) + ` ` + (o.quantity > 1 ? `x` + o.quantity : "") + `</div>
              ` + (o.note ? `<div style="font-size:12px;color:var(--gray-600);margin-top:2px">📝 ` + escapeHtml(o.note) + `</div>` : "") + `
              <div style="font-size:12px;color:var(--gray-400);margin-top:2px">🕐 ` + time + `</div>
            </div>
            <span class="badge badge-` + o.status + `">` + statusEmoji[o.status] + ` ` + statusLabel[o.status] + `</span>
          </div>`;
      }).join("") + `
    </div>`;
}

// ===== 工具函数 =====
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ===== 启动 =====
requestNotificationPermission();
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) updatePageTitle();
});
connect();
render();
