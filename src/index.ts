import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";

// ============================================================
// 类型定义
// ============================================================

interface ParsedMessage {
  role: string;
  content: string;
}

interface ParseResult {
  title: string | null;
  messages: ParsedMessage[];
}

// ============================================================
// 对话标题提取
// ============================================================

/**
 * 从对话文本中提取标题
 *
 * ChatBox 导出格式通常顶部包含标题，例如：
 *   # 对话标题
 *   # 帮我写一个爬虫
 *
 * 或者 JSON 中的 title / name 字段
 */
function extractTitle(text: string): string | null {
  const trimmed = text.trim();

  // JSON 格式：找 title / name / topic 字段
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const data = JSON.parse(trimmed);
      const obj = Array.isArray(data) ? null : data;
      if (obj) {
        const t = obj.title || obj.name || obj.topic || obj.subject;
        if (t && typeof t === "string") return sanitizeFilename(t);
      }
    } catch {
      // 不是合法 JSON，继续尝试其他方式
    }
  }

  // Markdown 标题：取第一个 # 开头的行（排除角色标记）
  const lines = trimmed.split("\n");
  for (const line of lines) {
    const l = line.trim();
    // 匹配 # 标题，但排除 #### You: 这类角色行
    const titleMatch = l.match(/^#{1,3}\s+(.+?)\s*$/);
    if (titleMatch) {
      const candidate = titleMatch[1].replace(/[:：]\s*$/, "").trim();
      // 排除角色名
      const roleNames = [
        "you", "user", "human", "chatgpt", "gpt", "assistant",
        "ai", "claude", "bot", "system", "我", "用户", "助手", "系统",
      ];
      if (!roleNames.includes(candidate.toLowerCase())) {
        return sanitizeFilename(candidate);
      }
    }
  }

  // 尝试从文件名格式的首行提取（有些导出首行就是标题文字）
  const firstLine = lines[0]?.trim();
  if (
    firstLine &&
    firstLine.length > 0 &&
    firstLine.length <= 80 &&
    !firstLine.includes(":") &&
    !firstLine.includes("：") &&
    !firstLine.startsWith("*") &&
    !firstLine.startsWith(">") &&
    !firstLine.startsWith("-")
  ) {
    return sanitizeFilename(firstLine);
  }

  return null;
}

/**
 * 清理文件名中的非法字符
 */
