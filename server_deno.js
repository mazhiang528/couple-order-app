// ===== 情侣点单系统 - Deno 云端版 =====

const pairs = new Map();
const deviceRoles = new Map();

function generatePairId() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function hashPassword(password) {
  const data = new TextEncoder().encode(password);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

// ===== 静态文件服务 =====
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

async function serveStatic(pathname) {
  if (pathname === "/") pathname = "/index.html";
  const filePath = "./public" + pathname;
  try {
    const data = await Deno.readFile(filePath);
    const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
    return new Response(data, { headers: { "content-type": MIME[ext] || "application/octet-stream" } });
  } catch {
    return new Response("404 Not Found", { status: 404 });
  }
}

// ===== WebSocket 处理 =====
async function handleWs(ws) {
  console.log("[连接] 新设备");

  ws.onmessage = async (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch {
      send(ws, { type: "error", message: "消息格式错误" });
      return;
    }
    const device = deviceRoles.get(ws);

    switch (msg.type) {
      case "create_pair": {
        if (device) { send(ws, { type: "error", message: "你已在一个配对中，请先退出" }); return; }
        const { password } = msg;
        if (!password || password.length < 4) { send(ws, { type: "error", message: "密码至少4位" }); return; }
        for (const [, pair] of pairs) {
          if (pair.boyfriendWs === ws) { send(ws, { type: "error", message: "你已创建过一个配对了" }); return; }
        }
        const pairId = generatePairId();
        const hashedPw = await hashPassword(password);
        pairs.set(pairId, { password: hashedPw, boyfriendWs: ws, girlfriendWs: null, orders: [], createdAt: Date.now() });
        deviceRoles.set(ws, { pairId, role: "boyfriend" });
        send(ws, { type: "pair_created", pairId, message: `配对码已创建，请让对方输入：${pairId}` });
        break;
      }

      case "join_pair": {
        if (device) { send(ws, { type: "error", message: "你已在一个配对中，请先退出" }); return; }
        const { pairId, password } = msg;
        const pair = pairs.get(pairId);
        if (!pair) { send(ws, { type: "error", message: "配对码不存在" }); return; }
        const hashedPw = await hashPassword(password);
        if (hashedPw !== pair.password) { send(ws, { type: "error", message: "密码错误" }); return; }
        if (pair.girlfriendWs) { send(ws, { type: "error", message: "该配对码已被另一台设备使用" }); return; }
        pair.girlfriendWs = ws;
        deviceRoles.set(ws, { pairId, role: "girlfriend" });
        send(ws, { type: "pair_joined", message: "配对成功！" });
        send(pair.boyfriendWs, { type: "partner_connected", message: "你的另一半已连接！" });
        break;
      }

      case "place_order": {
        if (!device || device.role !== "girlfriend") { send(ws, { type: "error", message: "只有女朋友才能下单哦~" }); return; }
        const pair = pairs.get(device.pairId);
        if (!pair) { send(ws, { type: "error", message: "配对不存在" }); return; }
        const { item, note = "", quantity = 1 } = msg;
        if (!item) { send(ws, { type: "error", message: "请填写想要的东西" }); return; }
        const order = {
          id: crypto.randomUUID(), item, note, quantity,
          time: new Date().toISOString(), status: "pending",
        };
        pair.orders.unshift(order);
        send(pair.boyfriendWs, { type: "new_order", order });
        send(ws, { type: "order_placed", order });
        break;
      }

      case "update_order": {
        if (!device || device.role !== "boyfriend") { send(ws, { type: "error", message: "无权限" }); return; }
        const pair = pairs.get(device.pairId);
        if (!pair) { send(ws, { type: "error", message: "配对不存在" }); return; }
        const { orderId, status } = msg;
        const order = pair.orders.find(o => o.id === orderId);
        if (!order) { send(ws, { type: "error", message: "订单不存在" }); return; }
        if (!["accepted", "done"].includes(status)) { send(ws, { type: "error", message: "无效状态" }); return; }
        order.status = status;
        send(ws, { type: "order_updated", order });
        send(pair.girlfriendWs, { type: "order_updated", order });
        break;
      }

      case "get_orders": {
        if (!device) { send(ws, { type: "error", message: "请先配对" }); return; }
        const pair = pairs.get(device.pairId);
        if (!pair) { send(ws, { type: "error", message: "配对不存在" }); return; }
        send(ws, { type: "orders_list", orders: pair.orders });
        break;
      }

      case "leave_pair": {
        if (!device) { send(ws, { type: "error", message: "你不在任何配对中" }); return; }
        const pair = pairs.get(device.pairId);
        if (pair) {
          if (device.role === "boyfriend") {
            send(pair.girlfriendWs, { type: "partner_disconnected", message: "对方已断开连接" });
            if (pair.girlfriendWs) deviceRoles.delete(pair.girlfriendWs);
            pairs.delete(device.pairId);
          } else {
            pair.girlfriendWs = null;
            send(pair.boyfriendWs, { type: "partner_disconnected", message: "对方已断开连接" });
          }
        }
        deviceRoles.delete(ws);
        send(ws, { type: "pair_left", message: "已退出配对" });
        break;
      }

      default:
        send(ws, { type: "error", message: "未知消息类型" });
    }
  };

  ws.onclose = () => {
    const device = deviceRoles.get(ws);
    if (device) {
      const pair = pairs.get(device.pairId);
      if (pair) {
        if (device.role === "boyfriend") {
          send(pair.girlfriendWs, { type: "partner_disconnected", message: "对方已断开连接" });
          if (pair.girlfriendWs) deviceRoles.delete(pair.girlfriendWs);
          pairs.delete(device.pairId);
        } else {
          pair.girlfriendWs = null;
          send(pair.boyfriendWs, { type: "partner_disconnected", message: "对方已断开连接" });
        }
      }
      deviceRoles.delete(ws);
    }
  };
}

// ===== HTTP 服务器 =====
Deno.serve({ port: 3456 }, (req) => {
  const upgrade = req.headers.get("upgrade") || "";
  if (upgrade.toLowerCase() === "websocket") {
    const { socket, response } = Deno.upgradeWebSocket(req);
    handleWs(socket);
    return response;
  }
  const url = new URL(req.url);
  return serveStatic(url.pathname);
});

console.log("❤️  情侣点单系统已启动: http://localhost:3456");
