// ============================================================
// ChatBox Msg Cleaner - Cloudflare Workers MCP Server v2.1.0
// ============================================================

// ---------- 解析器 ----------

function normalizeRole(role) {
  const lower = role.toLowerCase().trim();
  const userNames = ["you", "user", "human", "我", "用户", "me"];
  const assistantNames = [
    "chatgpt", "gpt", "assistant", "ai", "claude",
    "bot", "助手", "机器人", "copilot", "gemini",
    "deepseek", "grok", "chatbox", "kimi", "qwen",
    "通义", "豆包", "doubao",
  ];
  const systemNames = ["system", "系统"];
  if (userNames.includes(lower)) return "user";
  if (assistantNames.includes(lower)) return "assistant";
  if (systemNames.includes(lower)) return "system";
  return lower;
}

function parseMarkdown(text) {
  const messages = [];
  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const splitPattern = /^(?:#{1,6}\s+(.+?)[:：]\s*$|^\*\*(.+?)[:：]\*\*\s*$|^>\s*\*\*(.+?)[:：]\*\*\s*$)/gm;
  const segments = [];
  let match;
  while ((match = splitPattern.exec(text)) !== null) {
    const role = (match[1] || match[2] || match[3]).trim();
    segments.push({ role, startIndex: match.index + match[0].length });
  }
  for (let i = 0; i < segments.length; i++) {
    const start = segments[i].startIndex;
    const end = i + 1 < segments.length
      ? text.lastIndexOf("\n", segments[i + 1].startIndex - 1)
      : text.length;
    const content = text.slice(start, end).trim();
    if (content) {
      messages.push({ role: normalizeRole(segments[i].role), content });
    }
  }
  return messages;
}

function parsePlainText(text) {
  const messages = [];
  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rolePattern = /^(You|User|我|用户|Human|ChatGPT|GPT|Assistant|AI|Claude|Bot|System|系统|助手)\s*[:：]\s*$/gim;
  const segments = [];
  let match;
  while ((match = rolePattern.exec(text)) !== null) {
    segments.push({ role: match[1].trim(), startIndex: match.index + match[0].length });
  }
  for (let i = 0; i < segments.length; i++) {
    const start = segments[i].startIndex;
    const end = i + 1 < segments.length
      ? text.lastIndexOf("\n", segments[i + 1].startIndex - 1)
      : text.length;
    const content = text.slice(start, end).trim();
    if (content) {
      messages.push({ role: normalizeRole(segments[i].role), content });
    }
  }
  return messages;
}

function parseJSON(text) {
  try {
    const data = JSON.parse(text);
    const messages = [];
    const items = Array.isArray(data) ? data : data.messages || data.data || [];
    for (const item of items) {
      if (item.role && item.content) {
        messages.push({
          role: normalizeRole(item.role),
          content: typeof item.content === "string" ? item.content : JSON.stringify(item.content),
        });
      }
    }
    return messages;
  } catch {
    return [];
  }
}

function extractTitle(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const data = JSON.parse(trimmed);
      const obj = Array.isArray(data) ? null : data;
      if (obj) {
        const t = obj.title || obj.name || obj.topic || obj.subject;
        if (t && typeof t === "string") return t.slice(0, 60);
      }
    } catch {}
  }
  const lines = trimmed.split("\n");
  for (const line of lines) {
    const l = line.trim();
    const titleMatch = l.match(/^#{1,3}\s+(.+?)\s*$/);
    if (titleMatch) {
      const candidate = titleMatch[1].replace(/[:：]\s*$/, "").trim();
      const roleNames = [
        "you", "user", "human", "chatgpt", "gpt", "assistant",
        "ai", "claude", "bot", "system", "我", "用户", "助手", "系统",
      ];
      if (!roleNames.includes(candidate.toLowerCase())) {
        return candidate.slice(0, 60);
      }
    }
  }
  return null;
}

function autoParseChat(text) {
  const trimmed = text.trim();
  const title = extractTitle(trimmed);
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    const result = parseJSON(trimmed);
    if (result.length > 0) return { title, messages: result };
  }
  if (/^#{1,6}\s+.+[:：]\s*$/m.test(trimmed) || /^\*\*.+[:：]\*\*\s*$/m.test(trimmed)) {
    const result = parseMarkdown(trimmed);
    if (result.length > 0) return { title, messages: result };
  }
  const result = parsePlainText(trimmed);
  if (result.length > 0) return { title, messages: result };
  for (const parser of [parseMarkdown, parsePlainText]) {
    const r = parser(trimmed);
    if (r.length > 0) return { title, messages: r };
  }
  return { title, messages: [] };
}

// ---------- 输出格式化 ----------

