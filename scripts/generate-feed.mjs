/**
 * 每日时政推送生成脚本
 * 从人民网等官媒抓取当日新闻，用 AI 生成结构化推送内容，更新 index.html
 *
 * 用法: node scripts/generate-feed.mjs
 * 环境变量:
 *   AI_API_KEY  - LLM API 密钥（Deepseek/OpenAI 兼容接口）
 *   AI_BASE_URL - API 地址（默认 Deepseek: https://api.deepseek.com/v1）
 *   AI_MODEL    - 模型名（默认 deepseek-chat）
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const INDEX = join(ROOT, 'index.html');

// ======================== 配置 ========================
const AI_KEY = process.env.AI_API_KEY || '';
const AI_URL = process.env.AI_BASE_URL || 'https://api.deepseek.com/v1';
const AI_MODEL = process.env.AI_MODEL || 'deepseek-chat';

// 新闻源
const NEWS_SOURCES = [
  { name: '人民网·观点', url: 'http://opinion.people.com.cn/' },
  { name: '人民网·时评', url: 'http://opinion.people.com.cn/GB/404305/index.html' },
  { name: '新华网·评论', url: 'http://www.news.cn/comments/' },
  { name: '光明网·观点', url: 'https://guancha.gmw.cn/' },
];

const EXAM_TAGS = ['国考', '广东省考', '浙江省考', '福建省考', '事业编', '地方省考'];

// ======================== 工具函数 ========================
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// 清理和修复 AI 返回的 JSON
function cleanAndParseJson(text) {
  if (!text) throw new Error('AI 返回空内容');
  let raw = text.trim();
  // 去掉 markdown 代码块标记
  raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  raw = raw.replace(/^\uFEFF/, '').trim();
  // 找到第一个 { 和最后一个 }
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first < 0 || last < 0 || last <= first) throw new Error('找不到 JSON 对象边界');
  raw = raw.slice(first, last + 1);
  // 尝试修复常见问题：尾逗号、未转义换行
  try {
    return JSON.parse(raw);
  } catch (e1) {
    try {
      // 修复：冒号前的非法字符、中文冒号
      let fixed = raw
        .replace(/([\u4e00-\u9fa5])\s*:\s*([{\["\d])/g, '$1":$2')    // 补引号: 中文键名: 值 -> "中文键名":值
        .replace(/,\s*([}\]])/g, '$1')                               // 去掉尾逗号
        .replace(/\n(?=\s*[^"\d{\[\]}:,\s])/g, ' ');                 // 某些非法换行
      return JSON.parse(fixed);
    } catch (e2) {
      // 最后一招：逐字符找配对大括号，暴力切分
      let depth = 0, start = -1;
      for (let i = 0; i < raw.length; i++) {
        if (raw[i] === '{') { depth++; if (start < 0) start = i; }
        else if (raw[i] === '}') {
          depth--;
          if (depth === 0 && start >= 0) {
            try { return JSON.parse(raw.slice(start, i + 1)); } catch (_) {}
            break;
          }
        }
      }
      throw new Error('JSON 解析失败: ' + e1.message);
    }
  }
}

// 确保返回的 feed 结构完整
function normalizeFeed(feed) {
  const todayStr = today();
  const ensure = (arr, minLen = 1) => (Array.isArray(arr) && arr.length >= minLen) ? arr : null;
  // 不同键名兼容
  const shizheng = ensure(feed.shizheng || feed.news || feed.items || feed.时政 || feed.时政推送, 1);
  const sucai = ensure(feed.sucai || feed.material || feed.申论素材 || feed.素材);
  const chengyu = ensure(feed.chengyu || feed.idioms || feed.成语 || feed.高频成语);
  const changshi = ensure(feed.changshi || feed.knowledge || feed.常识 || feed.常识考点);

  if (!shizheng) throw new Error('AI 返回的时政板块为空');

  // 统一字段名
  const normShizheng = shizheng.map((it, i) => ({
    t: it.t || it.title || it.标题 || `时政${i + 1}`,
    s: it.s || it.summary || it.摘要 || it.content || it.内容 || '',
    src: it.src || it.source || it.来源 || '网络',
    d: it.d || it.date || it.日期 || todayStr,
    url: it.url || it.link || it.链接 || '',
    tags: Array.isArray(it.tags) ? it.tags : (it.标签 || (it.tags ? [it.tags] : [])),
    points: it.points || it.考点 || it.要点 || ''
  }));

  return {
    shizheng: normShizheng,
    sucai: (sucai || []).map((it, i) => ({
      t: it.t || it.title || it.主题 || `素材${i + 1}`,
      c: it.c || it.content || it.内容 || it.text || ''
    })),
    chengyu: (chengyu || []).map((it, i) => ({
      w: it.w || it.word || it.成语 || `成语${i + 1}`,
      m: it.m || it.meaning || it.释义 || it.意思 || ''
    })),
    changshi: (changshi || []).map((it, i) => ({
      t: it.t || it.title || it.标题 || `常识${i + 1}`,
      c: it.c || it.content || it.内容 || it.text || ''
    }))
  };
}

// ======================== 抓取新闻 ========================
async function fetchNews() {
  const results = [];
  for (const src of NEWS_SOURCES) {
    try {
      console.log(`抓取: ${src.name} ...`);
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 30000);
      const res = await fetch(src.url, {
        signal: ctrl.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
      });
      clearTimeout(timeout);
      if (!res.ok) { console.log(`  ${src.name} 返回 ${res.status}，跳过`); continue; }
      const html = await res.text();
      // 提取标题和链接
      const links = [];
      const re = /<a[^>]*href="(https?:\/\/[^"]*people\.com\.cn[^"]*|https?:\/\/[^"]*gmw\.cn[^"]*|https?:\/\/[^"]*news\.cn[^"]*)"[^>]*>([^<]{8,60})<\/a>/gi;
      let m;
      while ((m = re.exec(html)) && links.length < 15) {
        const title = m[2].trim();
        if (title.length > 6 && !title.includes('图片') && !title.includes('视频')) {
          links.push({ url: m[1], title });
        }
      }
      if (links.length) {
        results.push({ source: src.name, links });
        console.log(`  获取 ${links.length} 条链接`);
      }
    } catch (e) {
      console.log(`  ${src.name} 抓取失败: ${e.message}`);
    }
  }
  return results;
}

// ======================== AI 生成 ========================
// 单次调用 AI（通用）
async function aiJson(system, user, timeoutMs = 180000) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await fetch(`${AI_URL}/chat/completions`, {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${AI_KEY}`
        },
        body: JSON.stringify({
          model: AI_MODEL,
          messages: [
            { role: 'system', content: system + '\n只输出JSON，禁止任何额外文字、解释、markdown。' },
            { role: 'user', content: user }
          ],
          temperature: 0.8,
          max_tokens: 4000
        })
      });
      clearTimeout(tid);
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`API返回${res.status}: ${errText.slice(0, 200)}`);
      }
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content || '';
      console.log(`  AI返回: ${content.length}字符, 开头: ${content.slice(0, 120).replace(/\n/g, ' ')}`);
      return cleanAndParseJson(content);
    } catch (e) {
      console.log(`  第${attempt}次尝试失败: ${e.message}`);
      if (attempt < 3) {
        await sleep(attempt * 5000);
      } else {
        throw e;
      }
    }
  }
}

// 拆分生成：分 4 次调用，每次一个板块
async function generateFeed(newsData) {
  const todayStr = today();
  const newsMap = {};
  const allLinks = [];
  for (const s of newsData) {
    for (const l of s.links) {
      newsMap[l.title] = { src: s.source, url: l.url, title: l.title };
      allLinks.push(l);
    }
  }
  const newsList = allLinks.slice(0, 15).map(l => `- ${l.title} <${l.url}>`).join('\n');
  const tagsJson = JSON.stringify(EXAM_TAGS);

  // 备用数据（某板块失败时使用）
  const fallbackSz = allLinks.slice(0, 10).map(l => ({
    t: l.title, s: `${l.title}。该新闻具有较高的考公价值，建议关注其背景和政策走向。`,
    src: newsMap[l.title]?.src || '网络', d: todayStr,
    url: newsMap[l.title]?.url || l.url, tags: ['国考'],
    points: '申论素材方向：政策类、治理类话题；行测常识：宏观政策走向。'
  }));
  const fallbackSc = [
    { t: '以人民为中心', c: '金句：江山就是人民，人民就是江山。案例：浙江千万工程20年坚持为民造福。考点：常用于民生、治理主题大作文分论点。' },
    { t: '高质量发展', c: '金句：发展是党执政兴国的第一要务。案例：粤港澳大湾区建设、长三角一体化。考点：新发展理念、实体经济、科技创新作文。' },
    { t: '基层治理', c: '金句：基础不牢，地动山摇。案例：枫桥经验新时代实践、网格化治理。考点：基层政权建设、干部下沉、为民服务作文。' },
    { t: '文化自信', c: '金句：文化兴国运兴，文化强民族强。案例：故宫文创、非遗活化、国潮兴起。考点：文化建设、传统文化作文。' },
    { t: '生态文明', c: '金句：绿水青山就是金山银山。案例：浙江丽水生态产品价值实现机制。考点：两山论、美丽中国作文。' },
    { t: '科技创新', c: '金句：科技是第一生产力，人才是第一资源。案例：华为突破芯片封锁、C919大飞机。考点：创新驱动、科技自立作文。' },
    { t: '乡村振兴', c: '金句：乡村振兴是实现共同富裕的必由之路。案例：浙江千万工程、数字乡村。考点：三农工作、共同富裕作文。' },
    { t: '法治建设', c: '金句：法治是最好的营商环境。案例：民法典实施、枫桥经验法治化。考点：法治政府、司法公正作文。' }
  ];
  const fallbackCy = [
    { w: '南辕北辙', m: '行动和目的相反。公考语境：常与"缘木求鱼"一起考，侧重方向完全错误。' },
    { w: '相得益彰', m: '两者互相配合，长处更能显现。公考语境："二者/两者 + 相得益彰"为常见搭配。' },
    { w: '应运而生', m: '顺应时机而产生。公考语境：新技术、新制度出现时的固定搭配。' },
    { w: '根深蒂固', m: '根基深厚牢固，不易动摇。公考语境：形容旧观念、旧习惯，中性偏贬义。' },
    { w: '独树一帜', m: '自成一家，风格独特。公考语境：学术/文化/制度领域的独特成就。' },
    { w: '水到渠成', m: '条件成熟，事情自然成功。公考语境：强调条件准备充分，与"瓜熟蒂落"近义。' },
    { w: '一蹴而就', m: '事情很容易一步成功。公考语境：多用于否定句，"不能一蹴而就"高频搭配。' },
    { w: '耳濡目染', m: '长期接触，无形中受影响。公考语境：家庭教育、文化熏陶，侧重"不知不觉"。' },
    { w: '持之以恒', m: '长久坚持。公考语境：干部工作作风、学习态度，与"久久为功"近义。' },
    { w: '推陈出新', m: '去掉旧的糟粕，向新方向发展。公考语境：文化传承、改革创新主题。' }
  ];
  const fallbackCs = [
    { t: '新质生产力', c: '2023年9月习近平在黑龙江考察首次提出：科技创新主导、摆脱传统增长路径、符合高质量发展要求的生产力。核心是科技创新驱动。' },
    { t: '全过程人民民主', c: '党的二十大报告提出：民主选举、协商、决策、管理、监督各环节彼此贯通，是最广泛、最真实、最管用的社会主义民主。' },
    { t: '《民法典》亮点', c: '居住权入编（物权编）、离婚冷静期（婚姻家庭编）、高空抛物责任（侵权责任编）、个人信息保护（人格权编独立成编）。' },
    { t: '中国式现代化五大特征', c: '人口规模巨大的现代化；全体人民共同富裕的现代化；物质文明和精神文明相协调的现代化；人与自然和谐共生的现代化；走和平发展道路的现代化。' },
    { t: '两个毫不动摇', c: '毫不动摇巩固和发展公有制经济；毫不动摇鼓励、支持、引导非公有制经济发展。民营经济是自己人。' },
    { t: '三个区分开来', c: '把干部在推进改革中因缺乏经验、先行先试的失误错误，同明知故犯的违纪违法行为区分开来等三条，为担当者担当。' },
    { t: '枫桥经验', c: '20世纪60年代浙江诸暨枫桥干部创造：发动和依靠群众，矛盾不上交，就地解决。新时代：坚持党建引领，基层治理现代化。' },
    { t: '千万工程', c: '2003年浙江启动"千村示范、万村整治"工程。20年坚持造就万千美丽乡村，是学习运用"千万工程"经验推动乡村振兴的典范。' }
  ];

  // 尝试调用某个板块；失败时使用备用数据
  // fieldKeys: 该板块可能的键名（中英文都列上）
  async function safeGen(name, fieldKeys, fn, fallback, minLen = 1) {
    try {
      const raw = await fn();
      let arr = null;
      if (Array.isArray(raw)) {
        arr = raw;
      } else if (raw && typeof raw === 'object') {
        // 尝试所有可能的键名
        for (const k of fieldKeys) {
          if (Array.isArray(raw[k])) { arr = raw[k]; break; }
        }
        // 如果对象只有一个键且值是数组，直接用
        if (!arr) {
          const vals = Object.values(raw);
          if (vals.length === 1 && Array.isArray(vals[0])) arr = vals[0];
        }
      }
      if (arr && arr.length >= minLen) { console.log(`  → ${name} ${arr.length} 条`); return arr; }
      throw new Error(`${name}数量不足(${arr ? arr.length : 0}<${minLen})`);
    } catch (e) {
      console.log(`  ⚠ ${name} 生成失败(${e.message})，使用备用数据`);
      return fallback;
    }
  }

  console.log('① 生成【时政】板块 (10条)');
  const sz = await safeGen('时政', ['shizheng', '时政', 'news', 'items', 'data', 'list'], async () => {
    const szRaw = await aiJson(
      '你是公务员考试时政研究员。输出纯JSON数组，不要任何其他文字。',
      `根据以下今日官媒新闻，生成一个JSON数组（10条）考公时政考点。
## 新闻列表
${newsList}

## 每条结构（严格遵守）
{"t":"标题","s":"摘要50-100字","src":"来源名称（人民网观点/新华网评论/光明网观点/网络）","d":"${todayStr}","url":"上面新闻中的原文链接","tags":[从${tagsJson}中选],"points":"考点提炼：申论/面试/行测角度(50字内)"}

只输出数组，示例：
[{"t":"...","s":"...","src":"...","d":"${todayStr}","url":"...","tags":["国考"],"points":"..."}]`,
      240000
    );
    return szRaw;
  }, fallbackSz, 5);

  console.log('② 生成【申论素材】板块 (8条)');
  const sc = await safeGen('申论素材', ['sucai', '申论素材', '素材', 'material', 'data', 'list'], async () => {
    return await aiJson(
      '你是公务员申论研究员。输出纯JSON数组，不要任何其他文字。',
      `根据今日官媒新闻方向（${allLinks.slice(0,6).map(l=>l.title).join('；')}），生成8条考公申论备考素材JSON数组。
每条结构：{"t":"主题名称","c":"金句1句 + 典型案例(简短) + 考点应用提示 共100-150字"}
只输出数组，不要外层对象。`,
      240000
    );
  }, fallbackSc, 5);

  console.log('③ 生成【高频成语】板块 (10个)');
  const cy = await safeGen('高频成语', ['chengyu', '高频成语', '成语', 'idioms', 'data', 'list'], async () => {
    return await aiJson(
      '你是公考行测言语老师。输出纯JSON数组，不要任何其他文字。',
      `生成 10 个国考/省考高频易错成语JSON数组，附释义和考公语境辨析。
每条结构：{"w":"成语（4字）","m":"释义+常见错误/考公语境 30-50字"}
只输出数组，不要外层对象。`,
      240000
    );
  }, fallbackCy, 5);

  console.log('④ 生成【常识考点】板块 (8条)');
  const cs = await safeGen('常识考点', ['changshi', '常识考点', '常识', 'knowledge', 'data', 'list'], async () => {
    return await aiJson(
      '你是公考常识研究员。输出纯JSON数组，不要任何其他文字。',
      `生成 8 条公考常识/新法新规/重要会议/政治经济高频考点JSON数组。
每条结构：{"t":"标题（简短）","c":"考点详解80-120字，适合记诵"}
只输出数组，不要外层对象。`,
      240000
    );
  }, fallbackCs, 5);

  const feed = normalizeFeed({
    shizheng: sz,
    sucai: sc,
    chengyu: cy,
    changshi: cs
  });

  console.log(`\n汇总: 时政${feed.shizheng.length}条, 素材${feed.sucai.length}条, 成语${feed.chengyu.length}个, 常识${feed.changshi.length}条`);
  return feed;
}

// ======================== 更新 index.html ========================
function updateIndex(feed) {
  const content = readFileSync(INDEX, 'utf-8');
  const startMarker = '/*__RITTY_FEED_START__*/';
  const endMarker = '/*__RITTY_FEED_END__*/';

  const startIdx = content.indexOf(startMarker);
  const endIdx = content.indexOf(endMarker);
  if (startIdx < 0 || endIdx < 0) {
    throw new Error('找不到 RITTY_FEED 标记');
  }

  // 转义为 JS 对象字面量
  const feedJs = `window.RITTY_FEED = ${JSON.stringify({
    date: today(),
    shizheng: feed.shizheng || [],
    sucai: feed.sucai || [],
    chengyu: feed.chengyu || [],
    changshi: feed.changshi || []
  }, null, 2)};`;

  const newContent =
    content.slice(0, startIdx + startMarker.length) + '\n' +
    feedJs + '\n' +
    content.slice(endIdx);

  writeFileSync(INDEX, newContent, 'utf-8');
  console.log('index.html 已更新');
}

// ======================== 主流程 ========================
async function main() {
  if (!AI_KEY) {
    console.error('错误: 未设置 AI_API_KEY 环境变量');
    process.exit(1);
  }

  console.log(`=== 每日时政推送生成 ${today()} ===`);
  console.log(`AI: ${AI_URL} / ${AI_MODEL}`);

  // 1. 抓取新闻
  const news = await fetchNews();
  if (news.length === 0) {
    console.error('所有新闻源抓取失败');
    process.exit(1);
  }

  // 2. AI 生成
  const feed = await generateFeed(news);

  // 3. 更新 index.html
  updateIndex(feed);

  console.log('=== 完成 ===');
}

main().catch(e => {
  console.error('生成失败:', e.message);
  process.exit(1);
});