function sanitizeFilename(name: string): string {
  return name
    .replace(/[<>:"\/\\|?*]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 60);
}

/**
 * 生成导出文件名
 * 优先用对话标题，找不到则用时间戳
 */
function generateFilename(
  title: string | null,
  format: string
): string {
  const ext = format === "json" ? ".json" : format === "markdown" ? ".md" : ".txt";
  if (title) {
    return `${title}_cleaned${ext}`;
  }
  const now = new Date();
  const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;
  return `chat_cleaned_${ts}${ext}`;
}

// ============================================================
// ChatBox 导出格式解析器
// ============================================================

/**
 * 解析 Markdown 格式
 */
function parseMarkdown(text: string): ParsedMessage[] {
  const messages: ParsedMessage[] = [];
  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  const splitPattern =
    /^(?:#{1,6}\s+(.+?)[:：]\s*$|^\*\*(.+?)[:：]\*\*\s*$|^>\s*\*\*(.+?)[:：]\*\*\s*$)/gm;

  const segments: { role: string; startIndex: number }[] = [];
  let match: RegExpExecArray | null;

  while ((match = splitPattern.exec(text)) !== null) {
    const role = (match[1] || match[2] || match[3]).trim();
    segments.push({ role, startIndex: match.index + match[0].length });
  }

  for (let i = 0; i < segments.length; i++) {
    const start = segments[i].startIndex;
    const end =
      i + 1 < segments.length
        ? text.lastIndexOf("\n", segments[i + 1].startIndex - 1)
        : text.length;
    const content = text.slice(start, end).trim();
    if (content) {
      messages.push({
        role: normalizeRole(segments[i].role),
        content,
      });
    }
  }

  return messages;
}

/**
 * 解析纯文本格式
 */
function parsePlainText(text: string): ParsedMessage[] {
  const messages: ParsedMessage[] = [];
  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  const rolePattern =
    /^(You|User|我|用户|Human|ChatGPT|GPT|Assistant|AI|Claude|Bot|System|系统|助手)\s*[:：]\s*$/gim;

  const segments: { role: string; startIndex: number }[] = [];
  let match: RegExpExecArray | null;

  while ((match = rolePattern.exec(text)) !== null) {
    const role = match[1].trim();
    segments.push({ role, startIndex: match.index + match[0].length });
  }

  for (let i = 0; i < segments.length; i++) {
    const start = segments[i].startIndex;
    const end =
      i + 1 < segments.length
        ? text.lastIndexOf("\n", segments[i + 1].startIndex - 1)
        : text.length;
    const content = text.slice(start, end).trim();
    if (content) {
      messages.push({
        role: normalizeRole(segments[i].role),
        content,
      });
    }
  }

  return messages;
}

/**
 * 解析 JSON 格式
 */
function parseJSON(text: string): ParsedMessage[] {
  try {
    const data = JSON.parse(text);
    const messages: ParsedMessage[] = [];
    const items = Array.isArray(data)
      ? data
      : data.messages || data.data || [];

    for (const item of items) {
      if (item.role && item.content) {
        messages.push({
          role: normalizeRole(item.role),
          content:
            typeof item.content === "string"
              ? item.content
              : JSON.stringify(item.content),
        });
      }
    }
    return messages;
  } catch {
    return [];
  }
}

/**
 * 统一角色名称
 */
function normalizeRole(role: string): string {
  const lower = role.toLowerCase().trim();

  const userNames = ["you", "user", "human", "我", "用户", "me"];
  const assistantNames = [
    "chatgpt", "gpt", "assistant", "ai", "claude",
    "bot", "助手", "机器人", "copilot", "gemini",
    "deepseek", "grok", "chatbox",
  ];
  const systemNames = ["system", "系统"];

  if (userNames.includes(lower)) return "user";
  if (assistantNames.includes(lower)) return "assistant";
  if (systemNames.includes(lower)) return "system";

  return lower;
}

/**
 * 自动检测格式并解析
 */
function autoParseChat(text: string): ParseResult {
  const trimmed = text.trim();
  const title = extractTitle(trimmed);

  // 尝试 JSON
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    const result = parseJSON(trimmed);
    if (result.length > 0) return { title, messages: result };
  }

  // 尝试 Markdown
  if (
    /^#{1,6}\s+.+[:：]\s*$/m.test(trimmed) ||
    /^\*\*.+[:：]\*\*\s*$/m.test(trimmed)
  ) {
    const result = parseMarkdown(trimmed);
    if (result.length > 0) return { title, messages: result };
  }

  // 纯文本
  const result = parsePlainText(trimmed);
  if (result.length > 0) return { title, messages: result };

  // 兜底
  for (const parser of [parseMarkdown, parsePlainText]) {
    const r = parser(trimmed);
    if (r.length > 0) return { title, messages: r };
  }

  return { title, messages: [] };
}

/**
 * 过滤并格式化用户消息 —— 每条消息独立分隔
 */
function extractUserMessages(
  messages: ParsedMessage[],
  options: {
    includeIndex: boolean;
    separator: string;
    trimEmpty: boolean;
  }
): string {
  let userMessages = messages.filter((m) => m.role === "user");

  if (options.trimEmpty) {
    userMessages = userMessages.filter((m) => m.content.trim().length > 0);
  }

  if (options.includeIndex) {
    return userMessages
      .map((m, i) => `[${i + 1}]\n${m.content}`)
      .join(options.separator);
  }

  return userMessages.map((m) => m.content).join(options.separator);
}

/**
 * 根据格式生成输出内容
 */
function formatOutput(
  messages: ParsedMessage[],
  numbered: boolean,
  outputFormat: string,
  separator: string
): string {
  const userMessages = messages.filter((m) => m.role === "user");

  if (outputFormat === "json") {
    return JSON.stringify(
      userMessages.map((m, i) => ({
        index: i + 1,
        content: m.content,
      })),
      null,
      2
    );
  }

  if (outputFormat === "markdown") {
    return userMessages
      .map(
        (m, i) =>
          `### ${numbered ? `消息 ${i + 1}` : "用户消息"}\n\n${m.content}`
      )
      .join("\n\n---\n\n");
  }

  return extractUserMessages(messages, {
    includeIndex: numbered,
    separator,
    trimEmpty: true,
  });
}

/**
 * 保存文件的通用方法
 */
function saveOutput(
  output: string,
  saveTo: string | undefined,
  title: string | null,
  outputFormat: string,
  saveDir?: string
): { saved: boolean; savePath: string | null } {
  if (saveTo === "auto" || (saveTo && saveTo.trim() === "")) {
    // 自动生成文件名
    const dir = saveDir || process.cwd();
    const filename = generateFilename(title, outputFormat);
    const fullPath = path.resolve(dir, filename);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, output, "utf-8");
    return { saved: true, savePath: fullPath };
  }

  if (saveTo) {
    const fullPath = path.resolve(saveTo);
    // 如果 save_to 是一个目录，则自动生成文件名放进去
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
      const filename = generateFilename(title, outputFormat);
      const filePath = path.join(fullPath, filename);
      fs.writeFileSync(filePath, output, "utf-8");
      return { saved: true, savePath: filePath };
    }
    // 否则当作完整文件路径
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, output, "utf-8");
    return { saved: true, savePath: fullPath };
  }

  return { saved: false, savePath: null };
}

