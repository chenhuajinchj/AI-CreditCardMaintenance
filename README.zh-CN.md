[**English**](README.md) | 中文

# AI-CreditCardMaintenance

> 一款支持离线的渐进式 Web 应用（PWA），用于多卡信用卡消费记录、还款管理与额度使用率追踪，数据由 Supabase 云端同步。

**在线 Demo：** https://ai-credit-card-maintenance.vercel.app

![PWA](https://img.shields.io/badge/PWA-支持离线-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Stack](https://img.shields.io/badge/技术栈-原生JS%20%2B%20Supabase-orange)

---

## 为什么做这个

手动管理多张信用卡容易出错：哪张卡免息期最长、哪张快到还款日、使用率是否超标……这些全靠记忆很容易忘。这款工具把所有关键数据聚合到一个仪表盘，告诉你今天该刷哪张卡、什么时候还多少钱，无需电子表格，也不需要臃肿的记账 App。

---

## 主要功能

- **多卡管理** — 录入信用卡额度、账单日、到期还款日、卡号后四位
- **账单期流水** — 记录消费/还款/退款，支持费率预设自动计算手续费
- **资产概览** — 每卡本期消费进度、当前欠款、使用率、距账单日天数
- **最佳刷卡推荐** — 按剩余免息期（距下次账单日天数 + 20 天宽限期）自动推荐今日最优卡
- **还款策略规划** — 两段式策略：账单日后压使用率至 60–70%，到期日前 2 天清零
- **用卡健康指标** — 本期消费笔数、平均刷卡间隔、单一商户占比、消费场景多样性，逐项对照配置目标给出状态
- **费率预设** — 保存常用商户/平台的费率，记账时一键套用
- **消费趋势图** — 当月累计消费折线图（Chart.js）
- **Supabase Auth 登录** — 邮箱注册/登录，RLS 严格隔离用户数据
- **离线 localStorage 备份** — 网络不可用时自动降级为本地模式，重连后数据可继续同步
- **深色模式** — 跟随系统，设置页可手动切换
- **PWA / 添加到主屏幕** — iOS 和 Android 均可安装

---

## 快速开始（使用在线 Demo）

直接打开 https://ai-credit-card-maintenance.vercel.app，注册账号后添加第一张卡，无需安装任何东西。

---

## 自部署

如果你想把数据存在自己的 Supabase 项目中：

### 1. 创建 Supabase 项目

前往 https://supabase.com 新建项目，记下 **Project URL** 和 **anon key**。

### 2. 建表并启用 RLS

在 Supabase SQL 编辑器中执行以下 SQL：

```sql
-- 创建表
create table if not exists public.user_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  content jsonb not null default '{}'::jsonb
);

-- 启用行级安全
alter table public.user_data enable row level security;

-- 策略：每个用户只能读写自己的行
create policy "Users can read own data"
  on public.user_data
  for select
  using (auth.uid() = user_id);

create policy "Users can insert own data"
  on public.user_data
  for insert
  with check (auth.uid() = user_id);

create policy "Users can update own data"
  on public.user_data
  for update
  using (auth.uid() = user_id);

create policy "Users can delete own data"
  on public.user_data
  for delete
  using (auth.uid() = user_id);
```

### 3. 修改前端配置

打开 `creditcardapp/app.js`，将顶部的两个常量替换为你自己的值：

```js
const supabaseUrl = 'YOUR_PROJECT_URL';
const supabaseKey = 'YOUR_ANON_KEY';
```

### 4. 部署或本地运行

没有构建步骤。你可以：

- 把 `creditcardapp/` 目录放到任意静态托管（Vercel、Netlify、Cloudflare Pages、nginx……）
- 或者直接用浏览器打开 `creditcardapp/index.html` 在本地使用

---

## 使用说明

| 页面 | 功能 |
|------|------|
| 概览 | 查看 KPI、今日推荐刷卡、还款策略 |
| 卡片 | 新增/编辑卡片，查看单卡使用率与还款阶段 |
| 流水 | 记录消费/还款/退款，按卡/按账期筛选 |
| 预设 | 保存常用商户费率预设 |
| 设置 | 深色模式、数据导出/重置、退出登录 |

**记一笔：**
1. 点击右下角 **+** 浮动按钮（或桌面端导航栏的"记一笔"按钮）。
2. 选择卡片、日期、金额。
3. 选择类型：消费 / 还款 / 退款。
4. （可选）选择费率预设，手续费自动计算。
5. 点击**确认记账**。

---

## 与同类工具对比

| | AI-CreditCardMaintenance | 电子表格 | 通用记账 App |
|--|--|--|--|
| 多卡额度使用率追踪 | 有 | 手动 | 少见 |
| 免息期最优卡推荐 | 有（按账期计算） | 手动 | 无 |
| 两段式还款策略 | 有 | 无 | 无 |
| 用卡健康指标（笔数/间隔/商户分散度） | 有 | 无 | 无 |
| 离线可用 | 有（localStorage） | N/A | 因 App 而异 |
| 零构建纯静态前端 | 是 | N/A | N/A |
| 可自部署 | 是 | N/A | 因 App 而异 |

---

## 常见问题

**数据存在哪里？安全吗？**
数据存储在 Supabase 的 `user_data.content`（JSONB 格式），同时在浏览器 `localStorage` 保留本地备份。Supabase 开启了行级安全（RLS），每个用户只能访问自己的行。

**不部署 Supabase 能用吗？**
可以。Supabase 不可用时，应用自动切换到纯本地模式，所有功能正常，只是无法跨设备同步。

**怎么自建后端？**
参见上方的[自部署](#自部署)章节。

**免息期和最佳用卡怎么计算的？**
应用计算"今天到下次账单日的天数 + 20 天宽限期（`GRACE_DAYS`）"，取值最大的卡作为推荐。这是经验算法，实际宽限期以你的发卡行为准。

**使用率怎么计算的？**
`使用率 = 当前净欠款 / 信用额度`，净欠款 = 期初欠款 + 本期消费 − 本期退款 − 本期还款。

**还款策略怎么算的？**
`calc.js` 中的 `computeRepaymentStrategy` 生成两段计划：  
1. 账单日后第 2 天：如果使用率超过 70%，先还到约 65%。  
2. 到期日前第 2 天：清零剩余欠款，避免产生利息。

---

## 安全说明

`app.js` 中可见的 Supabase `anon` key 是**公开客户端密钥**，设计上即可嵌入前端代码。安全保障来自 Supabase 的行级安全策略（RLS），而非密钥保密。

**如果你自部署，请务必在上线前确认 `user_data` 表已开启 RLS。** 没有 RLS，任何登录用户都可以读取其他人的数据。

在线 Demo 使用的是作者自己的 Supabase 项目，请勿在其中存储敏感财务数据。

---

## 运行环境要求

- 任意现代浏览器（Chrome、Safari、Firefox、Edge）
- Supabase 项目（可选，不部署也可在本地使用）
- 无需 Node.js，无需构建工具，前端为纯 HTML + ES 模块（依赖从 CDN 加载）

---

## 许可证

MIT — 详见 [LICENSE](LICENSE)。