function formatOutput(messages, numbered, outputFormat, separator) {
  const userMessages = messages.filter((m) => m.role === "user").filter((m) => m.content.trim().length > 0);
  if (outputFormat === "json") {
    return JSON.stringify(userMessages.map((m, i) => ({ index: i + 1, content: m.content })), null, 2);
  }
  if (outputFormat === "markdown") {
    return userMessages.map((m, i) => `### ${numbered ? `消息 ${i + 1}` : "用户消息"}\n\n${m.content}`).join("\n\n---\n\n");
  }
  if (numbered) {
    return userMessages.map((m, i) => `[${i + 1}]\n${m.content}`).join(separator);
  }
  return userMessages.map((m) => m.content).join(separator);
}

// ---------- MCP 协议处理 ----------

const SERVER_INFO = {
  name: "chatbox-msg-cleaner",
  version: "2.1.0",
};

const TOOLS = [
  {
    name: "clean_chat_text",
    description: "清洗 ChatBox 导出的对话文本，只保留用户消息。每条消息独立分隔。",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "ChatBox 导出的对话文本内容（TXT / Markdown / JSON）" },
        numbered: { type: "boolean", description: "是否给每条消息编号", default: false },
        separator: { type: "string", description: "消息之间的分隔符", default: "\n\n---\n\n" },
        output_format: { type: "string", enum: ["plain", "markdown", "json"], description: "输出格式", default: "plain" },
      },
      required: ["text"],
    },
  },
  {
    name: "analyze_chat",
    description: "分析 ChatBox 对话的结构，查看角色分布和消息统计。",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "对话文本内容" },
      },
      required: ["text"],
    },
  },
];

function handleToolCall(name, args) {
  if (name === "clean_chat_text") {
    const { text, numbered = false, separator = "\n\n---\n\n", output_format = "plain" } = args;
    const { title, messages } = autoParseChat(text);
    if (messages.length === 0) {
      return { content: [{ type: "text", text: "⚠️ 未能识别出对话结构。\n\n支持的格式：\n- Markdown：`#### You:` / `**User:**`\n- 纯文本：`You:` / `User:` / `我:`\n- JSON：`[{role, content}]`" }] };
    }
    const totalMessages = messages.length;
    const userCount = messages.filter((m) => m.role === "user").length;
    const output = formatOutput(messages, numbered, output_format, separator);
    const titleInfo = title ? `📝 对话标题：${title}` : "📝 对话标题：未检测到";
    const stats = `📊 统计：共 ${totalMessages} 条消息，其中用户消息 ${userCount} 条`;
    return { content: [{ type: "text", text: `${titleInfo}\n${stats}\n\n${output}` }] };
  }

  if (name === "analyze_chat") {
    const { text } = args;
    const { title, messages } = autoParseChat(text);
    if (messages.length === 0) {
      return { content: [{ type: "text", text: "⚠️ 未能识别出对话结构。" }] };
    }
    const roleStats = {};
    const roleLengths = {};
    for (const m of messages) {
      roleStats[m.role] = (roleStats[m.role] || 0) + 1;
      roleLengths[m.role] = (roleLengths[m.role] || 0) + m.content.length;
    }
    let report = `## 📊 对话分析报告\n\n`;
    if (title) report += `- **对话标题**：${title}\n`;
    report += `- **总消息数**：${messages.length}\n\n`;
    report += `| 角色 | 消息数 | 平均字数 | 总字数 |\n`;
    report += `|------|--------|----------|--------|\n`;
    for (const [role, count] of Object.entries(roleStats)) {
      const avgLen = Math.round(roleLengths[role] / count);
      report += `| ${role} | ${count} 条 | ${avgLen} 字/条 | ${roleLengths[role]} 字 |\n`;
    }
    report += `\n### 前 3 条用户消息预览\n\n`;
    const userPreview = messages.filter((m) => m.role === "user").slice(0, 3);
    userPreview.forEach((m, i) => {
      const preview = m.content.length > 100 ? m.content.slice(0, 100) + "..." : m.content;
      report += `${i + 1}. ${preview}\n`;
    });
    if (title) report += `\n> 💡 检测到对话标题 **"${title}"**`;
    return { content: [{ type: "text", text: report }] };
  }

  return { content: [{ type: "text", text: `❌ 未知工具：${name}` }], isError: true };
}

function buildJsonRpcResponse(request) {
  const { method, id, params } = request;

  switch (method) {
    case "initialize":
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        },
      };

    case "notifications/initialized":
      return null;

    case "tools/list":
      return {
        jsonrpc: "2.0",
        id,
        result: { tools: TOOLS },
      };

    case "tools/call":
      const result = handleToolCall(params.name, params.arguments || {});
      return {
        jsonrpc: "2.0",
        id,
        result,
      };

    case "ping":
      return {
        jsonrpc: "2.0",
        id,
        result: {},
      };

    default:
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      };
  }
}