// ============================================================
// MCP Server
// ============================================================

const server = new McpServer({
  name: "chatbox-msg-cleaner",
  version: "1.0.1",
});

/**
 * 工具1: clean_chat_text
 * 直接传入文本内容进行清洗
 */
server.tool(
  "clean_chat_text",
  "清洗 ChatBox 导出的对话文本，只保留用户消息。直接传入文本内容。",
  {
    text: z.string().describe("ChatBox 导出的对话文本内容（TXT / Markdown / JSON）"),
    numbered: z
      .boolean()
      .default(false)
      .describe("是否给每条消息编号，默认 false"),
    separator: z
      .string()
      .default("\n\n---\n\n")
      .describe("消息之间的分隔符，默认用 --- 分隔线"),
    output_format: z
      .enum(["plain", "markdown", "json"])
      .default("plain")
      .describe("输出格式：plain 纯文本 / markdown / json"),
    save_to: z
      .string()
      .optional()
      .describe("可选：保存结果到指定路径。传 'auto' 自动用对话标题命名，传目录路径则自动生成文件名放入该目录，传完整路径则直接保存"),
  },
  async ({ text, numbered, separator, output_format, save_to }) => {
    const { title, messages } = autoParseChat(text);

    if (messages.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: "⚠️ 未能识别出对话结构。请检查文本格式是否为 ChatBox 的导出格式。\n\n支持的格式：\n- Markdown：`#### You:` / `**User:**` 开头\n- 纯文本：`You:` / `User:` / `我:` 开头\n- JSON：`[{role, content}]` 数组",
          },
        ],
      };
    }

    const totalMessages = messages.length;
    const userCount = messages.filter((m) => m.role === "user").length;
    const output = formatOutput(messages, numbered, output_format, separator);

    const stats = `📊 统计：共 ${totalMessages} 条消息，其中用户消息 ${userCount} 条`;
    const titleInfo = title ? `📝 对话标题：${title}` : "📝 对话标题：未检测到";

    // 尝试保存
    const { saved, savePath } = saveOutput(output, save_to, title, output_format);

    if (saved) {
      return {
        content: [
          {
            type: "text" as const,
            text: `✅ 清洗完成！\n${titleInfo}\n${stats}\n💾 已保存至：${savePath}`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: `${titleInfo}\n${stats}\n\n${output}`,
        },
      ],
    };
  }
);

/**
 * 工具2: clean_chat_file
 * 从文件路径读取并清洗
 */
