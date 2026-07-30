# Ritty 工作台 - 部署指南

## 一、注册 GitHub 账号（5分钟）

1. 打开 https://github.com/signup
2. 填写邮箱、密码、用户名（例如 `ritty2026`）
3. 验证邮箱
4. 免费计划即可，无需付费

## 二、创建仓库（2分钟）

1. 登录后访问 https://github.com/new
2. Repository name 填 `ritty`
3. 选择 **Private**（私有，只有你能看）
4. 勾选 **Add a README file**
5. 点击 **Create repository**

## 三、开启 GitHub Pages（1分钟）

1. 进入仓库 → **Settings** → **Pages**
2. Source 选择 **GitHub Actions**
3. 保存

## 四、上传代码

在本项目目录执行（替换 `你的用户名`）：

```bash
cd /workspace
git remote add origin https://github.com/你的用户名/ritty.git
git push -u origin main
```

推送后 GitHub 会自动部署，等 1-2 分钟后访问：
```
https://你的用户名.github.io/ritty/
```

## 五、配置 AI 自动推送密钥

### 1. 注册 Deepseek 获取 API Key（推荐，便宜好用）

1. 打开 https://platform.deepseek.com/
2. 注册并登录
3. 充值 10 元（够用很久，每次生成约 0.01 元）
4. 左侧 **API Keys** → **Create API Key** → 复制

### 2. 添加 GitHub Secrets

进入仓库 → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**，添加：

| Name | Value |
|------|-------|
| `AI_API_KEY` | 你的 Deepseek API Key |
| `AI_BASE_URL` | `https://api.deepseek.com/v1` （留空也行，默认就是它） |
| `AI_MODEL` | `deepseek-chat` （留空也行，默认就是它） |

### 3. （可选）配置失败邮件通知

如果想接收推送失败的邮件提醒，再加三个 Secrets：

| Name | Value |
|------|-------|
| `MAIL_USER` | 你的 QQ 邮箱地址 |
| `MAIL_PASS` | QQ 邮箱 SMTP 授权码（在 QQ 邮箱设置→账户→开启SMTP获取） |
| `MAIL_TO` | 接收通知的邮箱 |

> 如果不配置邮件，GitHub Actions 默认也会在你邮箱发失败通知（需在 Settings → Notifications 开启 Email）

## 六、验证自动推送

1. 进入仓库 → **Actions** 标签页
2. 左侧找到 **每日时政推送**
3. 点击 **Run workflow** 手动触发一次测试
4. 如果绿色 ✓ 说明成功，index.html 会被自动更新并部署

## 七、手机使用

1. 手机浏览器打开 `https://你的用户名.github.io/ritty/`
2. iOS Safari：分享 → 添加到主屏幕
3. Android Chrome：菜单 → 添加到主屏幕
4. 之后从桌面图标打开，体验和原生 App 一样

## 日常维护

- **每天 6:00** GitHub Actions 自动运行：抓取官媒新闻 → AI 生成推送 → 更新页面 → 自动部署
- **失败会重试** 3 次（间隔 10/20 秒）
- **最终失败** 会发邮件通知
- **手动触发**：Actions → 每日时政推送 → Run workflow
- **换 AI 服务商**：修改 `AI_BASE_URL` / `AI_MODEL` Secret 即可（支持 OpenAI 兼容接口）
