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
async function generateFeed(newsData) {
  const newsSummary = newsData.map(s =>
    `【${s.source}】\n` + s.links.slice(0, 8).map(l => `- ${l.title}`).join('\n')
  ).join('\n\n');

  const prompt = `你是一位资深的公务员考试（国考/省考/事业编）时政辅导老师。请根据以下今日官媒新闻标题，生成今日的时政推送内容。

## 今日新闻源
${newsSummary}

## 要求
请生成 JSON 格式的内容，包含以下板块：

### 1. shizheng（时政，8-12条）
每条包含: t(标题), s(摘要，50-100字), src(来源), d(日期:${today()}), url(原文链接，用新闻源中的链接), tags(适用考试数组，从${JSON.stringify(EXAM_TAGS)}中选), points(考点提炼，含申论/面试/行测角度)

### 2. sucai（申论素材，6-10条）
每条包含: t(主题), c(金句+案例+考点，100-150字)

### 3. chengyu（考公高频成语，8-12个）
每条包含: w(成语), m(释义+考公语境，30-50字)

### 4. changshi（常识考点，6-10条）
每条包含: t(标题), c(内容，80-120字，含新法新规/高频考点)

## 输出格式
只输出纯 JSON（不要 markdown 代码块），结构如下：
{
  "shizheng": [{"t":"","s":"","src":"","d":"","url":"","tags":[],"points":""}],
  "sucai": [{"t":"","c":""}],
  "chengyu": [{"w":"","m":""}],
  "changshi": [{"t":"","c":""}]
}

注意：内容要紧扣考公考编实际考点，时政条目要与当日新闻相关，申论素材要有金句和案例，成语要注意易错点。`;

  console.log('调用 AI 生成推送内容...');

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 300000);
      const res = await fetch(`${AI_URL}/chat/completions`, {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${AI_KEY}`
        },
        body: JSON.stringify({
          model: AI_MODEL,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.7,
          max_tokens: 8000,
          response_format: { type: 'json_object' }
        })
      });
      clearTimeout(timeout);

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`API 返回 ${res.status}: ${errText.slice(0, 200)}`);
      }

      const data = await res.json();
      const content = data.choices[0].message.content;
      const feed = JSON.parse(content);

      // 校验基本结构
      if (!feed.shizheng || !Array.isArray(feed.shizheng) || feed.shizheng.length === 0) {
        throw new Error('AI 返回的 shizheng 为空');
      }
      console.log(`生成成功: 时政${feed.shizheng?.length}条, 素材${feed.sucai?.length}条, 成语${feed.chengyu?.length}个, 常识${feed.changshi?.length}条`);
      return feed;

    } catch (e) {
      console.log(`第 ${attempt} 次尝试失败: ${e.message}`);
      if (attempt < 3) {
        console.log(`等待 ${attempt * 10} 秒后重试...`);
        await sleep(attempt * 10000);
      } else {
        throw e;
      }
    }
  }
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