server.tool(
  "clean_chat_file",
  "从文件路径读取 ChatBox 导出的对话文件并清洗，只保留用户消息。",
  {
    file_path: z.string().describe("文件路径（支持 .txt / .md / .json）"),
    numbered: z
      .boolean()
      .default(false)
      .describe("是否给消息编号"),
    output_format: z
      .enum(["plain", "markdown", "json"])
      .default("plain")
      .describe("输出格式"),
    save_to: z
      .string()
      .optional()
      .describe("可选：保存结果到指定路径。传 'auto' 自动用对话标题命名并保存到源文件同目录，传目录路径则自动生成文件名，传完整路径则直接保存"),
  },
  async ({ file_path, numbered, output_format, save_to }) => {
    const resolvedPath = path.resolve(file_path);

    if (!fs.existsSync(resolvedPath)) {
      return {
        content: [
          {
            type: "text" as const,
            text: `❌ 文件不存在：${resolvedPath}`,
          },
        ],
      };
    }

    const text = fs.readFileSync(resolvedPath, "utf-8");
    const { title, messages } = autoParseChat(text);

    if (messages.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: "⚠️ 未能识别出对话结构，请确认文件是 ChatBox 的导出格式。",
          },
        ],
      };
    }

    const userCount = messages.filter((m) => m.role === "user").length;
    const totalMessages = messages.length;
    const output = formatOutput(messages, numbered, output_format, "\n\n---\n\n");

    const titleInfo = title ? `📝 对话标题：${title}` : "📝 对话标题：未检测到";
    const stats = `📊 共 ${totalMessages} 条消息，用户消息 ${userCount} 条`;

    // 保存文件，auto 模式下存到源文件同目录
    const sourceDir = path.dirname(resolvedPath);
    const { saved, savePath } = saveOutput(output, save_to, title, output_format, sourceDir);

    if (saved) {
      return {
        content: [
          {
            type: "text" as const,
            text: `✅ 清洗完成！\n📂 源文件：${path.basename(resolvedPath)}\n${titleInfo}\n${stats}\n💾 已保存至：${savePath}`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: `📂 文件：${path.basename(resolvedPath)}\n${titleInfo}\n${stats}\n\n${output}`,
        },
      ],
    };
  }
);

/**
 * 工具3: analyze_chat
 * 分析对话结构
 */
server.tool(
  "analyze_chat",
  "分析 ChatBox 对话文件的结构，查看角色分布和消息统计。",
  {
    text: z.string().describe("对话文本内容"),
  },
  async ({ text }) => {
    const { title, messages } = autoParseChat(text);

    if (messages.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: "⚠️ 未能识别出对话结构。",
          },
        ],
      };
    }

    const roleStats: Record<string, number> = {};
    const roleLengths: Record<string, number> = {};

    for (const m of messages) {
      roleStats[m.role] = (roleStats[m.role] || 0) + 1;
      roleLengths[m.role] = (roleLengths[m.role] || 0) + m.content.length;
    }

    let report = `## 📊 对话分析报告\n\n`;
    if (title) {
      report += `- **对话标题**：${title}\n`;
    }
    report += `- **总消息数**：${messages.length}\n\n`;
    report += `| 角色 | 消息数 | 平均字数 | 总字数 |\n`;
    report += `|------|--------|----------|--------|\n`;

    for (const [role, count] of Object.entries(roleStats)) {
      const avgLen = Math.round(roleLengths[role] / count);
      report += `| ${role} | ${count} 条 | ${avgLen} 字/条 | ${roleLengths[role]} 字 |\n`;
    }

    report += `\n### 前 3 条用户消息预览\n\n`;
    const userPreview = messages
      .filter((m) => m.role === "user")
      .slice(0, 3);
    for (const [i, m] of userPreview.entries()) {
      const preview =
        m.content.length > 100
          ? m.content.slice(0, 100) + "..."
          : m.content;
      report += `${i + 1}. ${preview}\n`;
    }

    if (title) {
      report += `\n> 💡 检测到对话标题 **"${title}"**，导出时将自动用作文件名`;
    }

    return {
      content: [
        {
          type: "text" as const,
          text: report,
        },
      ],
    };
  }
);

// ============================================================
// 启动
// ============================================================

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("🧹 ChatBox Msg Cleaner MCP Server 已启动 (v1.0.1)");
}

main().catch(console.error);