// ---------- SSE 格式化 ----------

function sseMessage(eventType, data) {
  let msg = "";
  if (eventType) msg += `event: ${eventType}\n`;
  msg += `data: ${JSON.stringify(data)}\n\n`;
  return msg;
}

// ---------- Worker 入口 ----------

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Accept, Mcp-Session-Id",
      "Access-Control-Expose-Headers": "Mcp-Session-Id",
    };

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // 健康检查
    if (url.pathname === "/health" || url.pathname === "/") {
      return new Response(
        JSON.stringify({ status: "ok", ...SERVER_INFO }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ============================================================
    // Streamable HTTP MCP endpoint
    // POST /mcp → 返回 SSE 流
    // ============================================================
    if (url.pathname === "/mcp" && request.method === "POST") {
      const accept = request.headers.get("accept") || "";

      try {
        const body = await request.json();

        // 处理批量请求（JSON-RPC batch）
        const requests = Array.isArray(body) ? body : [body];
        const responses = [];

        for (const req of requests) {
          const resp = buildJsonRpcResponse(req);
          if (resp !== null) {
            responses.push(resp);
          }
        }

        // 如果没有需要回复的（全是 notifications），返回 202
        if (responses.length === 0) {
          return new Response(null, { status: 202, headers: corsHeaders });
        }

        // 如果客户端接受 SSE，返回 SSE 流
        if (accept.includes("text/event-stream")) {
          const encoder = new TextEncoder();
          const body = new ReadableStream({
            start(controller) {
              for (const resp of responses) {
                controller.enqueue(encoder.encode(sseMessage("message", resp)));
              }
              controller.close();
            },
          });

          return new Response(body, {
            status: 200,
            headers: {
              ...corsHeaders,
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
            },
          });
        }

        // 否则返回普通 JSON（兼容旧客户端）
        const result = responses.length === 1 ? responses[0] : responses;
        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });

      } catch (err) {
        const errResp = {
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "Parse error" },
        };
        if (accept.includes("text/event-stream")) {
          const encoder = new TextEncoder();
          const body = new ReadableStream({
            start(controller) {
              controller.enqueue(encoder.encode(sseMessage("message", errResp)));
              controller.close();
            },
          });
          return new Response(body, {
            status: 200,
            headers: {
              ...corsHeaders,
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
            },
          });
        }
        return new Response(JSON.stringify(errResp), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // DELETE /mcp → 关闭会话（无状态，直接返回成功）
    if (url.pathname === "/mcp" && request.method === "DELETE") {
      return new Response(null, { status: 200, headers: corsHeaders });
    }

    // GET /mcp → 服务端 SSE 推送（无状态 worker 不主动推送，返回空流）
    if (url.pathname === "/mcp" && request.method === "GET") {
      const accept = request.headers.get("accept") || "";
      if (accept.includes("text/event-stream")) {
        const encoder = new TextEncoder();
        const body = new ReadableStream({
          start(controller) {
            // 无状态 worker，没有主动推送的内容，保持连接
            const keepAlive = setInterval(() => {
              try {
                controller.enqueue(encoder.encode(": keepalive\n\n"));
              } catch {
                clearInterval(keepAlive);
              }
            }, 30000);
          },
        });
        return new Response(body, {
          headers: {
            ...corsHeaders,
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
          },
        });
      }
      return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
    }

    // ============================================================
    // Legacy SSE transport (旧版 /sse + /message 模式)
    // ============================================================
    if (url.pathname === "/sse" && request.method === "GET") {
      const sessionId = crypto.randomUUID();
      const messageUrl = `${url.origin}/message?sessionId=${sessionId}`;
      const encoder = new TextEncoder();
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(`event: endpoint\ndata: ${messageUrl}\n\n`));
          const keepAlive = setInterval(() => {
            try {
              controller.enqueue(encoder.encode(": keepalive\n\n"));
            } catch {
              clearInterval(keepAlive);
            }
          }, 30000);
        },
      });
      return new Response(body, {
        headers: {
          ...corsHeaders,
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        },
      });
    }

    if (url.pathname === "/message" && request.method === "POST") {
      try {
        const body = await request.json();
        const response = buildJsonRpcResponse(body);
        if (response === null) {
          return new Response(null, { status: 202, headers: corsHeaders });
        }
        return new Response(JSON.stringify(response), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (err) {
        return new Response(
          JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    return new Response("Not Found", { status: 404, headers: corsHeaders });
  },
};
